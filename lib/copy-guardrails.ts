// =============================================================================
// COPY GUARDRAIL - HARD RULE, DO NOT REMOVE
//
// No text anywhere in this product may EVER contain an em dash (U+2014) or an
// en dash (U+2013). Plain hyphens ( - ) and commas are what we write instead.
//
// This applies to every page and every surface, and to any copy whatsoever,
// whether hard-coded in source (headlines, actions, descriptions, tooltips,
// empty-state placeholders, comments, prompts, migrations) or generated at
// runtime (tips, evidence, event narratives, topic labels). Three layers
// enforce it:
//
//   1. lib/__tests__/copy-guardrails.test.ts fails the build if an em or en
//      dash appears in any source file in the repository.
//   2. Every prompt that writes prose for a user tells the model never to
//      output one (see lib/prompts/registry.ts and lib/prompts/defaults).
//   3. stripEmDashes() below scrubs dynamic, model-written text at render
//      time, which is the only layer that reaches copy already stored.
//
// If you are an AI assistant editing this codebase: never write an em dash in
// anything, anywhere. Use a hyphen, comma, period or colon instead.
// =============================================================================

/**
 * Replaces em dashes with a spaced hyphen and en dashes with a plain hyphen.
 * Applied to runtime text (LLM-written narratives, derived labels) before it
 * is rendered.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, " - ").replace(/\u2013/g, "-")
}

/**
 * Runs stripEmDashes over every string in a value, however deeply nested,
 * leaving the shape and every non-string value exactly as it was. For a payload
 * whose prose is model-written and then read out across dozens of fields (an
 * evidence set, an analysis report), this is applied once where the payload is
 * loaded rather than at each of the places it is rendered, so a field added
 * later is covered without anyone remembering to wrap it.
 *
 * Anything that is not a plain object, an array or a string comes back
 * untouched, so a Date or a class instance keeps its identity.
 */
export function scrubDashes<T>(value: T): T {
  if (typeof value === "string") return stripEmDashes(value) as T
  if (Array.isArray(value)) return value.map((item) => scrubDashes(item)) as T
  if (value === null || typeof value !== "object") return value

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubDashes(item)]),
  ) as T
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

// =============================================================================
// SUMMARY LENGTH
//
// Every summary card in the app (the alignment summary on a single video's
// report, and the summary box heading each of the three head-to-heads) is a
// glance, not a read: the sections under it carry the detail. Two sentences is
// the whole budget. Every prompt that writes one asks for two, but a model that
// has one more thing to say writes three or four often enough that summaries
// drift back to a paragraph, so the limit is also enforced here, at render
// time. That settles the reports already stored as well, which no prompt can
// reach.
//
// The extra sentences are dropped rather than rewritten: the prompts put the
// verdict first, so the sentences that survive are the ones carrying it.
// =============================================================================

/** How many sentences a summary card may show. */
export const SUMMARY_SENTENCE_LIMIT = 2

// Abbreviations whose trailing period does not end a sentence. Only the ones
// that plausibly turn up in a report summary and can be followed by a capital
// ("Video A vs. Video B"); anything else is a real break.
const NON_TERMINAL_ABBREVIATIONS = new Set([
  "approx",
  "avg",
  "e.g",
  "etc",
  "fig",
  "i.e",
  "vs",
])

