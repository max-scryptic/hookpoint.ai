-- Stores the transcript text spoken during a retention window's
-- analysis_from_seconds/analysis_to_seconds range (see
-- 20260701120000_add_analysis_window_to_retention_windows.sql).
--
-- Unlike retention_window_snapshots/audio (20260701123000), there's no
-- extraction step to wait on: the full transcript is already fetched from the
-- YouTube captions API and cached on analysed_videos.transcript, so the
-- clipped text for a window is derived and written in the same request that
-- saves the window itself. One row per window, holding the exact bounds the
-- text was clipped from alongside the text.

create table public.retention_window_transcripts (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null unique,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_seconds double precision not null check (from_seconds >= 0),
  to_seconds double precision not null check (to_seconds > from_seconds),
  transcript text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade
);

create index retention_window_transcripts_user_id_idx
  on public.retention_window_transcripts (user_id);
create index retention_window_transcripts_analysed_video_id_idx
  on public.retention_window_transcripts (analysed_video_id);

grant select, insert, update, delete
  on public.retention_window_transcripts to authenticated;

alter table public.retention_window_transcripts enable row level security;

create policy "Users can view their own retention window transcripts"
  on public.retention_window_transcripts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own retention window transcripts"
  on public.retention_window_transcripts for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own retention window transcripts"
  on public.retention_window_transcripts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own retention window transcripts"
  on public.retention_window_transcripts for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_retention_window_transcripts_updated_at
  before update on public.retention_window_transcripts
  for each row execute function private.set_updated_at();
