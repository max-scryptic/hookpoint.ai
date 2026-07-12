-- Captures why a user cancelled their paid plan. When someone downgrades to
-- Free the UI asks them to pick a reason (and optionally leave notes) before the
-- cancellation is scheduled; that response is recorded here for later reference
-- and churn analysis. This is an append-only log — a user can cancel, resume and
-- cancel again, so multiple rows per user are expected and intentional.
--
-- Like the other billing tables this is deliberately locked down: RLS is enabled
-- but NO policies are granted to anon/authenticated, so it is unreachable with
-- the publishable key. Only the service-role key (used server-side, and which
-- bypasses RLS) writes it, from the /api/billing/cancel route.
create table public.billing_cancellation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The subscription and tier being cancelled, copied at cancellation time so
  -- the feedback stays meaningful even after the subscription row is gone.
  stripe_subscription_id text,
  plan_id text,
  -- Machine-readable reason code chosen from the fixed list the UI presents
  -- (see lib/billing/cancellation-reasons). 'other' pairs with free-text notes.
  reason text not null check (
    reason in (
      'too_expensive',
      'missing_features',
      'not_using',
      'switching_tool',
      'technical_issues',
      'temporary_break',
      'other'
    )
  ),
  -- Optional free-text elaboration the user left.
  notes text,
  created_at timestamptz not null default now()
);

-- Feedback is looked up per user when reviewing churn, so index it.
create index billing_cancellation_feedback_user_idx
  on public.billing_cancellation_feedback (user_id);

alter table public.billing_cancellation_feedback enable row level security;

-- No policies on purpose: deny all access to anon/authenticated. Service role
-- bypasses RLS and is the only intended accessor.
