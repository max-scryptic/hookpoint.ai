-- Adds a transcript column to analysed_videos. Fetching a video's caption track
-- costs YouTube Data API quota (captions.list + captions.download), so — like
-- the retention curve — we persist the parsed, timestamped transcript once and
-- replay it instead of re-spending quota on every view.
--
-- Stored as JSONB: an array of { startSeconds, endSeconds, text } cues. Nullable
-- because rows analysed before this column existed won't have one, and because a
-- video may simply have no captions available.
alter table public.analysed_videos
  add column transcript jsonb;
