-- The worked examples shown behind a "Try:" tip.
--
-- A tip is one line of advice ("Open on the specific claim rather than the
-- setup"), and a creator reading it still has to work out what that actually
-- looks like in their own video. Opening a tip now shows three concrete
-- examples of following it, written for the subject the creator makes videos
-- about.
--
-- Almost every tip now arrives with its examples already written: the prompt
-- that wrote the advice writes three demonstrations of it in the same response,
-- where the transcript, the thumbnail and the evidence are still in front of
-- the model, and they are stored with the report. This table serves the rest:
-- tips in reports generated before that existed, and the hand-written
-- deep-analysis tips, whose examples are written on demand instead.
--
-- This table is that on-demand generation, kept. Nothing here is a creator's
-- own data: the same advice met on two reports, by two creators, is the same
-- advice, so the examples are cached once and read back by everyone who opens
-- it. The second reader of a tip costs nothing and, just as importantly, sees
-- the same three examples the first one did.
--
-- WHAT MAKES A CACHED ROW THE RIGHT ANSWER
--
-- Three things, together, which is what the unique key is:
--
--   tip_fingerprint  the advice itself, normalised the way lib/tips.ts
--                    normalises it everywhere else, so the same tip written
--                    with different punctuation hits one row.
--   context_key      the video the tip was read on, because the examples are
--                    grounded in what that channel actually makes videos
--                    about. Empty when the tip was read somewhere with no one
--                    video behind it (a head-to-head report), where the
--                    examples are written from the advice alone.
--   prompt_hash      what the generating prompt said at the time. An admin
--                    editing the examples prompt in the Prompts page would
--                    otherwise be editing text that nothing re-reads, since
--                    every tip anyone had already opened would keep serving
--                    its cached answer forever. Hashing the resolved prompt
--                    into the key means an edit simply misses the cache and
--                    the next open regenerates.
--
-- Admin-only, exactly like the cost log: RLS is enabled with no policies at
-- all, so anon and authenticated clients match no row and can read and write
-- nothing. That, rather than the table grants, is what locks it: this project
-- carries default privileges that hand anon and authenticated the usual
-- table privileges on anything created in public, which cost_logs sits under
-- too, and which no grant statement here would undo. Every access goes through
-- the service-role client behind /api/tips/examples, which is also what lets
-- that route rate limit generation per creator.

create table public.tip_examples (
  id uuid primary key default gen_random_uuid(),
  -- The tip text normalised for comparison, exactly as saved_tips stores it
  -- (lower case, punctuation collapsed). One implementation of that rule, in
  -- lib/tips.ts, serves the checklist and this cache alike.
  tip_fingerprint text not null check (
    char_length(tip_fingerprint) between 1 and 500
  ),
  -- The YouTube video id the tip was read on, or '' where there was none.
  -- Not a foreign key: it names the context the examples were written for, and
  -- must outlive the analysis being deleted or re-run.
  context_key text not null default '' check (char_length(context_key) <= 100),
  -- Hex digest of the resolved generating prompt. See above.
  prompt_hash text not null check (char_length(prompt_hash) between 1 and 64),
  -- The tip as it was actually written, kept beside the fingerprint so this
  -- table can be read by a human without joining it back to a report.
  tip text not null check (char_length(tip) between 1 and 2000),
  section text not null check (char_length(section) between 1 and 200),
  category text not null default 'other' check (
    category in (
      'hook',
      'retention',
      'attention',
      'script',
      'packaging',
      'delivery',
      'other'
    )
  ),
  -- The three examples, as [{ label, example }]. Shape and bounds are enforced
  -- in lib/tip-examples.ts on the way in and again on the way out, so a row
  -- written by an older version of that shape can never reach the interface as
  -- something it cannot render.
  examples jsonb not null,
  -- Which model wrote them, for the same reason the cost log records one.
  model text,
  -- Who paid for the generation. Null once that account is deleted; the
  -- examples themselves are not theirs and stay. This is what the per-creator
  -- rate limit counts, so it is indexed by creator and recency.
  generated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tip_fingerprint, context_key, prompt_hash)
);

create index tip_examples_generated_by_idx
  on public.tip_examples (generated_by, created_at desc);

alter table public.tip_examples enable row level security;

-- Generating the examples is one more LLM call, so it needs to be a permitted
-- call_type in the cost log. Recreate the check constraint with it added,
-- keeping every previously permitted type.
alter table public.cost_logs
  drop constraint if exists cost_logs_call_type_check;

alter table public.cost_logs
  add constraint cost_logs_call_type_check check (
    call_type in (
      'pacing',
      'packaging_alignment',
      'packaging_taxonomy',
      'script_taxonomy',
      'script_comparison',
      'packaging_comparison',
      'retention_comparison',
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis',
      'transcript_taxonomy',
      'tip_examples'
    )
  );
