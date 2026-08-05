-- The interface prints "Try:" in front of every tip, so a tip whose own first
-- word is "Try" reads it twice: "Try: Try opening with a split-screen". The
-- comparison report prompts now ask for the plain command the video analysis
-- tips are written in, and cleanCopy (lib/copy-guardrails.ts) unwinds the
-- opener at render time for the reports already stored.
--
-- A tip the creator kept or flagged is different: it was copied out of the
-- report into a table of its own, and the checklist renders it exactly as it
-- was saved. So those rows are rewritten here, by the same rule, for two
-- reasons: the checklist reads the way the report it came from now does, and
-- the fingerprint keeps matching, so the tip on the report still shows as
-- already saved rather than offering to save a second copy of itself.
--
-- Only the two shapes the rule can turn back into a command are touched:
-- "Try opening with X" (a gerund, put back into the command form) and
-- "Try to open with X" (the command is already there, so only the opener
-- goes). Anything else keeps its wording rather than being left a fragment.

create function public.tip_command_form(tip text) returns text
language sql
immutable
as $$
  select coalesce(
    -- "Try opening with X" -> "Open with X".
    (
      select upper(left(m.imperative, 1))
             || substr(m.imperative, 2)
             || regexp_replace(tip, '^try\s+' || m.gerund || '\M', '', 'i')
      from (
        values
          ('adding', 'add'),
          ('avoiding', 'avoid'),
          ('breaking', 'break'),
          ('building', 'build'),
          ('closing', 'close'),
          ('cutting', 'cut'),
          ('delivering', 'deliver'),
          ('focusing', 'focus'),
          ('framing', 'frame'),
          ('front-loading', 'front-load'),
          ('holding', 'hold'),
          ('including', 'include'),
          ('incorporating', 'incorporate'),
          ('keeping', 'keep'),
          ('leading', 'lead'),
          ('maintaining', 'maintain'),
          ('making', 'make'),
          ('moving', 'move'),
          ('naming', 'name'),
          ('opening', 'open'),
          ('pacing', 'pace'),
          ('placing', 'place'),
          ('putting', 'put'),
          ('showing', 'show'),
          ('signposting', 'signpost'),
          ('starting', 'start'),
          ('stating', 'state'),
          ('trimming', 'trim'),
          ('using', 'use'),
          ('writing', 'write')
      ) as m(gerund, imperative)
      where tip ~* ('^try\s+' || m.gerund || '\M')
      limit 1
    ),
    -- "Try to open with X" / "Try and open with X" -> "Open with X".
    (
      select upper(left(rest, 1)) || substr(rest, 2)
      from (
        select regexp_replace(tip, '^try\s+(to|and)\s+', '', 'i') as rest
      ) as stripped
      where tip ~* '^try\s+(to|and)\s+'
    ),
    tip
  );
$$;

-- The same normalisation tipFingerprint() applies in lib/tips.ts: lower case,
-- every run of anything else collapsed to a single space, capped at 500.
create function public.tip_fingerprint(tip text) returns text
language sql
immutable
as $$
  select left(btrim(regexp_replace(lower(tip), '[^a-z0-9]+', ' ', 'g')), 500);
$$;

-- Skips a rewrite that would collide with something the same creator has
-- already saved in the command form: the unique constraint is what stops one
-- piece of advice sitting on a checklist twice, and the row met again here is
-- that same advice.
update public.saved_tips as s
set tip = public.tip_command_form(s.tip),
    tip_fingerprint = public.tip_fingerprint(public.tip_command_form(s.tip)),
    updated_at = now()
where public.tip_command_form(s.tip) is distinct from s.tip
  and not exists (
    select 1
    from public.saved_tips as other
    where other.user_id = s.user_id
      and other.id <> s.id
      and other.tip_fingerprint
        = public.tip_fingerprint(public.tip_command_form(s.tip))
  );

-- Flags are insert-only and carry no fingerprint, so this is only about the
-- admin reading back the same wording the creator was shown.
update public.tip_feedback as f
set tip = public.tip_command_form(f.tip)
where public.tip_command_form(f.tip) is distinct from f.tip;

drop function public.tip_command_form(text);
drop function public.tip_fingerprint(text);
