create table public.deep_analysis_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysed_video_id uuid not null references public.analysed_videos(id) on delete cascade,
  pipeline_version text not null,
  status text not null check (status in ('running', 'ready', 'failed')),
  current_stage text,
  stages jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index deep_analysis_pipeline_one_running_video_idx
  on public.deep_analysis_pipeline_runs (analysed_video_id)
  where status = 'running';

create index deep_analysis_pipeline_runs_video_idx
  on public.deep_analysis_pipeline_runs (user_id, analysed_video_id, started_at desc);

alter table public.deep_analysis_pipeline_runs enable row level security;
grant select on public.deep_analysis_pipeline_runs to authenticated;

create policy "Creators can read their own deep analysis runs"
  on public.deep_analysis_pipeline_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

