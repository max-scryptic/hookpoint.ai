-- AI-generated insights for an analysed video: the hook score, per-drop
-- hypotheses, and overall summary produced by the insight pipeline. Stored as
-- JSONB (schema-light, like the other analysis payloads) and generated on
-- demand, so it stays null until a user asks for insights on a video.
alter table public.analysed_videos
  add column if not exists insights jsonb;
