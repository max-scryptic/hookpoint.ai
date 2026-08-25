// =============================================================================
// WORKED EXAMPLES FOR A TIP - THE SERVER HALF
//
// Writing the three examples behind a "Try:" tip, and keeping them.
//
// This is the only model call in the app a creator triggers directly, by
// clicking, so it is shaped around that rather than around a pipeline run:
//
//   - It is cached before it is generated. The same advice, read on the same
//     video, is the same three examples for everybody, so the second creator to
//     open a tip pays nothing and sees what the first one saw. See the
//     20260825120000_create_tip_examples migration for what makes a cached row
//     the right answer.
//   - Generation is rate limited per creator, counted in the table itself
//     rather than in memory, because there is more than one server.
//   - The cache is best-effort in both directions. A read that fails generates;
//     a write that fails is logged and the examples are still returned. The
//     migration is applied by hand, out of band from the deploy (see
//     scripts/check-applied-migrations.ts), so this code runs for a while
//     against a database with no tip_examples table in it and must simply work,
//     slightly more expensively, when it does.
//
// The client-safe half (the shape of an example, its bounds, the normalisation
// both sides share) is lib/tip-examples.ts. This module pulls the service-role
// client and must never reach a client bundle.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.
// =============================================================================

import { createHash } from "node:crypto"

import { recordLlmCallCost } from "@/lib/llm-calls"
import { responsesCallCost, type ResponsesUsage } from "@/lib/llm-cost"
import { resolvePrompt } from "@/lib/prompts/resolve"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  normaliseTipExamples,
  tipExamplesContextKey,
  TIP_EXAMPLES_COUNT,
  type TipExample,
} from "@/lib/tip-examples"
import { tipFingerprint, type TipCategory } from "@/lib/tips"

/** What the video behind a tip is about, as the model is told it. */
export interface TipExamplesVideoContext {
  // The YouTube video id, which is also the cache's context key.
  videoId: string
  title: string
  // Trimmed hard before it is sent: a description is mostly links, timestamps
  // and sponsor copy, and the first couple of lines are the part that says what
  // the channel makes videos about.
  description?: string | null
}

export interface TipExamplesRequest {
  tip: string
  section: string
  category: TipCategory
  video: TipExamplesVideoContext | null
  userId: string
}

export interface TipExamplesResult {
  examples: TipExample[]
  // Whether this answer came out of the cache. Returned so the route can say so
  // in its response, which is what makes the feature debuggable from a browser
  // without reading the cost log.
  cached: boolean
}

// How much of a video description is worth sending. Two or three lines of what
// the channel is about; past that it is link farm.
const DESCRIPTION_MAX_LENGTH = 600

// How many generations one creator may pay for in a rolling hour. A creator
// reading a report opens a handful of tips; a script hitting the endpoint would
// otherwise spend money in a loop. Counted in tip_examples itself, so it holds
// across instances, and only generations count: opening a hundred tips that are
// already cached costs nothing and is not limited.
//
// What it counts is the rows that were written, so a generation that fails
// before it stores anything is not counted against the creator who triggered
// it. That is the right way round for someone hitting an outage, and it does
// mean a caller who could make the model fail every time would not be limited
// by this. The realistic loop, a script asking for examples of tip after tip,
// stores a row each time and runs into it.
export const TIP_EXAMPLES_HOURLY_LIMIT = 60

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Raised when the creator has generated too many sets of examples in the last
// hour. Its own error type so the route can answer 429 rather than 500: this is
// the one failure here that is about the caller rather than about us.
export class TipExamplesRateLimitError extends Error {
  constructor() {
    super("Too many example requests. Try again in a little while.")
    this.name = "TipExamplesRateLimitError"
  }
}

const TIP_EXAMPLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["examples"],
  properties: {
    examples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "example"],
        properties: {
          label: { type: "string" },
          example: { type: "string" },
        },
      },
    },
  },
} as const

// The prompt is part of the cache key, so an admin editing it in the Prompts
// page is not editing text that nothing re-reads. Short digest: this is a cache
// key, not a signature, and the column holds 64 characters.
function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 32)
}

function extractOutputText(response: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}): string | null {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text
    }
  }
  return null
}

/**
 * The examples already stored for this tip in this context, or null when there
 * are none to read.
 *
 * Best-effort: any failure (including the table not existing yet) is a cache
 * miss, which costs a generation rather than the feature.
 */
async function readCachedExamples(
  fingerprint: string,
  contextKey: string,
  hash: string,
): Promise<TipExample[] | null> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("tip_examples")
      .select("examples")
      .eq("tip_fingerprint", fingerprint)
      .eq("context_key", contextKey)
      .eq("prompt_hash", hash)
      .maybeSingle()

    if (error) {
      console.error("Failed to read cached tip examples", error.message)
      return null
    }

    const examples = normaliseTipExamples(
      (data as { examples?: unknown } | null)?.examples,
    )
    // A row that normalises to nothing is a row this version cannot render, so
    // it is treated as a miss and overwritten by the generation that follows.
    return examples.length > 0 ? examples : null
  } catch (error) {
    console.error("Failed to read cached tip examples", error)
    return null
  }
}

