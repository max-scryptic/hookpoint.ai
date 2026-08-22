-- Wipes one creator's content and app state, leaving the account itself intact.
--
-- What survives: auth.users, public.users, billing_customers and
-- billing_subscriptions. The creator can still sign in afterwards and their
-- Stripe linkage and plan are untouched — they simply land on an empty app, as
-- though they had just signed up. Wiping the billing rows instead would orphan
-- a live Stripe subscription from the account paying for it, which is why they
-- are deliberately left alone; delete the auth.users row if the intent is to
-- remove the account outright, and every table below goes with it on cascade.
--
-- Everything else keyed to the creator goes: their videos and every analysis
-- artefact hanging off them, their uploaded footage, their saved tips, their
-- Google connection, their usage counters and their cost history.
--
-- The user id is written once, at the top. Nothing else in this file needs
-- editing.
--
-- SQL is not the whole wipe. The creator's uploaded footage and the thumbnails
-- and audio cut from it live in Supabase Storage, which refuses to be deleted
-- from in SQL (see section 3b). Run the Storage step as well, or the video
-- files themselves survive the wipe.
--
-- Ordering is child -> parent throughout. Every foreign key here is currently
-- `on delete cascade`, so deleting analysed_videos alone would take most of
-- this with it — the explicit ordering is what keeps the wipe complete if a
-- cascade rule is ever relaxed, and what lets the verification at the end
-- prove each table empty rather than trusting the cascade did its job.


-- ---------------------------------------------------------------------------
-- 1. The one input
-- ---------------------------------------------------------------------------

-- Dropped first so the file can be run twice in one session. The view depends
-- on the table, so it has to go first.
drop view if exists wipe_counts;
drop table if exists wipe_target;

create temp table wipe_target as
select 'REPLACE-WITH-USER-ID'::uuid as user_id;   -- <<< the only edit


-- Stops a typo'd or already-deleted id from running a wipe that silently
-- touches nothing and reports success.
do $$
declare
  target uuid;
begin
  select user_id into target from wipe_target;

  if not exists (select 1 from auth.users where id = target) then
    raise exception 'No auth.users row for %  — check the id before wiping', target;
  end if;

  raise notice 'Wiping user % (%)', target,
    (select email from auth.users where id = target);
end $$;


-- ---------------------------------------------------------------------------
-- 2. What the wipe covers
-- ---------------------------------------------------------------------------

