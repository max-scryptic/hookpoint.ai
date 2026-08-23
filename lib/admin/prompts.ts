import { createAdminClient } from "@/lib/supabase/admin"
import { clearPromptCache, defaultPromptText } from "@/lib/prompts/resolve"
import {
  PROMPT_DEFINITIONS,
  promptDefinition,
  type PromptDefinition,
  type PromptGroup,
  type PromptRole,
} from "@/lib/prompts/registry"

// Reads and writes for the admin Prompts page. Uses the service-role client, so
// it bypasses Row Level Security and MUST only be called from server code that
// has already verified the caller is an admin (see requireAdminUser in
// lib/admin/auth.ts).

// One entry in a prompt's changelog. `content` is null on a reset, which is how
// "back to the shipped default" is recorded rather than by copying the default
// text (see the prompt_versions migration).
export type PromptVersion = {
  id: string
  version: number
  content: string | null
  note: string | null
  source: "edit" | "revert" | "reset"
  revertedFromVersion: number | null
  authorEmail: string | null
  createdAt: string
}

// A prompt as the admin list renders it: its registry metadata, whether an
// override is live, and enough of the history to show when it last changed.
export type AdminPromptSummary = {
  key: string
  label: string
  group: PromptGroup
  role: PromptRole
  description: string
  source: string
  modelEnvVar: string | null
  // True when the live text comes from a stored version rather than the code.
  isOverridden: boolean
  // The live version number, or null while the prompt runs on its default.
  activeVersion: number | null
  // How many versions have been saved, including resets.
  versionCount: number
  lastEditedAt: string | null
  lastEditedBy: string | null
  // Character count of the live text, fragments substituted. A useful glance at
  // whether an edit has doubled the size of what gets sent.
  length: number
}

export type AdminPromptDetail = AdminPromptSummary & {
  // The live text, fragments substituted, exactly as the next call would send it.
  resolvedText: string
  // The live text as stored, fragments left as {{placeholders}}. This is what
  // the editor loads, so saving an edit cannot accidentally inline a fragment.
  editableText: string
  // The shipped default, fragments substituted, to diff an override against.
  defaultText: string
  // The shipped default as written, fragments left as placeholders.
  defaultSource: string
  // Fragment keys this prompt quotes, with their labels, for the editor's hint.
  fragments: { key: string; label: string }[]
  // Which other prompts quote this one. Only ever non-empty for a fragment, and
  // the reason editing one needs a warning rather than a quiet save.
  quotedBy: { key: string; label: string }[]
  versions: PromptVersion[]
}

type VersionRow = {
  id: string
  prompt_key: string
  version: number
  content: string | null
  note: string | null
  source: string
  reverted_from_version: number | null
  created_by: string | null
  created_at: string
}

function toVersion(row: VersionRow, emails: Map<string, string>): PromptVersion {
  return {
    id: row.id,
    version: row.version,
    content: row.content,
    note: row.note,
    source:
      row.source === "revert" || row.source === "reset" ? row.source : "edit",
    revertedFromVersion: row.reverted_from_version,
    authorEmail: row.created_by ? (emails.get(row.created_by) ?? null) : null,
    createdAt: row.created_at,
  }
}

// The admin emails behind a set of author ids, for the changelog byline. Missing
// ids are simply left unnamed: an author whose account was deleted still has
// their versions listed, just without an email against them.
async function authorEmails(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .in("id", unique)

  if (error) {
    console.error("Failed to read prompt version authors", error)
    return new Map()
  }

  return new Map(
    (data ?? [])
      .filter((row): row is { id: string; email: string } =>
        Boolean(row.email),
      )
      .map((row) => [row.id, row.email]),
  )
}

// The stored text for a key, or null when it runs on its default. Mirrors the
// resolver's rule that a null content means "reset", not "empty prompt".
function activeRow(rows: VersionRow[]): VersionRow | null {
  const newest = rows[0]
  if (!newest || newest.content === null) return null
  return newest
}

