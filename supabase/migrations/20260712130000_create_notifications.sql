-- Durable in-app notifications. Deep-analysis completion is detected at the
-- database boundary so a user can leave the report page (or close the app)
-- without losing the completion event.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysed_video_id uuid references public.analysed_videos(id) on delete cascade,
  kind text not null check (kind in ('deep_analysis_complete')),
  title text not null,
  description text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);

-- A completion transition can be observed more than once when workers race.
-- Keep one durable completion notification per analysed video.
create unique index notifications_deep_analysis_video_idx
  on public.notifications (user_id, kind, analysed_video_id)
  where analysed_video_id is not null;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.notifications enable row level security;

create policy "Users can view their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can mark their own notifications as read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The last event-synthesis job settling is the final stage of deep analysis.
-- This trigger runs for both successful and failed jobs because the progress
-- UI also considers a failed stage settled; either way, the analysis has
-- finished and no more background work remains.
create or replace function private.notify_deep_analysis_complete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  analysed_video_title text;
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

  return new;
end;
$$;

create trigger notify_deep_analysis_complete
  after insert or update of status
  on public.retention_window_event_synthesis
  for each row execute function private.notify_deep_analysis_complete();
