-- The first-analysis coach mark was one hint key behind two bubbles: one on the
-- Analyse a Video page's URL box, one on the actions menu of an uploads row.
-- Closing either bubble recorded the shared key, which took the other bubble
-- down with it - so waving off the answer to "what is this menu for" silently
-- withdrew the answer to "what do I do with this box" as well.
--
-- The interface now keys them separately (see ONBOARDING_HINTS in
-- lib/onboarding-hints.ts), so each is dismissed on its own. A hint is pending
-- while its row is absent, which means the two new keys would otherwise ship as
-- "not yet seen" to every creator who has already met the old one. This carries
-- their answer across: whoever met first_video_analysis has met both halves of
-- it, and the pair should not come back.
--
-- The old rows are left where they are rather than deleted. A key the interface
-- no longer knows reads as nothing at all (getPendingOnboardingHints filters
-- against ONBOARDING_HINTS), and keeping it means this migration can be re-run
-- and stays readable as the record of what a creator actually dismissed.
insert into public.onboarding_hints (user_id, hint, seen_at)
select
  user_id,
  new_hint,
  seen_at
from
  public.onboarding_hints
  cross join (
    values ('first_video_analysis_url'), ('first_video_analysis_row_menu')
  ) as split (new_hint)
where
  hint = 'first_video_analysis'
on conflict (user_id, hint) do nothing;