// A sentence ends on . ! or ?, plus any closing quote or bracket riding on it,
// where a new sentence visibly starts after the space. Requiring the space is
// what keeps a decimal out of it, so "held 42.1% of its audience" is one
// sentence; requiring the capital (or an opening quote, or a figure) keeps
// "0:04 vs. the 1.5x" style fragments together.
const SENTENCE_BREAK = /[.!?]+["'’”)\]]*\s+(?=[\p{Lu}\p{N}"“'‘(])/gu

// The last word before a terminator, dots included, so "e.g." arrives whole.
function tokenBefore(body: string): string {
  return (body.match(/[\p{L}\p{N}.]+$/u)?.[0] ?? "").toLowerCase()
}

/**
 * Splits model-written prose into sentences, each keeping its own terminator.
 * Conservative by design: anything it cannot confidently call a break stays
 * part of the sentence it is in, so a summary is only ever cut where a reader
 * would agree one sentence ended and the next began.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let start = 0
  for (const match of text.matchAll(SENTENCE_BREAK)) {
    const body = text.slice(start, match.index)
    if (NON_TERMINAL_ABBREVIATIONS.has(tokenBefore(body))) continue
    sentences.push(text.slice(start, match.index + match[0].length).trim())
    start = match.index + match[0].length
  }
  const tail = text.slice(start).trim()
  if (tail.length > 0) sentences.push(tail)
  return sentences
}

/**
 * Caps one piece of model-written prose at the given number of sentences,
 * keeping the first ones and dropping the rest. Text already inside the limit
 * comes back untouched apart from surrounding whitespace. Apply it where a
 * summary is rendered, after cleanCopy or stripEmDashes, so stored copy written
 * before the cap existed is shortened too.
 */
export function limitSentences(
  text: string,
  limit: number = SUMMARY_SENTENCE_LIMIT,
): string {
  if (limit < 1) return ""
  const sentences = splitSentences(text)
  if (sentences.length <= limit) return text.trim()
  return sentences.slice(0, limit).join(" ")
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
// lib/tip-voice.ts states that rule in full and is what every tip-writing
// prompt is given; this function is its render-time half, for the one part of
// the rule that can be enforced mechanically after the fact.
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

// =============================================================================
// THE "TRY:" LABEL IN A TIP
//
// Every tip is rendered behind a "Try:" label, so a tip that opens with "Try"
// puts the word on the page twice: "Try: Try opening with a split-screen".
// The video analysis tips never do it, because they are written as plain
// commands ("Keep the picture moving through a stretch like this"), and the
// comparison reports are asked for the same thing. Models write it anyway,
// often enough to read as a tic across a page of tips, so the opener is unwound
// here at render time. That also settles the reports already stored, which no
// prompt can reach.
//
// "Try to open with X" and "Try: open with X" only lose the opener, since the
// command is already written. "Try opening with X" has to have its gerund put
// back into the command form the rest of the tips are written in, which is what
// gerundImperative() does. Anything it cannot convert with confidence is left
// exactly as the model wrote it: a tip that says "Try" twice is a blemish,
// while "Openning with X" would be a bug.
// =============================================================================

// The gerunds the rules below cannot reach: irregular verbs, and the endings
// where both spellings are common enough that no rule settles them ("adding"
// keeps its double d while "embedding" drops one; "using" wants its silent e
// back while "focusing" does not).
const GERUND_IMPERATIVES: Record<string, string> = {
  acquiring: "acquire",
  arranging: "arrange",
  being: "be",
  challenging: "challenge",
  changing: "change",
  citing: "cite",
  combining: "combine",
  competing: "compete",
  completing: "complete",
  concluding: "conclude",
  controlling: "control",
  creating: "create",
  deciding: "decide",
  declining: "decline",
  defining: "define",
  deleting: "delete",
  determining: "determine",
  dividing: "divide",
  dying: "die",
  embedding: "embed",
  escaping: "escape",
  examining: "examine",
  excluding: "exclude",
  exchanging: "exchange",
  exciting: "excite",
  exploring: "explore",
  guiding: "guide",
  hiding: "hide",
  ignoring: "ignore",
  imagining: "imagine",
  including: "include",
  inviting: "invite",
  labelling: "label",
  lying: "lie",
  modelling: "model",
  noting: "note",
  outlining: "outline",
  promoting: "promote",
  providing: "provide",
  quoting: "quote",
  rearranging: "rearrange",
  redefining: "redefine",
  refining: "refine",
  requiring: "require",
  restoring: "restore",
  rewriting: "rewrite",
  scoring: "score",
  shaping: "shape",
  shining: "shine",
  signalling: "signal",
  sliding: "slide",
  storing: "store",
  streamlining: "streamline",
  travelling: "travel",
  tuning: "tune",
  typing: "type",
  underlining: "underline",
  uniting: "unite",
  voting: "vote",
  writing: "write",
}

// Stems that are already the whole verb, where a rule below would otherwise
// hand them a silent e they never had.
const COMPLETE_STEMS = new Set(["bias", "canvas", "focus", "refocus"])

/**
 * The command form of one gerund ("opening" to "open", "pacing" to "pace"), or
 * null when no rule here settles it confidently.
 *
 * The rules run in order and each one is written to be safe on its own, so the
 * fall-through at the end can simply drop the ending: by then the stem is
 * something that already ends a word ("open", "maintain", "hold", "call").
 */
function gerundImperative(gerund: string): string | null {
  const word = gerund.toLowerCase()
  const known = GERUND_IMPERATIVES[word]
  if (known) return known
  if (!/^[a-z][a-z-]*ing$/.test(word)) return null

  const stem = word.slice(0, -3)
  if (stem.length < 2) return null
  if (COMPLETE_STEMS.has(stem)) return stem
  // A consonant doubled only to carry the ending: "cutting" to "cut". The
  // letters left out of the set are the ones that double in the verb itself,
  // so "calling", "passing", "adding", "staffing" and "buzzing" keep both.
  if (/([bgkmnprt])\1$/.test(stem)) return stem.slice(0, -1)
  // "seeing" to "see", "agreeing" to "agree".
  if (/(?:ee|oe)$/.test(stem)) return stem
  // The rest put back the silent e the ending replaced, wherever the stem
  // cannot end a word without it. "eat" is carved out of the -ate verbs so
  // "repeating" does not come back as "repeate".
  if (/[^e]at$/.test(stem)) return `${stem}e` // narrating, incorporating
  if (/[cvzu]$/.test(stem)) return `${stem}e` // pacing, moving, continuing
  if (/[^s]s$/.test(stem)) return `${stem}e` // using, closing, condensing
  if (/(?:[aeiou]|[dlr])g$/.test(stem)) return `${stem}e` // packaging, judging
  if (/[^aeiou][aeiou][km]$/.test(stem)) return `${stem}e` // making, framing
  if (/[^aeiou](?:ar|ir|ur)$/.test(stem)) return `${stem}e` // comparing, measuring
  if (/[^aeioul]l$/.test(stem)) return `${stem}e` // handling, sampling
  return stem
}

// Drops the "Try" a tip opens with, so the label in front of it is not read
// twice. Whatever is left has to stand as a command on its own, so the opener
// goes only in the shapes where it can: leave the tip as written otherwise.
function stripTryOpener(text: string): string {
  const opener = text.match(/^try\b([\s:,]*)(?:(to|and)\s+)?/i)
  if (opener == null || opener[0].length === text.length) return text
  const [matched, punctuation, bridge] = opener
  const rest = text.slice(matched.length)

  // "Try to open with the claim", "Try: open with the claim". The command is
  // already there, so the opener is all that goes.
  if (bridge != null || /[:,]/.test(punctuation)) {
    return capitalizeFirstLetter(rest)
  }

  // "Try opening with the claim". Only a gerund can be turned back into the
  // command the tip should have been, so anything else ("Try a colder open")
  // keeps its opener rather than being left as a fragment.
  const nextWord = rest.match(/^[a-z-]+ing\b/i)?.[0]
  if (nextWord == null) return text
  const imperative = gerundImperative(nextWord)
  if (imperative == null) return text
  return capitalizeFirstLetter(imperative + rest.slice(nextWord.length))
}

/**
 * Scrubs one piece of model-written copy before it is shown to a user, so every
 * tip and every described piece of evidence reads as plain, well-formed
 * English. It removes em and en dashes, strips leaked JSON structural artifacts
 * (stray braces and brackets and the punctuation clinging to them), drops a
 * "next time" / "in future videos" lead-in so the tip opens on the advice
 * itself, drops a "Try" the interface already prints as the label in front of
 * the tip, and collapses runaway whitespace into single spaces. Apply it at the
 * point copy is rendered, so text already stored before this guardrail existed
 * is cleaned too.
 */
export function cleanCopy(text: string): string {
  // The "Try" strip runs last: a tip can carry both openers at once ("Next
  // time, try opening on the claim"), and the "Try" is only visible as one
  // once the lead-in in front of it has gone.
  return stripTryOpener(
    stripAdvicePreamble(
      stripStructuralArtifacts(stripEmDashes(text)).replace(/\s+/g, " ").trim(),
    ),
  )
}
