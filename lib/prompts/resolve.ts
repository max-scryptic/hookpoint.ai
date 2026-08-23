// =============================================================================
// RESOLVING A PROMPT AT SEND TIME
//
// Every call site that sends a prompt asks for it by key rather than importing
// the text, so an override saved in the admin Prompts page reaches the next
// call without a deploy. Resolution is:
//
//   1. the newest version stored for that key, unless its content is null,
//      which is how "back to the shipped default" is recorded (see the
//      prompt_versions migration);
//   2. otherwise the default from lib/prompts/registry.ts.
//
// Then {{fragment}} placeholders are substituted, recursively resolved the same
// way, so editing the tip voice once changes every prompt that quotes it.
//
// FAILING OPEN
//
// A prompt is resolved in the middle of an analysis run that has already spent
// money on a transcode and a dozen other calls. If the database is unreachable
// the right answer is the shipped default, not a failed run, so every read here
// is best-effort: an error is logged and the default is used. The consequence
// is worth stating plainly - an outage silently reverts to shipped text rather
// than to whatever an admin last saved.
// =============================================================================

import { createAdminClient } from "@/lib/supabase/admin"
import { promptDefinition } from "@/lib/prompts/registry"

// How long a resolved override is trusted before the next call re-reads it.
// The point of a cache here is not the query cost (it is one small indexed read
// beside an LLM call that costs cents), it is that a single analysis run
// resolves the same prompt for every window it processes. Short enough that an
// admin saving an edit sees it take effect on the next run without a deploy.
const CACHE_TTL_MS = 30_000

type CacheEntry = { value: string | null; expiresAt: number }

// Keyed by prompt key. A null value is a cached "no override", which matters:
// without it, every prompt with no override re-queries on every call.
const cache = new Map<string, CacheEntry>()

// Test seam. Also called after an admin write so the editing admin sees their
// own change immediately rather than up to CACHE_TTL_MS later.
export function clearPromptCache(key?: string) {
  if (key) cache.delete(key)
  else cache.clear()
}

// The stored override for one key, or null when the prompt is running on its
// shipped default. Reads the newest version row and treats a null content as
// "reset to default" rather than as an empty prompt.
async function readOverride(key: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("content")
    .eq("prompt_key", key)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data?.content ?? null
}

async function cachedOverride(key: string): Promise<string | null> {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) return hit.value

  try {
    const value = await readOverride(key)
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS })
    return value
  } catch (error) {
    // Fail open on the shipped default, and cache that decision briefly so a
    // database outage does not add a failed query to every call in a run.
    console.error(`Failed to read prompt override for "${key}"`, error)
    cache.set(key, { value: null, expiresAt: now + CACHE_TTL_MS })
    return null
  }
}

const PLACEHOLDER_PATTERN = /\{\{([a-z0-9_]+)\}\}/g

// Substitutes {{fragment}} references. Depth is bounded rather than cycle-
// detected: fragments are one level deep today, and a bound means a prompt
// edited into quoting itself degrades to a leftover placeholder in the text
// instead of hanging the run that resolves it.
const MAX_FRAGMENT_DEPTH = 3

async function interpolate(text: string, depth: number): Promise<string> {
  if (depth > MAX_FRAGMENT_DEPTH || !text.includes("{{")) return text

  const keys = new Set<string>()
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) keys.add(match[1])
  if (keys.size === 0) return text

  const resolved = new Map<string, string>()
  await Promise.all(
    [...keys].map(async (key) => {
      // An unknown placeholder is left exactly as written. It is far better for
      // a typo to reach the prompt visibly than for it to blank a rule out.
      if (!promptDefinition(key)) return
      resolved.set(key, await resolveAt(key, depth + 1))
    }),
  )

  return text.replace(PLACEHOLDER_PATTERN, (whole, key: string) =>
    resolved.has(key) ? (resolved.get(key) as string) : whole,
  )
}

async function resolveAt(key: string, depth: number): Promise<string> {
  const definition = promptDefinition(key)
  if (!definition) {
    // Unregistered key: a programming error rather than a runtime condition.
    throw new Error(`Unknown prompt key "${key}"`)
  }

  const override = await cachedOverride(key)
  return interpolate(override ?? definition.default, depth)
}

/**
 * The live text for one registered prompt: the active override if there is one,
 * otherwise the shipped default, with every {{fragment}} substituted.
 */
export async function resolvePrompt(key: string): Promise<string> {
  return resolveAt(key, 0)
}

/**
 * The shipped default for a key, with fragments substituted from their own
 * shipped defaults. Used by the admin page to show what an override is being
 * compared against without a database round trip.
 */
export function defaultPromptText(key: string): string {
  const definition = promptDefinition(key)
  if (!definition) throw new Error(`Unknown prompt key "${key}"`)
  return definition.default.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    const fragment = promptDefinition(name)
    return fragment ? fragment.default : whole
  })
}
