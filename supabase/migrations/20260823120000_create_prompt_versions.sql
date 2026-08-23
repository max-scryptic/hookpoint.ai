-- The changelog behind the admin Prompts page: every prompt the app sends to a
-- model can be edited without a deploy, and every edit is kept.
--
-- APPEND ONLY, AND THE NEWEST ROW IS THE LIVE ONE
--
-- There is no is_active flag and no pointer table. The highest version for a
-- key is what lib/prompts/resolve.ts sends, which makes the history and the
-- live state the same object: reading the table tells you both what is running
-- and how it got there, and there is no way for the two to disagree.
--
-- Reverting to an earlier version therefore appends a new version carrying that
-- older text, the way a revert commit works, rather than moving a pointer
-- backwards. reverted_from_version records which one it came from so the admin
-- timeline can say "reverted to v3" instead of showing an unexplained edit.
--
-- WHY content IS NULLABLE
--
-- A null content means "run the shipped default from lib/prompts/registry.ts".
-- That is how "reset to default" is recorded, and it has to be a null rather
-- than a copy of the default text: a copy would pin today's default forever, so
-- a later deploy that improves the shipped prompt would silently not reach any
-- prompt that had ever been reset. A null keeps following the code.
--
-- prompt_key is deliberately not a foreign key to anything. The set of prompts
-- lives in the code registry, not in the database, so a key here can outlive a
-- prompt that was removed from the app, and the history of a since-renamed
-- prompt stays readable rather than being deleted by a cascade.
create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null check (char_length(prompt_key) between 1 and 100),
  -- 1-based per key, assigned by next_prompt_version below.
  version integer not null check (version > 0),
  -- The prompt text this version made live, or null for "back to the shipped
  -- default". Capped well above the longest prompt we send (~14k characters)
  -- so a paste accident cannot store something unbounded.
  content text check (content is null or char_length(content) <= 100000),
  -- Why the change was made, written by the admin making it.
  note text check (note is null or char_length(note) <= 1000),
  -- How this version came about, which is what the admin timeline labels each
  -- entry with: a hand edit, a revert to an earlier version, or a reset back to
  -- the shipped default.
  source text not null check (source in ('edit', 'revert', 'reset')),
  -- Set only for source = 'revert': the version whose text was brought back.
  reverted_from_version integer check (
    reverted_from_version is null or reverted_from_version > 0
  ),
  -- The admin who made the change. Kept on delete set null so removing an
  -- account does not take the prompt history with it.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (prompt_key, version),
  -- A reset carries no text and an edit always carries some; a revert carries
  -- whatever the version it came from carried, so it is left unconstrained.
  constraint prompt_versions_reset_has_no_content check (
    source <> 'reset' or content is null
  ),
  constraint prompt_versions_edit_has_content check (
    source <> 'edit' or content is not null
  ),
  constraint prompt_versions_revert_names_a_version check (
    (source = 'revert') = (reverted_from_version is not null)
  )
);

-- The resolver's read: newest version for one key, on every LLM call that is
-- not served from its in-process cache. The unique constraint above already
-- indexes (prompt_key, version); this makes the descending scan a single row.
create index prompt_versions_latest_idx
  on public.prompt_versions (prompt_key, version desc);

alter table public.prompt_versions enable row level security;

-- No grants to `authenticated` or `anon`, and so no policies: this table is
-- reached only through the service-role client, from server code that has
-- already established the caller is an admin (see requireAdminUser in
-- lib/admin/auth.ts). RLS is enabled anyway so that a future grant cannot
-- accidentally open the table to every signed-in user.

-- Allocates the next version number for a key and inserts the row, so two
-- admins saving at the same moment cannot both compute the same version and
-- have one of them lose the unique constraint.
--
-- The transaction-scoped advisory lock is what serialises them. Selecting
-- max(version) with `for update` would not: on the first save for a key there
-- are no rows to lock, so two concurrent inserts would both read 0 and both try
-- to write version 1. The lock is taken on the key itself, so writers to
-- different prompts never wait on each other.
create function public.append_prompt_version(
  p_prompt_key text,
  p_content text,
  p_note text,
  p_source text,
  p_reverted_from_version integer,
  p_created_by uuid
)
returns public.prompt_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_row public.prompt_versions;
begin
  perform pg_advisory_xact_lock(hashtext('prompt_versions:' || p_prompt_key));

  select coalesce(max(version), 0) + 1
    into v_next
    from public.prompt_versions
   where prompt_key = p_prompt_key;

  insert into public.prompt_versions (
    prompt_key, version, content, note, source, reverted_from_version, created_by
  )
  values (
    p_prompt_key, v_next, p_content, p_note, p_source, p_reverted_from_version,
    p_created_by
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Callable only by the service role, matching the table's own access model.
revoke all on function public.append_prompt_version(
  text, text, text, text, integer, uuid
) from public, anon, authenticated;
