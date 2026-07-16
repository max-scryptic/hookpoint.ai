-- Adds sustained, near-flat audience-retention stretches to the same window
-- table and downstream deep-analysis pipeline used by hooks, drop-offs and
-- gains. Existing ownership constraints, grants and RLS policies continue to
-- apply because this extends the discriminator rather than adding a table.

alter table public.retention_windows
  drop constraint if exists retention_windows_kind_check;

alter table public.retention_windows
  add constraint retention_windows_kind_check
    check (kind in ('hook', 'drop_off', 'gain', 'hold'));

comment on column public.retention_windows.kind is
  'Retention window category: hook, drop_off, gain, or hold.';