// Substitutes fragment placeholders for display. The resolver does this against
// live overrides; here it is done against whatever text is passed, so the admin
// preview of an unsaved default matches what would actually be sent.
function substituteFragments(
  text: string,
  fragmentText: Map<string, string>,
): string {
  return text.replace(/\{\{([a-z0-9_]+)\}\}/g, (whole, key: string) =>
    fragmentText.get(key) ?? whole,
  )
}

// Every version row in the table, newest first per key. The whole table is one
// small read: a prompt changes a handful of times a month, not a second.
async function allVersions(): Promise<Map<string, VersionRow[]>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("prompt_versions")
    .select(
      "id, prompt_key, version, content, note, source, reverted_from_version, created_by, created_at",
    )
    .order("version", { ascending: false })

  if (error) {
    // A prompts page that cannot reach the history still has a job to do: show
    // every prompt on its shipped default, which is also what the pipeline is
    // sending in that situation.
    console.error("Failed to read prompt versions", error)
    return new Map()
  }

  const byKey = new Map<string, VersionRow[]>()
  for (const row of (data ?? []) as VersionRow[]) {
    const list = byKey.get(row.prompt_key)
    if (list) list.push(row)
    else byKey.set(row.prompt_key, [row])
  }
  return byKey
}

// The live text of every fragment, for substitution into the previews below.
function fragmentTextMap(versions: Map<string, VersionRow[]>): Map<string, string> {
  const map = new Map<string, string>()
  for (const definition of PROMPT_DEFINITIONS) {
    if (definition.role !== "fragment") continue
    const active = activeRow(versions.get(definition.key) ?? [])
    map.set(definition.key, active?.content ?? definition.default)
  }
  return map
}

function summarise(
  definition: PromptDefinition,
  rows: VersionRow[],
  emails: Map<string, string>,
  fragmentText: Map<string, string>,
): AdminPromptSummary {
  const active = activeRow(rows)
  const newest = rows[0] ?? null
  const liveText = active?.content ?? definition.default

  return {
    key: definition.key,
    label: definition.label,
    group: definition.group,
    role: definition.role,
    description: definition.description,
    source: definition.source,
    modelEnvVar: definition.modelEnvVar,
    isOverridden: active !== null,
    activeVersion: active?.version ?? null,
    versionCount: rows.length,
    lastEditedAt: newest?.created_at ?? null,
    lastEditedBy: newest?.created_by
      ? (emails.get(newest.created_by) ?? null)
      : null,
    length: substituteFragments(liveText, fragmentText).length,
  }
}

/** Every registered prompt with its override state, in registry order. */
export async function listPrompts(): Promise<AdminPromptSummary[]> {
  const versions = await allVersions()
  const emails = await authorEmails(
    [...versions.values()].flatMap((rows) =>
      rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)),
    ),
  )
  const fragmentText = fragmentTextMap(versions)

  return PROMPT_DEFINITIONS.map((definition) =>
    summarise(definition, versions.get(definition.key) ?? [], emails, fragmentText),
  )
}

/** One prompt with its full changelog, or null when the key is not registered. */
export async function getPrompt(key: string): Promise<AdminPromptDetail | null> {
  const definition = promptDefinition(key)
  if (!definition) return null

  const versions = await allVersions()
  const rows = versions.get(key) ?? []
  const emails = await authorEmails(
    rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)),
  )
  const fragmentText = fragmentTextMap(versions)

  const active = activeRow(rows)
  const editableText = active?.content ?? definition.default

  return {
    ...summarise(definition, rows, emails, fragmentText),
    resolvedText: substituteFragments(editableText, fragmentText),
    editableText,
    defaultText: defaultPromptText(key),
    defaultSource: definition.default,
    fragments: definition.fragments.flatMap((fragmentKey) => {
      const fragment = promptDefinition(fragmentKey)
      return fragment ? [{ key: fragment.key, label: fragment.label }] : []
    }),
    quotedBy: PROMPT_DEFINITIONS.filter((other) =>
      other.fragments.includes(key),
    ).map((other) => ({ key: other.key, label: other.label })),
    versions: rows.map((row) => toVersion(row, emails)),
  }
}

