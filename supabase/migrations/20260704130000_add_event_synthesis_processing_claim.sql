-- A synthesis worker needs a durable claim because both the original media
-- callback and the progress-poll recovery path may run at the same time.
-- Stale processing rows are reclaimed by the application after ten minutes.
alter table public.retention_window_event_synthesis
  drop constraint retention_window_event_synthesis_status_check;

alter table public.retention_window_event_synthesis
  add constraint retention_window_event_synthesis_status_check
  check (status in ('pending', 'processing', 'ready', 'failed'));
