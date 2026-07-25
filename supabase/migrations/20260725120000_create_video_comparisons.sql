-- Saved video-vs-video comparison reports for the Video Comparator. Generating
-- a comparison costs deep-dive credits, so each generated pair is persisted
-- here: the creator's history of head-to-heads, and the record that lets a pair
-- be re-opened for free once it has been paid for. The report itself is always
-- recomputed on the fly from the two videos' stored deep analysis (curves,
-- windows, events, packaging); only the pair and when it was generated live
-- here, so a re-open always reflects the freshest stored analysis.
create table public.video_comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_a_id uuid not null references public.analysed_videos(id) on delete cascade,
  video_b_id uuid not null references public.analysed_videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A comparison is always between two distinct videos.
  constraint video_comparisons_distinct check (video_a_id <> video_b_id)
);

-- Newest comparisons first for the "previous comparisons" list.
create index video_comparisons_user_created_idx
  on public.video_comparisons (user_id, created_at desc);

-- One saved comparison per unordered pair per user: (A, B) and (B, A) are the
-- same head-to-head, so a swapped re-generate re-opens the existing row for
-- free rather than charging twice.
create unique index video_comparisons_pair_idx
  on public.video_comparisons (
    user_id,
    least(video_a_id, video_b_id),
    greatest(video_a_id, video_b_id)
  );

alter table public.video_comparisons enable row level security;

-- New Supabase projects may no longer expose public-schema tables to the Data
-- API automatically. Grant only the operations this feature uses; RLS below
-- still limits every operation to the signed-in creator's own rows.
grant select, insert on public.video_comparisons to authenticated;

-- The application uses the signed-in user's Supabase client for reads and
-- writes. In addition to checking user_id, the insert verifies that both
-- referenced videos are owned by that same user, preventing a forged
-- cross-user foreign-key reference.
create policy "Creators can read their own video comparisons"
  on public.video_comparisons for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Creators can create comparisons for their own videos"
  on public.video_comparisons for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.analysed_videos av
      where av.id = video_a_id
        and av.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.analysed_videos av
      where av.id = video_b_id
        and av.user_id = (select auth.uid())
    )
  );
