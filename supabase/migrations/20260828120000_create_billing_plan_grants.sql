-- Complimentary ("gifted") plans: a paid tier handed to an account by an admin
-- without any money changing hands. Test accounts, beta creators and support
-- make-goods all need the paid features without a Stripe subscription behind
-- them, and writing a fake row into public.billing_subscriptions to fake one is
-- exactly the trick that leaves the billing screen offering a cancel and a
-- change-plan action against a subscription Stripe has never heard of.
--
-- So a grant lives here instead, entirely outside the Stripe projection. The
-- entitlement resolver reads both and never confuses the two: a grant is
-- revocable in one delete, it can never be overwritten by a Stripe webhook, and
-- a real subscription arriving later is unaffected by it.
--
-- Like public.billing_subscriptions this table is locked down: RLS is enabled
-- but NO policies are granted to anon/authenticated, so it is unreachable with
-- the publishable key. Only the service-role key (server-side only, and which
-- bypasses RLS) can read or write it, and every write goes through the admin
-- API route that has already established the caller is an admin.
create table public.billing_plan_grants (
  -- One grant per account: gifting again replaces the grant rather than
  -- stacking a second one nobody can see.
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Which paid tier the grant hands over: 'starter' or 'pro'. Free is the
  -- absence of a grant, never stored here.
  plan_id text not null check (plan_id in ('starter', 'pro')),
  -- When the grant began. Usage counters are keyed on the window start derived
  -- from this, so re-issuing a grant starts the account's allowance afresh.
  starts_at timestamptz not null default now(),
  -- When the grant lapses, or null for an open-ended one. A lapsed grant stops
  -- entitling on its own, so a time-boxed gift needs no cleanup job.
  expires_at timestamptz,
  -- Why it was given (an internal note, never shown to the account holder).
  note text,
  -- The admin who issued it. Kept for the audit trail; nulled rather than
  -- cascading if that admin's account is ever removed.
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A grant that expires before it starts would entitle nobody, ever.
  constraint billing_plan_grants_window_check
    check (expires_at is null or expires_at > starts_at)
);

-- The admin users table resolves every account's effective plan in one read, so
-- the "which grants are live right now" scan is the hot path here.
create index billing_plan_grants_expires_at_idx
  on public.billing_plan_grants (expires_at);

alter table public.billing_plan_grants enable row level security;

-- No policies on purpose: deny all access to anon/authenticated. Service role
-- bypasses RLS and is the only intended accessor.

create trigger set_public_billing_plan_grants_updated_at
  before update on public.billing_plan_grants
  for each row
  execute function private.set_updated_at();
