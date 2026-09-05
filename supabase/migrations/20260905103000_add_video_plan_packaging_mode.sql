-- Persist the creator's chosen A/B packaging shape. Without this, the planner
-- has to infer mode from counts, which breaks once someone switches from a
-- thumbnail test back to a title test while old thumbnail slots still exist.

alter table public.video_plans
  add column packaging_mode text not null default 'single'
  check (
    packaging_mode in (
      'single',
      'title',
      'thumbnail',
      'title-and-thumbnail'
    )
  );

with option_counts as (
  select
    id,
    coalesce(cardinality(array_remove(titles, null)), 0) as title_count,
    coalesce(cardinality(array_remove(thumbnail_storage_paths, null)), 0) as thumbnail_count
  from public.video_plans
)
update public.video_plans as plan
set packaging_mode = case
  when option_counts.title_count > 1 and option_counts.thumbnail_count > 1
    then 'title-and-thumbnail'
  when option_counts.thumbnail_count > 1
    then 'thumbnail'
  when option_counts.title_count > 1
    then 'title'
  else 'single'
end
from option_counts
where option_counts.id = plan.id;