export type SavePromptResult =
  | { ok: true; version: number }
  | { ok: false; error: string }

type AppendArgs = {
  key: string
  content: string | null
  note: string | null
  source: "edit" | "revert" | "reset"
  revertedFromVersion: number | null
  adminId: string
}

// Every write goes through the append_prompt_version function rather than a
// plain insert, so the version number is allocated under a per-key lock (see
// the migration) instead of being read and written in two round trips.
async function append({
  key,
  content,
  note,
  source,
  revertedFromVersion,
  adminId,
}: AppendArgs): Promise<SavePromptResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("append_prompt_version", {
    p_prompt_key: key,
    p_content: content,
    p_note: note,
    p_source: source,
    p_reverted_from_version: revertedFromVersion,
    p_created_by: adminId,
  })

  if (error) {
    console.error(`Failed to append prompt version for "${key}"`, error)
    return { ok: false, error: "Could not save this prompt. Please try again." }
  }

  // The editing admin is about to look at the page they just saved from, so
  // drop the resolver's cached copy rather than let it read as unchanged for
  // another half minute. Only clears this process; other instances age out.
  clearPromptCache(key)

  const row = (Array.isArray(data) ? data[0] : data) as { version: number } | null
  return { ok: true, version: row?.version ?? 0 }
}

// A prompt is sent verbatim to a model, so the only shape rules worth enforcing
// are the ones that would break the call or the schema behind it.
const MAX_PROMPT_LENGTH = 100_000

export function validatePromptContent(content: string): string | null {
  const trimmed = content.trim()
  if (trimmed.length === 0) return "A prompt cannot be empty."
  if (content.length > MAX_PROMPT_LENGTH) {
    return `A prompt cannot be longer than ${MAX_PROMPT_LENGTH.toLocaleString()} characters.`
  }
  return null
}

/** Saves an edited prompt as the newest version, making it live immediately. */
export async function savePrompt(
  key: string,
  content: string,
  note: string | null,
  adminId: string,
): Promise<SavePromptResult> {
  if (!promptDefinition(key)) return { ok: false, error: "Unknown prompt." }

  const invalid = validatePromptContent(content)
  if (invalid) return { ok: false, error: invalid }

  return append({
    key,
    content,
    note: note?.trim() || null,
    source: "edit",
    revertedFromVersion: null,
    adminId,
  })
}

/**
 * Brings an earlier version's text back by appending it as a new version, the
 * way a revert commit works. The history is never rewritten, so the record of
 * what was live and when stays intact.
 */
export async function revertPrompt(
  key: string,
  targetVersion: number,
  adminId: string,
): Promise<SavePromptResult> {
  if (!promptDefinition(key)) return { ok: false, error: "Unknown prompt." }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("content, source")
    .eq("prompt_key", key)
    .eq("version", targetVersion)
    .maybeSingle()

  if (error) {
    console.error(`Failed to read prompt version ${targetVersion} of "${key}"`, error)
    return { ok: false, error: "Could not read that version. Please try again." }
  }
  if (!data) return { ok: false, error: "That version no longer exists." }

  // Reverting to a reset means going back to the shipped default, which is
  // recorded as a reset rather than as a revert carrying null text: the two
  // mean the same thing to the resolver, and the constraint on the table only
  // allows a null content under 'reset'.
  if (data.content === null) return resetPrompt(key, adminId)

  return append({
    key,
    content: data.content,
    note: `Reverted to v${targetVersion}`,
    source: "revert",
    revertedFromVersion: targetVersion,
    adminId,
  })
}

/**
 * Drops the override so the prompt follows the shipped default again. Recorded
 * as a version with no content, so the default it follows is whatever the code
 * says today rather than whatever it said at the moment of the reset.
 */
export async function resetPrompt(
  key: string,
  adminId: string,
): Promise<SavePromptResult> {
  if (!promptDefinition(key)) return { ok: false, error: "Unknown prompt." }

  return append({
    key,
    content: null,
    note: "Reset to the shipped default",
    source: "reset",
    revertedFromVersion: null,
    adminId,
  })
}
