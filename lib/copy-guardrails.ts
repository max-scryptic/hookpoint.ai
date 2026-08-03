// =============================================================================
// COPY GUARDRAIL - HARD RULE, DO NOT REMOVE
//
// No text rendered on the Channel Trends page may EVER contain an em dash
// (U+2014) or an en dash (U+2013). Plain hyphens ( - ) are fine.
//
// This applies to any copy written for the page, whether hard-coded in source
// (headlines, actions, descriptions, tooltips, comments) or generated at
// runtime (event narratives, topic labels). Two layers enforce it:
//
//   1. lib/__tests__/copy-guardrails.test.ts fails the build if an em or en
//      dash appears in any of the page's source files.
//   2. stripEmDashes() below scrubs dynamic, model-written text (retention
//      event narratives, packaging topics) at render time.
//
// If you are an AI assistant editing this codebase: never write an em dash in
// anything destined for this page. Use a hyphen, comma, period or colon
// instead.
// =============================================================================

/**
 * Replaces em dashes with a spaced hyphen and en dashes with a plain hyphen.
 * Applied to runtime text (LLM-written narratives, derived labels) before it
 * reaches the Channel Trends page.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, " - ").replace(/\u2013/g, "-")
}

// =============================================================================
// SIDE LABELS IN COMPARISON COPY
//
// A head-to-head names its two videos "Video A" and "Video B" everywhere the
// interface writes them itself (the column headers, the badges, the picker), so
// model-written prose has to match. It is asked to, but it still shortens to a
// bare letter often enough ("B makes the promise legible, A has more emotion")
// that a reader lands on a lone capital with nothing to attach it to.
// nameVideoSides() expands those back at render time, so prose stored before
// this existed reads the same way as prose written after it.
// =============================================================================

// A bare side label: a standalone capital A or B, optionally possessive. The
// leading group is a captured character rather than a lookbehind so the pattern
// runs anywhere the app does. The trailing lookahead is what keeps "B-roll" and
// "A1" out of it: a label is the whole token or it is not a label.
const SIDE_LABEL = /(^|[^\p{L}\p{N}'’-])([AB])((?:'|’)s)?(?![\p{L}\p{N}-])/gu

// Words that can follow the article "a" at the start of a sentence and end in
// "s", which is otherwise the mark of a third-person verb ("A opens on a face")
// and so the signal that the letter is a video. Without these, "A series of
// quick cuts" would read as a video called Series.
const SINGULAR_NOUNS_ENDING_IN_S = new Set([
  "address",
  "analysis",
  "axis",
  "basis",
  "bias",
  "bonus",
  "bus",
  "business",
  "campus",
  "canvas",
  "chorus",
  "class",
  "crisis",
  "cross",
  "dress",
  "focus",
  "genus",
  "glass",
  "gloss",
  "illness",
  "lens",
  "mess",
  "press",
  "process",
  "series",
  "status",
  "success",
  "surplus",
  "thesis",
  "virus",
  "witness",
])

// The other words a sentence-opening side label runs into: auxiliaries, the
// conjunctions that pair the two videos up, and the adverbs that sit between
// the label and its verb. None of them can follow the article "a".
const SIDE_LABEL_FOLLOWERS = new Set([
  "already",
  "also",
  "and",
  "at",
  "both",
  "by",
  "can",
  "could",
  "did",
  "in",
  "may",
  "might",
  "must",
  "never",
  "on",
  "only",
  "or",
  "should",
  "still",
  "then",
  "versus",
  "vs",
  "will",
  "would",
])

// True when nothing precedes the label in its own sentence, which is the only
// position where a capital A can be the article rather than a video.
function opensSentence(before: string): boolean {
  const trimmed = before.trimEnd()
  return trimmed.length === 0 || /[.!?:;]["'’)\]]?$/.test(trimmed)
}

// Whether one matched letter is naming a video rather than doing some other job
// in the sentence.
function isSideLabel(
  letter: string,
  isPossessive: boolean,
  before: string,
  after: string,
): boolean {
  // Already named, so leave "Video A" alone rather than growing it.
  if (/\bvideos?\s+$/i.test(before)) return false
  // "A/B test" is one phrase about testing, not two videos.
  if (before.endsWith("/") || after.startsWith("/")) return false
  // "Plan B" is the only common phrase where a bare B is not a video.
  if (letter === "B" && /\bplan\s+$/i.test(before)) return false
  // "A's thumbnail" can only be possessive, never the article.
  if (isPossessive) return true

  const spacing = after.match(/^\s+/)
  // Followed by punctuation or nothing ("stronger in B."), so not an article.
  if (!spacing) return true

  const nextWord =
    after.slice(spacing[0].length).match(/^[\p{L}\p{N}'’-]+/u)?.[0] ?? ""
  if (nextWord.length === 0) return true
  // A capitalised word after the letter reads as a quoted title or a name
  // ("A Day in the Life"), which a side label never is.
  if (/^\p{Lu}/u.test(nextWord)) return false
  // Mid-sentence, a standalone capital letter is never the article.
  if (!opensSentence(before)) return true

  if (SIDE_LABEL_FOLLOWERS.has(nextWord)) return true
  return nextWord.endsWith("s") && !SINGULAR_NOUNS_ENDING_IN_S.has(nextWord)
}

/**
 * Expands a bare side label in model-written comparison copy into the name the
 * rest of the interface uses, so "B makes the promise legible, A has more
 * emotion" reads "Video B makes the promise legible, Video A has more emotion".
 * Only for prose about a pair of videos: it must not be applied to a verbatim
 * title, a transcript quote, or copy about a single video, where a capital A is
 * ordinary English.
 */
