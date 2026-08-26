-- One row per creator per one-time interface hint they have already met.
--
-- The hints this backs are the coach marks that appear once a creator's raw
-- footage has been through the deeper analysis, pointing at what that upload
-- just left behind: the retention chart's highlights, which now play that
-- moment back from the file, and the per-window tabs the analysis adds
-- alongside "Script". Each one is retired the moment the creator uses the
-- thing it points at - at that point they know the feature is there and a
-- second showing is just noise.
--
-- The absence of a row is what makes a hint pending, so a hint added to
-- ONBOARDING_HINTS later ships as "not yet seen" for every existing account
-- without a backfill.
--
-- Kept per user rather than per video, and in the database rather than in the
-- browser: the feature is learned once, not once per report, and a local flag
-- would teach it again on every new device.
create table public.onboarding_hints (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The hint's stable key, mirrored by ONBOARDING_HINTS in
  -- lib/onboarding-hints.ts. Deliberately unconstrained text: a hint retired
  -- from the interface should leave its rows harmlessly behind rather than
  -- needing a migration to widen a check constraint every time one is added.
  hint text not null check (char_length(hint) between 1 and 100),
  seen_at timestamptz not null default now(),
  primary key (user_id, hint)
);

alter table public.onboarding_hints enable row level security;

-- New Supabase projects no longer expose public-schema tables to the Data API
-- automatically. A hint is only ever recorded, never changed or withdrawn, so
-- select and insert are the whole surface; the policies below still limit both
-- to the signed-in creator's own rows.
grant select, insert on public.onboarding_hints to authenticated;

create policy "Creators can read their own seen hints"
  on public.onboarding_hints for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Creators can record their own seen hints"
  on public.onboarding_hints for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
