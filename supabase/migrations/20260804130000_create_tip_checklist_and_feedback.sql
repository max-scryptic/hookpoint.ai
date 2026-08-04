-- Two tables behind the "Try:" tips a creator reads on a report.
--
-- saved_tips is the creator's own checklist: the tips they kept to work
-- through while making their next video. tip_feedback is the other half of the
-- same control, the tips they told us were not useful and why, which is read
-- back in the admin so we can see which advice keeps missing.
--
-- Both store the tip text itself rather than a reference to whatever generated
-- it. A tip is written by a model into a report that can be regenerated or
-- deleted, so a foreign key would either dangle or take the creator's
-- checklist down with it; what the creator kept, and what they judged, must
-- outlive the report it was read on.

create table public.saved_tips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tip text not null check (char_length(tip) between 1 and 2000),
  -- Where the tip was read, e.g. "Retention: Drop-off" or "Packaging: Title".
  -- Written by the interface at save time, so the checklist can say what each
  -- line came from without holding on to the report.
  section text not null check (char_length(section) between 1 and 200),
  -- App-relative path back to the report the tip was read on, so the checklist
  -- can link to it. Nullable: the report may be gone by the time it is opened,
  -- and the tip is still worth keeping.
  source_path text check (
    source_path is null or char_length(source_path) between 1 and 500
  ),
  -- The tip text normalised for comparison (lower case, punctuation collapsed).
  -- Computed by the application so one implementation of the rule serves both
  -- the uniqueness constraint here and the saved/unsaved state of the button in
  -- the interface. The unique constraint is what stops the same advice, met
  -- again on another report, from landing in the checklist twice.
  tip_fingerprint text not null check (
    char_length(tip_fingerprint) between 1 and 500
  ),
  -- Set when the creator ticks the tip off, cleared when they untick it.
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tip_fingerprint)
);

-- The checklist reads one creator's tips newest first, which is the only query
-- this table serves.
create index saved_tips_user_created_idx
  on public.saved_tips (user_id, created_at desc);

alter table public.saved_tips enable row level security;

-- New Supabase projects no longer expose public-schema tables to the Data API
-- automatically. Grant only the operations this feature uses; the policies
-- below still limit every one of them to the signed-in creator's own rows.
grant select, insert, update, delete on public.saved_tips to authenticated;

create policy "Creators can read their own saved tips"
  on public.saved_tips for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Creators can save their own tips"
  on public.saved_tips for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Creators can tick off their own saved tips"
  on public.saved_tips for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Creators can delete their own saved tips"
  on public.saved_tips for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- A tip the creator flagged as not useful, with the reason they picked and
-- whatever they wrote about it. Insert-only from the creator's side: each flag
-- is a separate report of a separate reading, so flagging the same advice twice
-- keeps both. Read back in the admin (Tip Feedback) via the service role.
create table public.tip_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tip text not null check (char_length(tip) between 1 and 2000),
  section text not null check (char_length(section) between 1 and 200),
  source_path text check (
    source_path is null or char_length(source_path) between 1 and 500
  ),
  reason text not null check (
    reason in (
      'not_relevant',
      'too_generic',
      'already_doing_it',
      'incorrect',
      'not_actionable',
      'other'
    )
  ),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);

-- The admin table reads every flag newest first; the user index keeps the
-- foreign key covered for per-creator reads.
create index tip_feedback_created_idx on public.tip_feedback (created_at desc);
create index tip_feedback_user_idx on public.tip_feedback (user_id);

alter table public.tip_feedback enable row level security;

grant select, insert on public.tip_feedback to authenticated;

create policy "Creators can read their own tip feedback"
  on public.tip_feedback for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Creators can flag tips as not useful"
  on public.tip_feedback for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
