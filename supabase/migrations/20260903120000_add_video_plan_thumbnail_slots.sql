-- Let a video plan carry up to three thumbnail options. The existing single
-- thumbnail columns stay as the primary thumbnail read by the current
-- packaging pipeline, while these arrays preserve all slots for the planner UI.

alter table public.video_plans
  add column thumbnail_storage_paths text[] not null default '{}'::text[],
  add column thumbnail_mime_types text[] not null default '{}'::text[],
  add column thumbnail_size_bytes_list bigint[] not null default '{}'::bigint[];

update public.video_plans
set
  thumbnail_storage_paths = array[thumbnail_storage_path],
  thumbnail_mime_types = array[thumbnail_mime_type],
  thumbnail_size_bytes_list = array[thumbnail_size_bytes]
where thumbnail_storage_path is not null
  and array_length(thumbnail_storage_paths, 1) is null;

alter table public.video_plans
  add constraint video_plans_thumbnail_slot_count_check
  check (
    cardinality(thumbnail_storage_paths) <= 3
    and cardinality(thumbnail_mime_types) <= 3
    and cardinality(thumbnail_size_bytes_list) <= 3
  );
