// =============================================================================
// WORKED EXAMPLES FOR A TIP - THE PURE HALF
//
// A "Try:" tip is one line of advice. Opening it shows three worked examples of
// following that advice, tabbed through inside the tip's own popup:
//
//   Try: Open on the specific claim rather than the setup
//     -> Straight to the number    "This deck won me eleven games in a row."
//     -> Open on the obstacle      "Everyone says this matchup is unwinnable."
//     -> Open mid-action           Cut in on the play already happening ...
//
// The advice tells a creator what to do; an example is what it looks like once
// done, in words they could say out loud or paste into a title. That is the
// whole feature: a tip nobody can picture is a tip nobody acts on.
//
// This module is the client-safe half: the shape of an example, the bounds it
// is held to, and the normalisation every example passes through whether it
// arrives from a model, from the cache, or from an API response. It imports
// nothing but the copy guardrails, so the popup that renders examples and the
// server that generates them share one definition of what an example is.
//
// The generation and the cache live in lib/tip-examples-generation.ts, which
// pulls the service-role client and must never reach a client bundle. Same
// split as lib/llm-call-types.ts and lib/llm-calls.ts.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.
// =============================================================================

import { stripEmDashes } from "@/lib/copy-guardrails"

/**
 * One worked example of following a tip.
 *
 * The label is what the tab reads, so it names the approach rather than
 * numbering it: three tabs reading "1 2 3" tell a creator nothing about which
 * one to look at, while "Straight to the number" / "Open on the obstacle" say
 * what the difference between them is before either is opened.
 */
export interface TipExample {
  label: string
  example: string
}

// Three, everywhere: the tab strip is sized for it, the prompt asks for it, and
// a fourth example is one more thing to read past rather than one more idea.
export const TIP_EXAMPLES_COUNT = 3

/**
 * The JSON schema one example is asked for under, and the array of them a tip
 * carries. Stated once and quoted into all seven schemas that ask for examples
 * (the six prompts that write tips, and the on-demand fallback), so an example
 * has one shape wherever it was written.
 *
 * No minItems or maxItems: OpenAI's strict mode rejects both, so the count is
 * asked for in the prompt and enforced by normaliseTipExamples on the way back.
 */
export const TIP_EXAMPLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["label", "example"],
  properties: {
    label: { type: "string" },
    example: { type: "string" },
  },
} as const

export const TIP_EXAMPLES_ARRAY_SCHEMA = {
  type: "array",
  items: TIP_EXAMPLE_SCHEMA,
} as const

// A tab label, so short enough to sit in a strip of three without wrapping.
export const TIP_EXAMPLE_LABEL_MAX_LENGTH = 40

// An example is a line to say or a shot to cut, not a paragraph. The prompt
// asks for about thirty words; this is the hard stop that a model ignoring it
// runs into, and what the database column is trusted to hold.
export const TIP_EXAMPLE_MAX_LENGTH = 320

// How long a tip can be before it is not worth writing examples for. Well under
// the 2000 a tip may be stored at: the tips this feature serves are single
// sentences, and anything much longer is a paragraph that leaked through, which
// would cost a generation and produce nothing anyone can use.
export const TIP_EXAMPLES_TIP_MAX_LENGTH = 400

// Cut at a word boundary rather than mid-word, and only where there is a
// boundary late enough to be worth cutting at, so an over-long example ends
// readably instead of "... the specific cla".
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

// Whitespace collapsed and the surrounding space dropped. Model-written text
// arrives with newlines in it often enough that an example would otherwise
// break its own tab panel across three lines for no reason.
//
// The em dashes go the same way they go everywhere else model-written copy is
// rendered. Nothing more is done to the wording: cleanCopy is shaped for tips
// (it drops a leading "Try", among other things), and an example is often a
// line of speech that legitimately opens with one.
function collapse(value: unknown): string {
  return typeof value === "string"
    ? stripEmDashes(value).replace(/\s+/g, " ").trim()
    : ""
}

/**
 * The examples of one tip, as the interface is allowed to render them.
 *
 * Everything that reaches the popup goes through here: a fresh model response,
 * a row read back out of the cache, and the JSON an API response was parsed
 * from. A cached row was normalised by an older version of this function, and
 * a model response was never normalised at all, so neither is trusted to be the
 * shape the tab strip expects.
 *
 * An entry with no example text is dropped rather than rendered empty. A label
 * that went missing falls back to the position, which reads as a plain "Example
 * 2" tab: worse than a named one, and still openable, which an unlabelled tab
 * is not. Anything past the third is dropped, since the strip is three wide.
 */
export function normaliseTipExamples(value: unknown): TipExample[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const candidate = entry as { label?: unknown; example?: unknown }
      const example = truncate(
        collapse(candidate.example),
        TIP_EXAMPLE_MAX_LENGTH,
      )
      if (example.length === 0) return null
      return {
        label: truncate(collapse(candidate.label), TIP_EXAMPLE_LABEL_MAX_LENGTH),
        example,
      }
    })
    .filter((entry): entry is TipExample => entry != null)
    .slice(0, TIP_EXAMPLES_COUNT)
    .map((entry, index) => ({
      ...entry,
      label: entry.label || `Example ${index + 1}`,
    }))
}

/**
 * The examples as a field to spread beside a tip, or nothing at all.
 *
 * The three head-to-head reports store a section's tip by spreading it in only
 * when there is one, so the renderer's "has a tip" test stays a plain presence
 * check. The examples follow the same convention, and it is stated once here so
 * all three do it the same way.
 */
export function tipExamplesField(value: unknown): { tipExamples?: TipExample[] } {
  const examples = normaliseTipExamples(value)
  return examples.length > 0 ? { tipExamples: examples } : {}
}

/**
 * Whether a tip is one this feature will write examples for.
 *
 * The bound is the point of it: generation costs a model call, and a "tip" long
 * enough to be a paragraph is a report section that leaked into a callout, not
 * advice anyone can be shown three versions of.
 */
export function canGenerateTipExamples(tip: string): boolean {
  const trimmed = tip.trim()
  return trimmed.length > 0 && trimmed.length <= TIP_EXAMPLES_TIP_MAX_LENGTH
}

/**
 * The YouTube video id a tip was read on, or null when the path it was read at
 * does not name one.
 *
 * The examples are grounded in what the channel actually makes videos about, so
 * the video behind the report is worth having; it is recovered from the path
 * the tip was read on rather than plumbed through a dozen call sites, the same
 * way lib/tips.ts recovers which surface a tip came from. A head-to-head report
 * names two videos rather than one, so it resolves to null and its examples are
 * written from the advice alone.
 *
 * The /dashboard-prefixed spelling is where this screen used to live. Nothing
 * links there any more, but a tab left open on the old path still posts it.
 */
export function analysedVideoIdFromPath(
  sourcePath: string | null | undefined,
): string | null {
  const path = (sourcePath ?? "").split("?")[0]
  const match = path.match(
    /^(?:\/dashboard)?\/analysed-video\/([A-Za-z0-9_-]{1,64})\/?$/,
  )
  return match ? match[1] : null
}

/**
 * The cache's context column for a video id: the id itself, or the empty string
 * where there is none. Stated here rather than at the call site because it is
 * half of the cache's unique key, and a null and an empty string would be two
 * different rows holding the same answer.
 */
export function tipExamplesContextKey(
  analysedVideoId: string | null | undefined,
): string {
  return analysedVideoId ?? ""
}
