-- Stores one generated pacing report per analysed video. Window-level values
-- live in pacing_windows so they can be queried and compared across videos.
create table public.pacing_analyses (
  id uuid primary key default gen_random_uuid(),
  analysed_video_id uuid not null unique
    references public.analysed_videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  prompt_version text not null default 'v1',
  overall_pacing text not null,
  video_wide_patterns jsonb not null default '[]'::jsonb
    check (jsonb_typeof(video_wide_patterns) = 'array'),
  notable_transitions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(notable_transitions) = 'array'),
  slow_or_repetitive_stretches jsonb not null default '[]'::jsonb
    check (jsonb_typeof(slow_or_repetitive_stretches) = 'array'),
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index pacing_analyses_user_id_idx
  on public.pacing_analyses (user_id);

create table public.pacing_windows (
  id uuid primary key default gen_random_uuid(),
  pacing_analysis_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_index integer not null check (window_index >= 0),
  kind text not null check (kind in ('hook', 'minute')),
  label text not null,
  start_seconds double precision not null check (start_seconds >= 0),
  end_seconds double precision not null check (end_seconds > start_seconds),
  word_count integer not null check (word_count >= 0),
  words_per_minute double precision not null check (words_per_minute >= 0),
  role text not null,
  pace text not null
    check (pace in ('very_slow', 'slow', 'moderate', 'fast', 'very_fast')),
  information_density text not null
    check (information_density in ('low', 'moderate', 'high')),
  progression text not null
    check (progression in ('stalled', 'limited', 'steady', 'strong')),
  pacing_change text not null
    check (pacing_change in ('decelerating', 'stable', 'accelerating', 'mixed')),
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array'),
  possible_issue text,
  confidence double precision not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pacing_analysis_id, user_id)
    references public.pacing_analyses(id, user_id) on delete cascade,
  unique (pacing_analysis_id, window_index)
);

create index pacing_windows_user_id_idx
  on public.pacing_windows (user_id);

grant select, insert, update, delete
  on public.pacing_analyses to authenticated;
grant select, insert, update, delete
  on public.pacing_windows to authenticated;

alter table public.pacing_analyses enable row level security;
alter table public.pacing_windows enable row level security;

create policy "Users can view their own pacing analyses"
  on public.pacing_analyses for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own pacing analyses"
  on public.pacing_analyses for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.analysed_videos
      where id = analysed_video_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own pacing analyses"
  on public.pacing_analyses for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.analysed_videos
      where id = analysed_video_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own pacing analyses"
  on public.pacing_analyses for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view their own pacing windows"
  on public.pacing_windows for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own pacing windows"
  on public.pacing_windows for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.pacing_analyses
      where id = pacing_analysis_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can update their own pacing windows"
  on public.pacing_windows for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.pacing_analyses
      where id = pacing_analysis_id
        and user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own pacing windows"
  on public.pacing_windows for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger set_public_pacing_analyses_updated_at
  before update on public.pacing_analyses
  for each row execute function private.set_updated_at();

create trigger set_public_pacing_windows_updated_at
  before update on public.pacing_windows
  for each row execute function private.set_updated_at();

-- Preserve reports generated while pacing_analysis was a JSONB column on the
-- video row. This makes the normalization safe whether or not that earlier
-- migration has already been deployed.
insert into public.pacing_analyses (
  analysed_video_id,
  user_id,
  model,
  prompt_version,
  overall_pacing,
  video_wide_patterns,
  notable_transitions,
  slow_or_repetitive_stretches,
  generated_at
)
select
  id,
  user_id,
  coalesce(nullif(pacing_analysis ->> 'model', ''), 'unknown'),
  'v1',
  coalesce(pacing_analysis ->> 'overallPacing', ''),
  coalesce(pacing_analysis -> 'videoWidePatterns', '[]'::jsonb),
  coalesce(pacing_analysis -> 'notableTransitions', '[]'::jsonb),
  coalesce(pacing_analysis -> 'slowOrRepetitiveStretches', '[]'::jsonb),
  coalesce(
    nullif(pacing_analysis ->> 'generatedAt', '')::timestamptz,
    now()
  )
from public.analysed_videos
where pacing_analysis is not null
on conflict (analysed_video_id) do nothing;

insert into public.pacing_windows (
  pacing_analysis_id,
  user_id,
  window_index,
  kind,
  label,
  start_seconds,
  end_seconds,
  word_count,
  words_per_minute,
  role,
  pace,
  information_density,
  progression,
  pacing_change,
  evidence,
  possible_issue,
  confidence
)
select
  pa.id,
  av.user_id,
  (pacing_window.ordinality - 1)::integer,
  pacing_window.value ->> 'kind',
  pacing_window.value ->> 'label',
  (pacing_window.value ->> 'startSeconds')::double precision,
  (pacing_window.value ->> 'endSeconds')::double precision,
  (pacing_window.value ->> 'wordCount')::integer,
  (pacing_window.value ->> 'wordsPerMinute')::double precision,
  pacing_window.value ->> 'role',
  pacing_window.value ->> 'pace',
  pacing_window.value ->> 'informationDensity',
  pacing_window.value ->> 'progression',
  pacing_window.value ->> 'pacingChange',
  coalesce(pacing_window.value -> 'evidence', '[]'::jsonb),
  pacing_window.value ->> 'possibleIssue',
  (pacing_window.value ->> 'confidence')::double precision
from public.analysed_videos av
join public.pacing_analyses pa on pa.analysed_video_id = av.id
cross join lateral jsonb_array_elements(av.pacing_analysis -> 'windows')
  with ordinality as pacing_window(value, ordinality)
where av.pacing_analysis is not null
on conflict (pacing_analysis_id, window_index) do nothing;

alter table public.analysed_videos
  drop column if exists pacing_analysis;
