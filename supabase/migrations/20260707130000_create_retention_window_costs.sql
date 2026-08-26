-- Per-window cost accounting for the deep-analysis pipeline. Each retention
-- window drives up to three billed LLM calls - the snapshot vision call, the
-- audio call, and the cross-modal event-synthesis call (see
-- lib/retention-window-media-analysis.ts and
-- lib/retention-window-event-synthesis.ts) - and this table records the token
-- usage and derived dollar cost of each, one row per (window, step).
--
-- One row per step rather than a single JSONB blob on retention_windows so a
-- re-run of just one step overwrites only that step's figure (upsert on
-- (retention_window_id, step)) without disturbing the others, and so the
-- evidence view can sum them per window and across the video trivially.
--
-- cost_usd is stored already-computed (tokens * per-model rate) rather than
-- derived on read: the rate card can move over time, and a persisted figure
-- captures what the call actually cost at the time it ran.

create table public.retention_window_costs (
  id uuid primary key default gen_random_uuid(),
  retention_window_id uuid not null,
  analysed_video_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which per-window LLM call this cost is for.
  step text not null check (step in ('snapshot', 'audio', 'event_synthesis')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (retention_window_id, user_id)
    references public.retention_windows (id, user_id) on delete cascade,
  foreign key (analysed_video_id, user_id)
    references public.analysed_videos (id, user_id) on delete cascade,
  unique (retention_window_id, step)
);

create index retention_window_costs_user_id_idx
  on public.retention_window_costs (user_id);
create index retention_window_costs_analysed_video_id_idx
  on public.retention_window_costs (analysed_video_id);

grant select, insert, update, delete
  on public.retention_window_costs to authenticated;

alter table public.retention_window_costs enable row level security;

create policy "Users can view their own retention window costs"
  on public.retention_window_costs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own retention window costs"
  on public.retention_window_costs for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.retention_windows
      where id = retention_window_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own retention window costs"
  on public.retention_window_costs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own retention window costs"
  on public.retention_window_costs for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_retention_window_costs_updated_at
  before update on public.retention_window_costs
  for each row execute function private.set_updated_at();
