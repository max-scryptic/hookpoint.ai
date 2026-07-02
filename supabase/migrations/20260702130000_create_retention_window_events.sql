-- Synthesizes cross-modal "events" for a retention window: the deterministic
-- editing/audio measurements and the already-computed vision/audio LLM
-- analyses (retention_window_snapshots.analysis, retention_window_audio.analysis)
-- get combined, in one more LLM call per window — text-only, no raw media
-- re-sent, just the structured evidence that's already been computed — into
-- a handful of timestamped, narrated events explaining what plausibly drove
-- that window's retention change. A single window (30s+) commonly produces
-- more than one such event, hence a dedicated child table rather than a
-- single JSONB column on retention_windows.
--
-- retention_window_event_synthesis tracks the one synthesis job per window
-- (pending/ready/failed), mirroring retention_window_scene_cue_scans —
-- including the same stale-failure retry, since this call is cheap enough
-- that a transient failure shouldn't need a full re-analyze to heal. Its
-- output lands in retention_window_events, one row per identified event.

create table public.retention_window_event_synthesis (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null unique,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  model text,
  synthesized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade
);

create table public.retention_window_events (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Order within the window, as returned by the synthesis call.
  event_index integer not null check (event_index >= 0),
  event_type text not null check (event_type in (
    'scene_cut', 'topic_shift', 'visual_change', 'audio_change',
    'pacing_change', 'on_screen_text_change', 'other'
  )),
  timestamp_seconds double precision not null check (timestamp_seconds >= 0),
  narrative text not null,
  -- Which evidence source most explains this event; 'combined' when several
  -- genuinely converge on the same moment.
  primary_evidence text not null check (primary_evidence in (
    'editing', 'visual', 'audio', 'transcript', 'combined'
  )),
  created_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade,
  unique (retention_window_id, event_index)
);

create index retention_window_event_synthesis_user_id_idx
  on public.retention_window_event_synthesis (user_id);
create index retention_window_event_synthesis_analysed_video_id_idx
  on public.retention_window_event_synthesis (analysed_video_id);
create index retention_window_events_user_id_idx
  on public.retention_window_events (user_id);
create index retention_window_events_analysed_video_id_idx
  on public.retention_window_events (analysed_video_id);

grant select, insert, update, delete
  on public.retention_window_event_synthesis to authenticated;
grant select, insert, update, delete
  on public.retention_window_events to authenticated;

alter table public.retention_window_event_synthesis enable row level security;
alter table public.retention_window_events enable row level security;

create policy "Users can view their own event synthesis jobs"
  on public.retention_window_event_synthesis for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own event synthesis jobs"
  on public.retention_window_event_synthesis for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own event synthesis jobs"
  on public.retention_window_event_synthesis for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own event synthesis jobs"
  on public.retention_window_event_synthesis for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view their own retention window events"
  on public.retention_window_events for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own retention window events"
  on public.retention_window_events for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own retention window events"
  on public.retention_window_events for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_retention_window_event_synthesis_updated_at
  before update on public.retention_window_event_synthesis
  for each row execute function private.set_updated_at();
