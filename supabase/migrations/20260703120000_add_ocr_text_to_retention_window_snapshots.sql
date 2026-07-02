-- Deterministic (no LLM) on-screen text recognized from a harvested
-- snapshot via tesseract.js (see lib/media/ocr.ts), captured at the same
-- time extraction marks the row 'ready' — a recognition failure or a
-- text-free frame just leaves this null, the same best-effort tolerance
-- already given to ffmpeg's own deterministic audio measurements
-- (average_volume/silence on retention_window_audio.analysis).
alter table public.retention_window_snapshots
  add column if not exists ocr_text text;
