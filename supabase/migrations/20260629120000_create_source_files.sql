-- Stores metadata about a raw/original video file a user uploads as the source
-- for a YouTube video they've analysed. The file bytes themselves live in object
-- storage (the `source-files` bucket); this table only ever holds the storage
-- pointer plus validation state. The raw file is uploaded direct-to-storage via
-- a server-minted signed URL — it never passes through the app server.
--
-- A source file belongs to exactly one analysed video (the per-user YouTube
-- video record). `youtube_video_id` is denormalised alongside the FK so the
-- storage object path and ownership checks don't need a join.
create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The analysed video this raw file is the source for. Cascades so deleting an
  -- analysis removes its source-file metadata too (the object is cleaned up by
  -- the app before the row goes).
  analysed_video_id uuid not null
    references public.analysed_videos(id) on delete cascade,
  -- Stable YouTube ID, denormalised from analysed_videos for path/ownership use.
  youtube_video_id text not null,

  -- Upload metadata.
  original_filename text not null,
  storage_provider text not null default 'supabase',
  storage_path text,
  file_size_bytes bigint,
  mime_type text,

  -- Duration validation (browser-measured vs. YouTube-reported).
  uploaded_duration_seconds double precision,
  youtube_duration_seconds double precision,
  duration_difference_seconds double precision,
  duration_validation_status text
    check (duration_validation_status in ('passed', 'failed')),

  -- Soft filename/title similarity check. Never blocks the user.
  filename_validation_status text
    check (filename_validation_status in ('passed', 'warning', 'unknown')),
  filename_similarity_score double precision,

  -- Combined validation result and the upload lifecycle state.
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'passed', 'warning', 'failed')),
  upload_status text not null default 'pending'
    check (upload_status in (
      'pending', 'uploading', 'uploaded', 'processing', 'ready', 'failed'
    )),
  failure_reason text,

  -- Set later when we start auto-deleting raw files after extraction. Null = keep.
  delete_after timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One source file per analysed video for now; re-uploading replaces the row.
  unique (analysed_video_id)
);

create index source_files_user_video_idx
  on public.source_files (user_id, youtube_video_id);

alter table public.source_files enable row level security;

-- Users can only ever see and act on their own source files. Writes also require
-- that the referenced analysed video belongs to them, so a user can't attach a
-- source file to someone else's video even by forging analysed_video_id.
create policy "Users can view their own source files"
  on public.source_files
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own source files"
  on public.source_files
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.analysed_videos av
      where av.id = analysed_video_id
        and av.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own source files"
  on public.source_files
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own source files"
  on public.source_files
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_source_files_updated_at
  before update on public.source_files
  for each row
  execute function private.set_updated_at();

-- Private bucket for the raw uploads. 30 GB per-object cap mirrors
-- SOURCE_FILE_MAX_UPLOAD_BYTES. Access is mediated entirely by server-minted
-- signed URLs, so no storage RLS policies are granted to public roles.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-files',
  'source-files',
  false,
  32212254720,
  array[
    'video/mp4',
    'video/quicktime',
    'video/x-m4v',
    'video/x-matroska',
    'video/webm',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;
