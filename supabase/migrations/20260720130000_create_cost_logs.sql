-- Account-wide log of every paid AI/media cost the platform incurs, so the
-- admin area can show exactly which calls we run and what they cost. Each row
-- is one cost event: the user it was run for, the broad cost_type (an LLM call
-- vs a Qencode transcode), the specific call_type for LLM calls (light pacing /
-- packaging analysis, the per-window deep-analysis vision/audio/synthesis
-- calls), the model/provider, token counts and the derived dollar cost, and the
-- moment it happened.
--
-- This is an append-only audit/accounting log, distinct from
-- retention_window_costs: that table upserts one row per (window, step) so a
-- re-run overwrites the previous figure, whereas here every attempt is kept so
-- the true spend over any time window is recoverable. The two are written
-- together for deep-analysis calls (see lib/llm-calls.ts).
--
-- user_id is nullable and ON DELETE SET NULL, and the user's email is
-- denormalised onto the row, so deleting an account never erases its recorded
-- spend and the admin table can still name who a historical call was for.
--
-- cost_usd is stored already-computed (tokens * per-model rate, or minutes *
-- per-minute transcoding rate) rather than derived on read: the rate cards move
-- over time, and a persisted figure captures what the call actually cost when
-- it ran.

create table public.cost_logs (
  id uuid primary key default gen_random_uuid(),
  -- Who the cost was run for. Kept (set null) when the account is deleted so
  -- accounting history survives; user_email preserves the human identity.
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  -- Optional link back to the video the cost was part of, when there is one.
  analysed_video_id uuid,
  -- The broad category of cost. Kept in sync with CostType in
  -- lib/llm-call-types.ts. 'llm_call' for OpenAI calls, 'qencode_transcode' for
  -- Qencode transcoding.
  cost_type text not null check (
    cost_type in ('llm_call', 'qencode_transcode')
  ),
  -- The specific kind of LLM call. Kept in sync with LlmCallType in
  -- lib/llm-call-types.ts. Null for cost types with no such breakdown (e.g. a
  -- Qencode transcode), which is why it is nullable and excludes 'transcoding'.
  call_type text check (
    call_type in (
      'pacing',
      'packaging_alignment',
      'packaging_taxonomy',
      'retention_attribution',
      'snapshot',
      'audio',
      'event_synthesis'
    )
  ),
  -- Which vendor was billed. 'openai' for LLM calls, 'qencode' for transcoding.
  provider text not null default 'openai',
  -- Model for LLM calls; null for transcoding (which has no model).
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  -- When the cost was incurred. Explicit column (not just created_at) so the
  -- admin datetime-window filter reads naturally, though they are the same
  -- instant.
  created_at timestamptz not null default now()
);

-- Admin listing filters and orders by time, user, cost type and call type.
create index cost_logs_created_at_idx on public.cost_logs (created_at desc);
create index cost_logs_user_id_idx on public.cost_logs (user_id);
create index cost_logs_cost_type_idx on public.cost_logs (cost_type);
create index cost_logs_call_type_idx on public.cost_logs (call_type);

-- Locked down: this is an admin-only accounting table. RLS is enabled with no
-- policies, so anon/authenticated clients can read or write nothing; every
-- access goes through the service-role client used by the admin server code
-- (which first verifies the caller is an admin) and by the logging helper.
alter table public.cost_logs enable row level security;
