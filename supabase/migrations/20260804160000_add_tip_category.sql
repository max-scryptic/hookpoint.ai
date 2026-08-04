-- What each kept or flagged tip is actually about, next to the section it was
-- read in.
--
-- The section says where a tip came from ("Retention: Drop-off: Script"); the
-- category says what it is for (a script fix). A creator works through their
-- checklist by the second one, and the admin reads the flags by it, so it is
-- stored per row rather than recomputed on read: the rules that derive it live
-- in lib/tips.ts and will be tuned, and tuning them must not silently reshuffle
-- a checklist a creator has already been working from.
--
-- Written by the API routes from the section, never taken from the client.

alter table public.saved_tips
  add column category text not null default 'other'
  check (
    category in (
      'hook',
      'retention',
      'attention',
      'script',
      'packaging',
      'delivery',
      'other'
    )
  );

alter table public.tip_feedback
  add column category text not null default 'other'
  check (
    category in (
      'hook',
      'retention',
      'attention',
      'script',
      'packaging',
      'delivery',
      'other'
    )
  );

-- Backfill the rows saved before the column existed. This mirrors
-- tipCategoryForSection in lib/tips.ts, including its order: the tab a tip sat
-- on (Script, Deep analysis) decides before anything else in the section can,
-- drop-offs are separated from gains and holds, and a bare "Retention: ..."
-- only lands on retention once every more specific rule has missed.
update public.saved_tips set category = case
  when lower(section) ~ '\mscripts?\M' then 'script'
  when lower(section) ~ 'deep analysis|non-?verbal|delivery|editing|visuals?\M'
    then 'delivery'
  when lower(section) ~ '\mhooks?\M|\mopenings?\M|first (few )?seconds' then 'hook'
  when lower(section) ~ 'packaging|thumbnails?|\mtitles?\M' then 'packaging'
  when lower(section) ~ 'drop-?offs?|\mdrops?\M' then 'retention'
  when lower(section) ~ '\mgains?\M|\mholds?\M|pacing|attention' then 'attention'
  when lower(section) ~ 'retention' then 'retention'
  else 'other'
end;

update public.tip_feedback set category = case
  when lower(section) ~ '\mscripts?\M' then 'script'
  when lower(section) ~ 'deep analysis|non-?verbal|delivery|editing|visuals?\M'
    then 'delivery'
  when lower(section) ~ '\mhooks?\M|\mopenings?\M|first (few )?seconds' then 'hook'
  when lower(section) ~ 'packaging|thumbnails?|\mtitles?\M' then 'packaging'
  when lower(section) ~ 'drop-?offs?|\mdrops?\M' then 'retention'
  when lower(section) ~ '\mgains?\M|\mholds?\M|pacing|attention' then 'attention'
  when lower(section) ~ 'retention' then 'retention'
  else 'other'
end;
