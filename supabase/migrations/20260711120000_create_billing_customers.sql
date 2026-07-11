-- Maps each app user to their Stripe Customer and caches the default card on
-- file so the billing settings page can render "Visa •••• 4242" without a live
-- Stripe API call on every render. The card fields are a read-through cache kept
-- in sync by the Stripe webhook (app/api/stripe/webhook) — Stripe remains the
-- source of truth, and no raw card data (PAN/CVC) is ever stored here.
--
-- Like public.google_credentials this table is deliberately locked down: RLS is
-- enabled but NO policies are granted to anon/authenticated, so it is
-- unreachable with the publishable key. Only the service-role key (which
-- bypasses RLS, used exclusively server-side) can read or write it.
create table public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  -- Cached default payment method, populated by the webhook. Null until the
  -- user completes the "add payment method" Checkout flow.
  card_brand text,
  card_last4 text,
  card_exp_month smallint,
  card_exp_year smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;

-- No policies on purpose: deny all access to anon/authenticated. Service role
-- bypasses RLS and is the only intended accessor.

create trigger set_public_billing_customers_updated_at
  before update on public.billing_customers
  for each row
  execute function private.set_updated_at();
