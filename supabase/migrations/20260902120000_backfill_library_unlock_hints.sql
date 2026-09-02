-- The sidebar now points at a library gate on the analysis that opens it: a
-- coach mark on the Channel Trends entry at CHANNEL_TRENDS_VIDEO_THRESHOLD
-- deeply analysed videos, and one on the Video Planner entry at
-- VIDEO_PLANNER_VIDEO_THRESHOLD (both in lib/deep-analysis-library.ts, keyed as
-- channel_trends_unlocked and video_planner_unlocked in lib/onboarding-hints).
--
-- A hint is pending while the creator has no row for it, so without this both
-- bubbles would ship as "not yet met" to every existing account, including the
-- ones that crossed these thresholds months ago. Telling a creator who has been
-- reading their trends all year that the page has "now opened" is a product
-- announcing itself to someone who already knows, so this records the gates an
-- account has ALREADY crossed as met and leaves the ones still ahead of them to
-- be announced when they are actually reached.
--
-- Counted exactly as the app counts it (countDeeplyAnalysedVideos in
-- lib/deep-analysis-library.ts, loadLibrarySize in lib/channel-trends.ts):
-- distinct videos carrying a ready synthesis job, so a video whose jobs all
-- failed moves the creator no closer. Deliberately blind to the account's plan,
-- unlike the sidebar itself: a creator who crossed a gate on a paid plan and
-- has since downgraded has still seen the page open, and re-announcing it if
-- they resubscribe would be the same stale news.
insert into public.onboarding_hints (user_id, hint)
select
  library.user_id,
  gate.hint
from
  (
    select
      jobs.user_id,
      count(distinct jobs.analysed_video_id) as video_count
    from public.retention_window_event_synthesis jobs
    where jobs.status = 'ready'
    group by jobs.user_id
  ) as library
  join (
    values
      ('channel_trends_unlocked', 6),
      ('video_planner_unlocked', 10)
  ) as gate (hint, threshold) on library.video_count >= gate.threshold
on conflict (user_id, hint) do nothing;