-- Written once and read twice: once before the deletes to show what is about
-- to go, once after to prove it went. `step` orders the listing the same way
-- the deletes run, so a non-zero row after the wipe points straight at the
-- statement that missed it.
--
-- Keeping the preserved tables in the same listing makes the two halves of the
-- intent visible together — a wipe that took billing with it shows up here as
-- a zero where a count belongs, rather than as a support ticket later.
create temp view wipe_counts as
select 1  as step, 'wiped'     as disposition, 'pacing_windows'                   as table_name, count(*) as rows from public.pacing_windows                   x join wipe_target t on t.user_id = x.user_id
union all select 2,  'wiped',     'pacing_analyses',                  count(*) from public.pacing_analyses                  x join wipe_target t on t.user_id = x.user_id
union all select 3,  'wiped',     'retention_window_audio',           count(*) from public.retention_window_audio           x join wipe_target t on t.user_id = x.user_id
union all select 4,  'wiped',     'retention_window_snapshots',       count(*) from public.retention_window_snapshots       x join wipe_target t on t.user_id = x.user_id
union all select 5,  'wiped',     'retention_window_transcripts',     count(*) from public.retention_window_transcripts     x join wipe_target t on t.user_id = x.user_id
union all select 6,  'wiped',     'retention_window_costs',           count(*) from public.retention_window_costs           x join wipe_target t on t.user_id = x.user_id
union all select 7,  'wiped',     'retention_window_event_synthesis', count(*) from public.retention_window_event_synthesis x join wipe_target t on t.user_id = x.user_id
union all select 8,  'wiped',     'retention_window_events',          count(*) from public.retention_window_events          x join wipe_target t on t.user_id = x.user_id
union all select 9,  'wiped',     'retention_window_scene_cue_scans', count(*) from public.retention_window_scene_cue_scans x join wipe_target t on t.user_id = x.user_id
union all select 10, 'wiped',     'video_scene_cues',                 count(*) from public.video_scene_cues                 x join wipe_target t on t.user_id = x.user_id
union all select 11, 'wiped',     'deep_analysis_insight_feedback',   count(*) from public.deep_analysis_insight_feedback   x join wipe_target t on t.user_id = x.user_id
union all select 12, 'wiped',     'retention_windows',                count(*) from public.retention_windows                x join wipe_target t on t.user_id = x.user_id
union all select 13, 'wiped',     'video_comparisons',                count(*) from public.video_comparisons                x join wipe_target t on t.user_id = x.user_id
union all select 14, 'wiped',     'deep_analysis_pipeline_runs',      count(*) from public.deep_analysis_pipeline_runs      x join wipe_target t on t.user_id = x.user_id
union all select 15, 'wiped',     'source_files',                     count(*) from public.source_files                     x join wipe_target t on t.user_id = x.user_id
union all select 16, 'wiped',     'notifications',                    count(*) from public.notifications                    x join wipe_target t on t.user_id = x.user_id
union all select 17, 'wiped',     'analysed_videos',                  count(*) from public.analysed_videos                  x join wipe_target t on t.user_id = x.user_id
union all select 18, 'wiped',     'google_credentials',               count(*) from public.google_credentials               x join wipe_target t on t.user_id = x.user_id
union all select 19, 'wiped',     'usage_counters',                   count(*) from public.usage_counters                   x join wipe_target t on t.user_id = x.user_id
union all select 20, 'wiped',     'user_daily_activity',              count(*) from public.user_daily_activity              x join wipe_target t on t.user_id = x.user_id
union all select 21, 'wiped',     'onboarding_hints',                 count(*) from public.onboarding_hints                 x join wipe_target t on t.user_id = x.user_id
union all select 22, 'wiped',     'saved_tips',                       count(*) from public.saved_tips                       x join wipe_target t on t.user_id = x.user_id
union all select 23, 'wiped',     'tip_feedback',                     count(*) from public.tip_feedback                     x join wipe_target t on t.user_id = x.user_id
union all select 24, 'wiped',     'billing_cancellation_feedback',    count(*) from public.billing_cancellation_feedback    x join wipe_target t on t.user_id = x.user_id
union all select 25, 'wiped',     'cost_logs',                        count(*) from public.cost_logs                        x join wipe_target t on t.user_id = x.user_id
union all select 26, 'storage',   'storage: source-files',            count(*) from storage.objects                         x join wipe_target t on split_part(x.name, '/', 1) = t.user_id::text where x.bucket_id = 'source-files'
union all select 27, 'storage',   'storage: retention-window-media',  count(*) from storage.objects                         x join wipe_target t on split_part(x.name, '/', 1) = t.user_id::text where x.bucket_id = 'retention-window-media'
union all select 90, 'preserved', 'users',                            count(*) from public.users                            x join wipe_target t on t.user_id = x.id
union all select 91, 'preserved', 'billing_customers',                count(*) from public.billing_customers                x join wipe_target t on t.user_id = x.user_id
union all select 92, 'preserved', 'billing_subscriptions',            count(*) from public.billing_subscriptions            x join wipe_target t on t.user_id = x.user_id
union all select 93, 'preserved', 'auth.users',                       count(*) from auth.users                              x join wipe_target t on t.user_id = x.id;


-- Before. Read this and make sure the shape matches the account you meant.
select * from wipe_counts order by step;


-- ---------------------------------------------------------------------------
-- 3. The wipe
-- ---------------------------------------------------------------------------

begin;

-- Retention-window children.
delete from public.pacing_windows                   x using wipe_target t where t.user_id = x.user_id;
delete from public.pacing_analyses                  x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_audio           x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_snapshots       x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_transcripts     x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_costs           x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_event_synthesis x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_events          x using wipe_target t where t.user_id = x.user_id;
delete from public.retention_window_scene_cue_scans x using wipe_target t where t.user_id = x.user_id;
delete from public.video_scene_cues                 x using wipe_target t where t.user_id = x.user_id;
delete from public.deep_analysis_insight_feedback   x using wipe_target t where t.user_id = x.user_id;

-- Retention windows, parent of everything above.
delete from public.retention_windows                x using wipe_target t where t.user_id = x.user_id;

