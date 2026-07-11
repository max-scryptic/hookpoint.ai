-- Records each user's active subscription so the app can resolve their plan and
-- the current billing window (which drives usage limits and their monthly
-- reset). Stripe remains the source of truth: every column here is a projection
-- kept in sync by the Stripe webhook (app/api/stripe/webhook). A user with no
-- row here is treated as the Free plan, whose cycle is anchored to their account
-- creation date rather than a Stripe billing date.
--
-- Like public.billing_customers this table is deliberately locked down: RLS is
-- enabled but NO policies are granted to anon/authenticated, so it is
-- unreachable with the publishable key. Only the service-role key (used
-- exclusively server-side, and which bypasses RLS) can read or write it. The
-- entitlement resolver in lib/billing reads it through the admin client.
create table public.billing_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- The Stripe Subscription and Customer this projection mirrors.
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  -- Which paid tier the subscription's price maps to: 'starter' or 'pro'. The
  -- Free plan is represented by the absence of a row, never stored here.
  plan_id text not null check (plan_id in ('starter', 'pro')),
  -- Whether the price is the monthly or annual variant, so the UI can label it.
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  -- Raw Stripe subscription status (active, trialing, past_due, canceled, …).
  -- Only 'active' and 'trialing' grant the paid plan's limits; anything else
  -- falls back to Free (see lib/billing/entitlements).
  status text not null,
  -- The current billing window, copied from Stripe. Usage counters are keyed on
  -- current_period_start, so when Stripe advances these at each renewal the
  -- user's usage naturally resets to zero for the new window.
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  -- True when the user has cancelled but keeps access until period end.
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhook handlers resolve app user from the Stripe customer id, so index it.
create index billing_subscriptions_customer_idx
  on public.billing_subscriptions (stripe_customer_id);

alter table public.billing_subscriptions enable row level security;

-- No policies on purpose: deny all access to anon/authenticated. Service role
-- bypasses RLS and is the only intended accessor.

create trigger set_public_billing_subscriptions_updated_at
  before update on public.billing_subscriptions
  for each row
  execute function private.set_updated_at();
