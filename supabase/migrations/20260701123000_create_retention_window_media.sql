-- Stores the thumbnails and audio clips harvested from a retention window's
-- analysis_from_seconds/analysis_to_seconds range (see the previous migration),
-- ready for a later AI-analysis pass (not implemented yet — this only persists
-- the media).
--
-- retention_window_snapshots holds one row per 5-second chunk timestamp within
-- the window (e.g. a 0-30s hook window yields chunk_index 0..6 at 0s, 5s, ...,
-- 30s). retention_window_audio holds one row per window, covering the window's
-- full span. Both start 'pending' (the timestamps/range are known as soon as
-- the retention window is saved) and flip to 'ready' or 'failed' once
-- extraction actually runs against the uploaded source video.

create table public.retention_window_snapshots (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  timestamp_seconds double precision not null check (timestamp_seconds >= 0),
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade,
  unique (retention_window_id, chunk_index)
);

create table public.retention_window_audio (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null unique,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_seconds double precision not null check (from_seconds >= 0),
  to_seconds double precision not null check (to_seconds > from_seconds),
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade
);

create index retention_window_snapshots_user_id_idx
  on public.retention_window_snapshots (user_id);
create index retention_window_snapshots_analysed_video_id_idx
  on public.retention_window_snapshots (analysed_video_id);
create index retention_window_audio_user_id_idx
  on public.retention_window_audio (user_id);
create index retention_window_audio_analysed_video_id_idx
  on public.retention_window_audio (analysed_video_id);

grant select, insert, update, delete
  on public.retention_window_snapshots to authenticated;
grant select, insert, update, delete
  on public.retention_window_audio to authenticated;

alter table public.retention_window_snapshots enable row level security;
alter table public.retention_window_audio enable row level security;

create policy "Users can view their own retention window snapshots"
  on public.retention_window_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own retention window snapshots"
  on public.retention_window_snapshots for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own retention window snapshots"
  on public.retention_window_snapshots for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own retention window snapshots"
  on public.retention_window_snapshots for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view their own retention window audio"
  on public.retention_window_audio for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own retention window audio"
  on public.retention_window_audio for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own retention window audio"
  on public.retention_window_audio for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own retention window audio"
  on public.retention_window_audio for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_retention_window_snapshots_updated_at
  before update on public.retention_window_snapshots
  for each row execute function private.set_updated_at();

create trigger set_public_retention_window_audio_updated_at
  before update on public.retention_window_audio
  for each row execute function private.set_updated_at();

-- Private bucket for the extracted thumbnails/audio clips. Access is always
-- mediated by server-minted signed URLs (mirrors the source-files bucket), not
-- storage RLS policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'retention-window-media',
  'retention-window-media',
  false,
  52428800,
  array['image/jpeg', 'audio/aac', 'audio/mp4']
)
on conflict (id) do nothing;