-- Analysis artefacts and uploads that hang off a video rather than a window.
delete from public.video_comparisons                x using wipe_target t where t.user_id = x.user_id;
delete from public.deep_analysis_pipeline_runs      x using wipe_target t where t.user_id = x.user_id;
delete from public.source_files                     x using wipe_target t where t.user_id = x.user_id;
delete from public.notifications                    x using wipe_target t where t.user_id = x.user_id;

-- The videos themselves, root of the content tree.
delete from public.analysed_videos                  x using wipe_target t where t.user_id = x.user_id;

-- Account-level state with no path through analysed_videos.
--
-- usage_counters going means the creator's consumption for the current billing
-- period resets to zero. That is the intended reading of a wipe — they have no
-- analyses left, so they should not still be carrying the cost of them — but it
-- does hand back credits, so comment this one out for a wipe where the period's
-- usage should stand.
delete from public.google_credentials               x using wipe_target t where t.user_id = x.user_id;
delete from public.usage_counters                   x using wipe_target t where t.user_id = x.user_id;
delete from public.user_daily_activity              x using wipe_target t where t.user_id = x.user_id;

-- The one-time coach marks. Clearing these means the creator is shown the
-- interface hints again on their next upload, which is right for an account
-- being handed back in a just-signed-up state.
delete from public.onboarding_hints                 x using wipe_target t where t.user_id = x.user_id;

-- The creator's tip checklist, and the tips they flagged as not useful.
--
-- tip_feedback is the one row here that is also product telemetry — it is read
-- back in the admin to see which advice keeps missing. It goes anyway, because
-- the notes field is free text the creator wrote and a wipe that leaves their
-- words behind is not a wipe. Comment it out only if the feedback is being kept
-- deliberately and someone has decided that is defensible.
delete from public.saved_tips                       x using wipe_target t where t.user_id = x.user_id;
delete from public.tip_feedback                     x using wipe_target t where t.user_id = x.user_id;

-- Why they cancelled, if they did.
delete from public.billing_cancellation_feedback    x using wipe_target t where t.user_id = x.user_id;

-- Per-call accounting. Carries a denormalised user_email, so these rows are
-- personal data in their own right and are removed rather than anonymised.
delete from public.cost_logs                        x using wipe_target t where t.user_id = x.user_id;

commit;


-- ---------------------------------------------------------------------------
-- 3b. Storage — has to happen outside SQL
-- ---------------------------------------------------------------------------

-- The creator's uploaded footage lives in the `source-files` bucket, and the
-- thumbnails and audio clips cut from it live in `retention-window-media`. Both
-- key their objects as `<user_id>/...`, so the user id is the whole filter.
--
-- These cannot be deleted from here. storage.objects carries a
-- `protect_objects_delete` trigger that raises on any direct delete —
--
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- and it is right to. The row in storage.objects is only the metadata; the
-- bytes live in the backing store, and deleting the row would strand them there
-- permanently — invisible, uncollectable, still billed. Only the Storage API
-- removes both halves.
--
-- So run this, with the same user id, before or after the transaction above:
--
--   supabase storage rm -r "ss:///source-files/<user_id>" --experimental
--   supabase storage rm -r "ss:///retention-window-media/<user_id>" --experimental
--
-- or the equivalent `.storage.from(bucket).remove(paths)` call with the service
-- role key. The two storage rows in the verification below stay non-zero until
-- this is done, which is what stops the step from being quietly skipped.
--
-- The trigger does read a `storage.allow_delete_query` setting that would let a
-- transaction force the delete through. Don't: it buys nothing here except the
-- orphaned bytes the trigger exists to prevent.


-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

-- Every 'wiped' row should now read 0.
--
-- Every 'preserved' row should read 1 — a 0 there means the account itself was
-- caught in the wipe.
--
-- The two 'storage' rows read 0 only once the Storage API step in 3b has been
-- run. Non-zero here means the database is clean but the creator's video files
-- are still sitting in the buckets; the wipe is not finished.
select * from wipe_counts order by step;


-- ---------------------------------------------------------------------------
-- 5. Clean up
-- ---------------------------------------------------------------------------

-- Temp objects die with the connection anyway; dropping them here keeps a
-- reused session from carrying the last wipe's target into the next one.
drop view wipe_counts;
drop table wipe_target;