export function nameVideoSides(text: string): string {
  return text.replace(
    SIDE_LABEL,
    (
      match: string,
      prefix: string,
      letter: string,
      possessive: string | undefined,
      offset: number,
    ) => {
      const before = text.slice(0, offset + prefix.length)
      const after = text.slice(offset + match.length)
      if (!isSideLabel(letter, possessive != null, before, after)) return match
      return `${prefix}Video ${letter}${possessive ?? ""}`
    },
  )
}

// Model-written copy occasionally leaks the JSON structure it was generated
// inside back into the text itself, so a tip can arrive reading
// `...Reaching Arena 16."]},` with a stray `]},` clinging to the end. These
// braces and brackets never belong in prose, so strip any run of them (and the
// commas, colons, semicolons and whitespace clinging to that run) from either
// end of the string. A quote or word next to the run is left untouched, so the
// closing quote of `Arena 16."` survives while the `]},` after it is removed.
function stripStructuralArtifacts(text: string): string {
  return text
    .replace(/^[\s,;:]*[[{][\s,;:[{]*/, "")
    .replace(/[\s,;:]*[\]}][\s,;:\]}]*$/, "")
}

// Every tip is already understood to be advice for the videos the uploader
// makes next - that is what the "Try:" label means - so spelling it out in a
// lead-in ("Next time, ...", "In future videos, ...") only pushes the actual
// advice further down the sentence, and reads as a tic once every tip on the
// page opens the same way. The tip should start with the thing to do.
//
// The forward-looking framing itself is NOT dropped: it lives in how the rest
// of the sentence is written ("plan", "a stretch like this"), which is what
// keeps a tip from reading as an instruction to re-edit the published video.
const ADVICE_PREAMBLE =
  /(?:next time(?: around)?|next video|in (?:your |the )?next videos?|in (?:the )?future(?: videos?)?|for (?:your |the )?next videos?|for future videos?|going forward|from now on|moving forward)\s*[,:]\s*/i

// Drops the preamble where a tip actually opens with one: at the very start,
// or at the start of the advice clause when the tip leads with the moment it
// came from ("Where the shot goes static at 1:23: next time, plan a b-roll
// insert."). Anything further in is left alone, since mid-sentence phrasing
// like "an explanation like this in future videos" reads fine.
function stripAdvicePreamble(text: string): string {
  const leading = new RegExp(`^${ADVICE_PREAMBLE.source}`, "i")
  if (leading.test(text)) return capitalizeFirstLetter(text.replace(leading, ""))

  // Lazy up to the colon rather than "everything that is not a colon": the
  // moment prefix carries a timestamp ("around 1:23:"), so the colon the advice
  // starts after is not always the first one in the string.
  const afterColon = new RegExp(`^(.+?:\\s*)${ADVICE_PREAMBLE.source}`, "i")
  if (afterColon.test(text)) return text.replace(afterColon, "$1")

  return text
}

// Only touches an initial lowercase letter, so an acronym or a quoted title
// that already starts the sentence survives untouched.
function capitalizeFirstLetter(text: string): string {
  return text.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
}

/**
 * Scrubs one piece of model-written copy before it is shown to a user, so every
 * tip and every described piece of evidence reads as plain, well-formed
 * English. It removes em and en dashes, strips leaked JSON structural artifacts
 * (stray braces and brackets and the punctuation clinging to them), drops a
 * "next time" / "in future videos" lead-in so the tip opens on the advice
 * itself, and collapses runaway whitespace into single spaces. Apply it at the
 * point copy is rendered, so text already stored before this guardrail existed
 * is cleaned too.
 */
export function cleanCopy(text: string): string {
  return stripAdvicePreamble(
    stripStructuralArtifacts(stripEmDashes(text)).replace(/\s+/g, " ").trim(),
  )
}