// Keeps a generated set for everyone who opens the same tip next. Best-effort,
// and deliberately an upsert on the cache key: two creators can open the same
// tip at the same moment, and the loser of that race is storing the same answer
// rather than failing.
async function writeCachedExamples(params: {
  fingerprint: string
  contextKey: string
  promptHash: string
  tip: string
  section: string
  category: TipCategory
  examples: TipExample[]
  model: string
  userId: string
}): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from("tip_examples").upsert(
      {
        tip_fingerprint: params.fingerprint,
        context_key: params.contextKey,
        prompt_hash: params.promptHash,
        tip: params.tip,
        section: params.section,
        category: params.category,
        examples: params.examples,
        model: params.model,
        generated_by: params.userId,
      },
      { onConflict: "tip_fingerprint,context_key,prompt_hash" },
    )
    if (error) {
      console.error("Failed to cache tip examples", error.message)
    }
  } catch (error) {
    console.error("Failed to cache tip examples", error)
  }
}

/**
 * Whether this creator has room to pay for another generation.
 *
 * Fails open. The count is a guard against a script, not an entitlement, and a
 * database that cannot answer it must not take a working feature down with it.
 */
async function withinRateLimit(userId: string): Promise<boolean> {
  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
    const { count, error } = await supabase
      .from("tip_examples")
      .select("id", { count: "exact", head: true })
      .eq("generated_by", userId)
      .gte("created_at", since)

    if (error) {
      console.error("Failed to check tip example rate limit", error.message)
      return true
    }
    return (count ?? 0) < TIP_EXAMPLES_HOURLY_LIMIT
  } catch (error) {
    console.error("Failed to check tip example rate limit", error)
    return true
  }
}

/**
 * The three worked examples for one tip: read from the cache where they have
 * been written before, generated and cached where they have not.
 *
 * Throws when the model call fails or returns something unusable, so the popup
 * can say the examples could not be written rather than showing an empty strip
 * of tabs. The two actions under it keep working either way, which is the point
 * of them living outside this call.
 */
export async function getOrGenerateTipExamples(
  request: TipExamplesRequest,
): Promise<TipExamplesResult> {
  const tip = request.tip.trim()
  const fingerprint = tipFingerprint(tip)
  const contextKey = tipExamplesContextKey(request.video?.videoId)

  const instructions = await resolvePrompt("tip_examples")
  const hash = promptHash(instructions)

  const cached = await readCachedExamples(fingerprint, contextKey, hash)
  if (cached) return { examples: cached, cached: true }

  if (!(await withinRateLimit(request.userId))) {
    throw new TipExamplesRateLimitError()
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const model = process.env.OPENAI_TIP_EXAMPLES_MODEL ?? "gpt-4.1-mini"

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 1_200,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: instructions }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                tip,
                // Both are sent: the section says where on a report the advice
                // was read, the category what kind of advice it is, and the two
                // together are what tells the model whether an example should
                // be a spoken line, a title, or a cut.
                section: request.section,
                category: request.category,
                video: request.video
                  ? {
                      title: request.video.title,
                      description:
                        request.video.description
                          ?.slice(0, DESCRIPTION_MAX_LENGTH)
                          .trim() || undefined,
                    }
                  : null,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "tip_examples",
          strict: true,
          schema: TIP_EXAMPLES_SCHEMA,
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `OpenAI tip examples failed (${response.status}): ${detail.slice(0, 500)}`,
    )
  }

  const json = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    usage?: ResponsesUsage
  }

  // Logged against the creator but not against a video: this is not part of any
  // analysis, and attributing it to one would inflate that video's light
  // analysis cost with spend that has nothing to do with the run.
  await recordLlmCallCost("tip_examples", responsesCallCost(model, json.usage), {
    userId: request.userId,
  })

  const outputText = extractOutputText(json)
  if (!outputText) throw new Error("OpenAI returned no tip examples")

  const parsed = JSON.parse(outputText) as { examples?: unknown }
  const examples = normaliseTipExamples(parsed.examples)
  if (examples.length === 0) {
    throw new Error("OpenAI returned no usable tip examples")
  }

  // Fewer than three is still worth showing and still worth keeping: a strip of
  // two examples reads fine, and paying again on the next open would not make a
  // third one appear.
  if (examples.length < TIP_EXAMPLES_COUNT) {
    console.warn(
      `Tip examples returned ${examples.length} usable examples for "${tip.slice(0, 80)}"`,
    )
  }

  await writeCachedExamples({
    fingerprint,
    contextKey,
    promptHash: hash,
    tip,
    section: request.section,
    category: request.category,
    examples,
    model,
    userId: request.userId,
  })

  return { examples, cached: false }
}
