-- The Video Planner: a plan for a video that has not been published yet.
--
-- Everywhere else in the app an upload hangs off an analysed YouTube video, so
-- the packaging feedback is written about something the audience has already
-- seen. A plan is the opposite: the footage exists, the title ideas and the
-- thumbnail exist, and none of it is public yet, so the same read of title vs.
-- thumbnail vs. hook is worth having *before* the upload button is pressed.
--
-- A plan therefore carries the three things a viewer meets:
--   • up to three candidate titles, in the order the creator wrote them;
--   • one thumbnail image, in its own private bucket;
--   • the source footage, which reuses the existing source_files pipeline
--     (direct-to-storage upload, then the Qencode proxy transcode).
-- From those we transcribe the spoken script into `transcript` and store the
-- model's packaging read in `packaging_plan`.
--
-- Retention prediction (which stretches of the new video are likely to lose
-- viewers, learned from the creator's published catalogue) is the next thing
-- this table grows into. Nothing here is packaging-only by design; it simply
-- has no retention columns yet.

create table public.video_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The candidate titles, 1 to 3, in the creator's own order. Stored as an
  -- array rather than three columns because the whole point is that the count
  -- varies and the set is judged together: the packaging read compares them
  -- against one another and recommends one.
  titles text[] not null default '{}'::text[],

  -- The thumbnail, in the private video-plan-thumbnails bucket. Only ever
  -- reached through a server-minted signed URL, like the source files.
  thumbnail_storage_path text,
  thumbnail_mime_type text,
  thumbnail_size_bytes bigint,

  -- Lifecycle of the plan as a whole, which is deliberately coarser than the
  -- source file's own upload/normalisation states:
  --   draft      - being assembled; the footage has not landed yet
  --   processing - everything is in, the packaging read has not finished
  --   ready      - packaging_plan is populated
  --   failed     - the packaging read could not be produced; failure_reason says why
  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'failed')),
  failure_reason text,

  -- The whole spoken script, transcribed from the uploaded footage: an array of
  -- { startSeconds, endSeconds, text } cues, exactly the TranscriptCue[] shape
  -- analysed_videos.transcript holds for a published video.
  --
  -- The planner's stand-in for the caption track a published video has, because
  -- there are no YouTube captions for a video nobody can watch yet. Packaging
  -- only reads the first thirty seconds of it, but the shape and the coverage
  -- are deliberately the full published-video ones: every light-analysis pass
  -- retention prediction will need (pacing, retention attribution, script
  -- taxonomy) takes exactly this, so a plan transcribed hook-only would have to
  -- be re-transcribed from scratch the moment that lands.
  transcript jsonb,

  -- The model's read of the packaging (lib/video-plans/packaging-plan.ts).
  packaging_plan jsonb,
  -- Claim guard for the generation, same pattern as the analysed-video
  -- analyses (lib/analysis-claim.ts): several callers can legitimately arrive
  -- at once (the plan page rendering, a second tab, the client's poll), and
  -- only one should spend the model call.
  packaging_plan_status text
    check (packaging_plan_status in ('processing', 'failed')),
  packaging_plan_claimed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One to three titles, or none at all while the row is still being created.
  constraint video_plans_titles_count_check
    check (array_length(titles, 1) is null or array_length(titles, 1) between 1 and 3)
);

create index video_plans_user_created_idx
  on public.video_plans (user_id, created_at desc);

alter table public.video_plans enable row level security;

create policy "Users can view their own video plans"
  on public.video_plans
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own video plans"
  on public.video_plans
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own video plans"
  on public.video_plans
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own video plans"
  on public.video_plans
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_video_plans_updated_at
  before update on public.video_plans
  for each row
  execute function private.set_updated_at();

-- --------------------------------------------------------------------------
-- source_files becomes polymorphic: it belongs to an analysed video OR a plan
-- --------------------------------------------------------------------------
--
-- The alternative was a second uploads table for plans, which would have meant
-- a second copy of the multipart upload, the storage-object lifecycle and the
-- Qencode normalisation - roughly a thousand lines duplicated so that one
-- foreign key could stay NOT NULL. Instead the two owners sit side by side and
-- a check constraint keeps exactly one of them set on every row.
alter table public.source_files
  add column video_plan_id uuid references public.video_plans(id) on delete cascade;

alter table public.source_files
  alter column analysed_video_id drop not null,
  alter column youtube_video_id drop not null;

-- The old "one source file per analysed video" uniqueness was a table
-- constraint, which can't be made conditional. Replace it with a partial unique
-- index per owner, keeping the same rule on each side: re-uploading replaces
-- the row.
alter table public.source_files
  drop constraint if exists source_files_analysed_video_id_key;

create unique index source_files_analysed_video_uniq
  on public.source_files (analysed_video_id)
  where analysed_video_id is not null;

create unique index source_files_video_plan_uniq
  on public.source_files (video_plan_id)
  where video_plan_id is not null;

alter table public.source_files
  add constraint source_files_owner_check
  check (num_nonnulls(analysed_video_id, video_plan_id) = 1);

-- The insert policy previously proved ownership through analysed_videos alone,
-- which would reject every plan-owned row. Prove it through whichever owner the
-- row names instead, so a user still cannot attach an upload to someone else's
-- video or someone else's plan by forging the id.
drop policy if exists "Users can insert their own source files" on public.source_files;

create policy "Users can insert their own source files"
  on public.source_files
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      (
        analysed_video_id is not null
        and exists (
          select 1 from public.analysed_videos av
          where av.id = analysed_video_id
            and av.user_id = (select auth.uid())
        )
      )
      or (
        video_plan_id is not null
        and exists (
          select 1 from public.video_plans vp
          where vp.id = video_plan_id
            and vp.user_id = (select auth.uid())
        )
      )
    )
  );

-- --------------------------------------------------------------------------
-- Thumbnail storage
-- --------------------------------------------------------------------------
-- Its own private bucket rather than the source-files one, whose allowed mime
-- types are video containers. 10 MB is well above anything YouTube accepts (2
-- MB), so the cap only ever catches a mistake. Like source-files, no storage
-- RLS policies are granted: access is entirely through server-minted signed
-- URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'video-plan-thumbnails',
  'video-plan-thumbnails',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Cost logging
-- --------------------------------------------------------------------------
-- Transcribing a plan's footage is a new kind of paid cost: OpenAI bills it per
-- minute of audio, so it has no tokens and no model rate card, exactly like the
-- Qencode transcode beside it. Recreate the cost_type check with it added,
-- keeping both previously permitted types.
alter table public.cost_logs
  drop constraint if exists cost_logs_cost_type_check;

alter table public.cost_logs
  add constraint cost_logs_cost_type_check check (
    cost_type in ('llm_call', 'qencode_transcode', 'openai_transcription')
  );

-- The planner's packaging read is a new call_type. Recreate the check
-- constraint with it added, keeping every previously permitted type.
alter table public.cost_logs
  drop constraint if exists cost_logs_call_type_check;

alter table public.cost_logs
  add constraint cost_logs_call_type_check check (
    call_type in (
      'pacing',
      'packaging_alignment',
      'packaging_taxonomy',
      'script_taxonomy',
      'script_comparison',
      'packaging_comparison',
      'retention_comparison',
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis',
      'transcript_taxonomy',
      'tip_examples',
      'video_plan_packaging'
    )
  );
