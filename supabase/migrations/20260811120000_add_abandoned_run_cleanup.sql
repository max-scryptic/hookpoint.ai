-- Cleaning up after an abandoned run.
--
-- Generating a comparison report (and analysing a video) charges the creator
-- before the work is done, because the row has to exist for the work to be
-- written onto. If the creator closes the tab or navigates away mid-run, that
-- charge bought them nothing: the run stops where it stands and the row is left
-- carrying no report at all. Two things are needed to undo that, and neither
-- existed before this migration:
--
--   1. The creator's own client can delete their own comparison rows, so an
--      abandoned pair can be removed rather than sitting in the history for
--      ever, opening onto an empty report.
--   2. A way to hand a charge back. increment_usage_counters deliberately
--      clamps its deltas to zero (a negative increment there would be a bug),
--      so refunds get their own function rather than a sign flip on that one.

-- The delete side of the comparison history. Reads, inserts and updates were
-- already granted; only the owning creator can delete, exactly as with every
-- other operation on this table.
grant delete on public.video_comparisons to authenticated;

create policy "Creators can delete their own video comparisons"
  on public.video_comparisons for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Hands back usage the creator was charged for but never received: an
-- abandoned comparison, or an analysis that was stopped before it finished.
-- Floors at zero so a double refund (the client reporting the abandonment and
-- the server noticing the disconnect can both land) can never push a tally
-- negative and trip the table's check constraints. A missing row means nothing
-- was ever counted in that window, so there is nothing to refund and the
-- function returns zeroes without creating one. SECURITY DEFINER with a pinned
-- empty search_path, matching increment_usage_counters.
create or replace function public.refund_usage_counters(
  p_user_id uuid,
  p_period_start timestamptz,
  p_video_analyses integer,
  p_deep_credits integer
)
returns table (video_analyses_used integer, deep_credits_used integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.usage_counters as uc
    set video_analyses_used =
          greatest(uc.video_analyses_used - greatest(p_video_analyses, 0), 0),
        deep_credits_used =
          greatest(uc.deep_credits_used - greatest(p_deep_credits, 0), 0)
  where uc.user_id = p_user_id
    and uc.period_start = p_period_start
  returning uc.video_analyses_used, uc.deep_credits_used;
end;
$$;

-- Only the service role should ever call this; deny the public API roles.
revoke all on function public.refund_usage_counters(
  uuid, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.refund_usage_counters(
  uuid, timestamptz, integer, integer
) to service_role;
