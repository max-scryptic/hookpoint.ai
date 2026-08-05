-- Where each kept tip sits in the creator's own running order.
--
-- The checklist stopped being a list of things to tick off and became a
-- reference list: the tips a creator wants beside them while planning the next
-- video, in the order they intend to work through them. That order is theirs to
-- set, so it is stored rather than derived from when a tip happened to be
-- saved.
--
-- Written by the API route, which renumbers the whole list from 0 on every
-- reorder. Ties are still possible (a newly saved tip lands on 0), so every
-- read orders by created_at after position, newest first.

-- saved_tips.completed_at is left in place on purpose. Nothing reads or writes
-- it any more now that tips are not ticked off, and dropping it would throw
-- away what creators had already marked done; it can go in its own migration
-- once that history is genuinely not wanted.

alter table public.saved_tips
  add column position integer not null default 0;

-- Seed the order with what the checklist was already showing, newest first, so
-- nobody's list is reshuffled by this migration.
with ordered as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc, id
    ) - 1 as rank
  from public.saved_tips
)
update public.saved_tips
set position = ordered.rank
from ordered
where public.saved_tips.id = ordered.id;

-- The checklist reads one creator's tips in their order, which is now the only
-- query this table serves.
create index saved_tips_user_position_idx
  on public.saved_tips (user_id, position, created_at desc);

drop index if exists saved_tips_user_created_idx;
