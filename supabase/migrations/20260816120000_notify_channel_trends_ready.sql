-- Telling a creator their Channel Trends page has come of age.
--
-- The trends page unlocks progressively: it starts as a meter counting videos
-- in, shows early signals from three deeply analysed videos, and reaches full
-- strength at ESTABLISHED_TRENDS_VIDEO_THRESHOLD (see lib/channel-trends.ts),
-- where the band-split views finally have three videos above the median and
-- three below. Nothing told the creator that moment had arrived: the page only
-- says so if they happen to open it.
--
-- This adds a second notification kind, delivered by the same durable
-- notifications table and the same bottom-right alert that a finished deep
-- analysis already uses. It fires once per creator, on the deep analysis that
-- takes their library to the threshold, and rides on the existing completion
-- trigger so it lands at exactly the moment that analysis settles rather than
-- part-way through it.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
    check (kind in ('deep_analysis_complete', 'channel_trends_ready'));

comment on column public.notifications.kind is
  'Notification category: deep_analysis_complete, or channel_trends_ready.';

-- The trends notification belongs to the library as a whole rather than to the
-- video that happened to complete it, so it carries no analysed_video_id and
-- the per-video unique index does not constrain it. One per creator, for ever:
-- crossing the threshold is a single moment, and a library that later shrinks
-- and regrows should not announce itself twice.
create unique index notifications_channel_trends_ready_idx
  on public.notifications (user_id)
  where kind = 'channel_trends_ready';

-- Unchanged from the original definition down to the completion insert; the
-- trends block at the end is what this migration adds. Sharing the trigger
-- means sharing its advisory lock and its "no jobs left pending" gate, so the
-- trends alert cannot arrive while the sixth video is still being analysed.
create or replace function private.notify_deep_analysis_complete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Keep in step with ESTABLISHED_TRENDS_VIDEO_THRESHOLD in
  -- lib/channel-trends.ts: the library size at which the page stops labelling
  -- its trends as early signals.
  trends_threshold constant integer := 6;
  analysed_video_title text;
  library_video_count integer;
begin
  if new.status not in ('ready', 'failed') then
    return new;
  end if;

  -- Synthesis jobs finish concurrently. Serialize the completion check per
  -- video so the final transaction sees every earlier committed transition
  -- rather than two workers each observing the other as still pending.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.analysed_video_id::text, 0)
  );

  if exists (
    select 1
    from public.retention_window_event_synthesis jobs
    where jobs.analysed_video_id = new.analysed_video_id
      and jobs.user_id = new.user_id
      and jobs.status not in ('ready', 'failed')
  ) then
    return new;
  end if;

  select video_title
  into analysed_video_title
  from public.analysed_videos
  where id = new.analysed_video_id
    and user_id = new.user_id;

  insert into public.notifications (
    user_id,
    analysed_video_id,
    kind,
    title,
    description
  ) values (
    new.user_id,
    new.analysed_video_id,
    'deep_analysis_complete',
    'Deep analysis complete',
    case
      when analysed_video_title is null then 'Your video has finished deep analysis.'
      else analysed_video_title || ' has finished deep analysis.'
    end
  )
  on conflict (user_id, kind, analysed_video_id)
    where analysed_video_id is not null
    do update set
      title = excluded.title,
      description = excluded.description,
      read_at = null,
      created_at = now();

  -- The library has just grown. Cheapest guard first: past the threshold this
  -- runs on every analysis the creator will ever finish, and all of those are
  -- no-ops.
  if exists (
    select 1
    from public.notifications
    where notifications.user_id = new.user_id
      and notifications.kind = 'channel_trends_ready'
  ) then
    return new;
  end if;

  -- Counted exactly as the page counts it (loadLibrarySize in
  -- lib/channel-trends.ts): distinct videos carrying a ready synthesis job, so
  -- a video whose jobs all failed moves the creator no closer.
  select pg_catalog.count(distinct jobs.analysed_video_id)
  into library_video_count
  from public.retention_window_event_synthesis jobs
  where jobs.user_id = new.user_id
    and jobs.status = 'ready';

  -- At-or-past rather than exactly-at, so a library that crossed the threshold
  -- without this trigger seeing it (a restored row, a backfill) is still told
  -- on the next completion instead of never.
  if library_video_count < trends_threshold then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    analysed_video_id,
    kind,
    title,
    description
  ) values (
    new.user_id,
    null,
    'channel_trends_ready',
    'Channel Trends is ready',
    'You have deeply analysed ' || library_video_count ||
      ' videos, enough for your channel trends to hold up. See what repeats across your uploads.'
  )
  on conflict (user_id) where kind = 'channel_trends_ready' do nothing;

  return new;
end;
$$;
