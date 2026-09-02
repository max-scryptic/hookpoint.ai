-- Fold the tip categories down to the work they actually describe.
--
-- The first cut of this column followed the report: a tip read on the hook
-- window was filed under "Hook", one read on a drop-off under "Drop-offs", one
-- read on a gain or a hold under "Keeping attention", and the tab a row was
-- open on (Script, Deep analysis) overrode all three. That is four names for
-- one job. A creator working through their checklist is not doing hook work and
-- then separately drop-off work; the hook window, the drop-offs, the gains, the
-- holds and the pacing stretches are all asking for the same thing, which is
-- that a viewer stays. They are now one category, "Retention", and the list a
-- tip was read from decides it rather than the footage tab beneath the row. The
-- same fold applies to the title, the thumbnail and the spoken hook, which are
-- only ever worth judging against one another and are now read as "Packaging".
--
-- So 'hook' and 'retention' no longer exist and the rows holding them have to
-- move. Unlike a tuning of the rules -- which the column exists to protect a
-- checklist from, see 20260804160000_add_tip_category.sql -- this is the rename
-- itself: leaving the old rows behind would show a creator two half-empty
-- groups, "Hook" and "Drop-offs", that nothing new can ever be filed under.
--
-- The case below mirrors TIP_CATEGORY_RULES in lib/tips.ts, in its order: the
-- anchored report prefixes first, then packaging (so "Packaging: Hook" is read
-- as one of the three surfaces rather than as a retention moment), then the
-- tabs that stand on their own, then a loose catch for a retention word in a
-- heading that named its report some other way. It is repeated per table rather
-- than factored out for the same reason the first migration repeated it: three
-- short statements a reader can check against lib/tips.ts line by line.

update public.saved_tips set category = case
  when lower(section) ~ '^retention\M|^pacing\M' then 'attention'
  when lower(section) ~ 'packaging|thumbnails?|\mtitles?\M' then 'packaging'
  when lower(section) ~ '\mscripts?\M' then 'script'
  when lower(section) ~ 'deep analysis|non-?verbal|delivery|editing|visuals?\M'
    then 'delivery'
  when lower(section) ~
    'retention|drop-?offs?|\mgains?\M|\mholds?\M|pacing|attention'
    then 'attention'
  else 'other'
end;

update public.tip_feedback set category = case
  when lower(section) ~ '^retention\M|^pacing\M' then 'attention'
  when lower(section) ~ 'packaging|thumbnails?|\mtitles?\M' then 'packaging'
  when lower(section) ~ '\mscripts?\M' then 'script'
  when lower(section) ~ 'deep analysis|non-?verbal|delivery|editing|visuals?\M'
    then 'delivery'
  when lower(section) ~
    'retention|drop-?offs?|\mgains?\M|\mholds?\M|pacing|attention'
    then 'attention'
  else 'other'
end;

update public.tip_examples set category = case
  when lower(section) ~ '^retention\M|^pacing\M' then 'attention'
  when lower(section) ~ 'packaging|thumbnails?|\mtitles?\M' then 'packaging'
  when lower(section) ~ '\mscripts?\M' then 'script'
  when lower(section) ~ 'deep analysis|non-?verbal|delivery|editing|visuals?\M'
    then 'delivery'
  when lower(section) ~
    'retention|drop-?offs?|\mgains?\M|\mholds?\M|pacing|attention'
    then 'attention'
  else 'other'
end;

-- Retightened around what is left, so a category the interface cannot label can
-- still never be written.
alter table public.saved_tips
  drop constraint if exists saved_tips_category_check;
alter table public.saved_tips
  add constraint saved_tips_category_check check (
    category in ('attention', 'script', 'packaging', 'delivery', 'other')
  );

alter table public.tip_feedback
  drop constraint if exists tip_feedback_category_check;
alter table public.tip_feedback
  add constraint tip_feedback_category_check check (
    category in ('attention', 'script', 'packaging', 'delivery', 'other')
  );

alter table public.tip_examples
  drop constraint if exists tip_examples_category_check;
alter table public.tip_examples
  add constraint tip_examples_category_check check (
    category in ('attention', 'script', 'packaging', 'delivery', 'other')
  );
