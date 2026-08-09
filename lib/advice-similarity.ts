// A report's tips are written by the model in one pass but as separate fields,
// so it regularly lands on the same advice twice in different words: "Make the
// thumbnail show one outcome at a glance, using a simple before and after or
// result graphic" and "Build the thumbnail around one simple before and after
// or result" are one suggestion, not two. Shown near each other they read as
// padding and bury whatever genuinely new thing the second one has to say.
//
// The prompt already asks for distinct recommendations, so this is the second
// line of defence: it also cleans up every report already stored. Comparing
// meaning is not something a renderer can do, so this compares wording and is
// tuned to fire only when two lines are near restatements of each other.

// Function words carry no advice, so they are dropped before anything is
// compared: two sentences both containing "the" and "of" are not similar. Only
// grammar words are listed. Verbs stay, even generic ones like "make" or
// "put", because the verb is often the entire difference between two tips
// about the same surface ("put one number in the title" versus "lead the title
// with the result"). "before" and "after" stay for the same reason: in tips
// they are usually the thing being suggested, not a preposition.
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "nor", "but", "so", "than", "then", "that",
  "this", "these", "those", "it", "its", "they", "them", "their", "you",
  "your", "yours", "we", "our", "of", "to", "in", "into", "on", "onto", "at",
  "by", "for", "from", "with", "within", "without", "as", "about", "around",
  "across", "over", "under", "up", "down", "out", "off", "per", "via", "is",
  "are", "be", "being", "been", "was", "were", "am", "do", "does", "did",
  "have", "has", "had", "can", "could", "should", "would", "will", "shall",
  "may", "might", "must", "not", "no", "if", "when", "where", "while",
  "because", "since", "which", "what", "who", "whose", "how", "there", "here",
  "also", "just", "only", "very", "really", "rather", "instead", "either",
  "both", "each", "every", "other", "another", "same", "own", "such", "any",
])

// Crude on purpose: it only has to map two spellings of the same idea onto one
// key ("scenes" and "scene", "combining" and "combine"), and it is applied to
// both sides, so a stem that is not a real word costs nothing. One pass only,
// since repeatedly stripping suffixes chews words down far enough that
// unrelated ones start to collide.
function stem(word: string): string {
  let stemmed = word
  // Plurals and third-person verbs, leaving "less" and "across" alone.
  if (stemmed.length >= 5 && stemmed.endsWith("s") && !stemmed.endsWith("ss")) {
    stemmed = stemmed.slice(0, -1)
  }
  for (const suffix of ["ing", "ed"]) {
    if (stemmed.endsWith(suffix) && stemmed.length - suffix.length >= 3) {
      stemmed = stemmed.slice(0, -suffix.length)
      break
    }
  }
  // "cutting" has become "cutt" by here, and needs to meet "cut".
  if (stemmed.length >= 4 && /([bdfglmnprt])\1$/.test(stemmed)) {
    stemmed = stemmed.slice(0, -1)
  }
  // "combining" has become "combin", and needs to meet "combine".
  if (stemmed.length >= 5 && stemmed.endsWith("e")) {
    stemmed = stemmed.slice(0, -1)
  }
  return stemmed
}

// The sequence, not a set: the order is what lets a shared run of words be
// spotted below, and repeats are meaningful to it.
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0 && !FUNCTION_WORDS.has(word))
    .map(stem)
}

// Length of the longest run of content words the two lines share in the same
// order. Four is already a whole phrase ("simple before after result"), which
// is the strongest signal there is that one line is restating the other.
function longestSharedRun(a: string[], b: string[]): number {
  let longest = 0
  // Only the previous row of the table is ever needed, so it is kept alone.
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1
        if (current[j] > longest) longest = current[j]
      }
    }
    previous = current
  }
  return longest
}

// Tuned against real report copy. The overlap threshold sits above the level
// two tips reach just by being about the same surface (a pair sharing only
// "title", "thumbnail" and "one" lands near 0.4), and the containment rule
// catches the short line that says nothing the long one did not already say.
const SHARED_WORD_RATIO = 0.45
const SHARED_RUN_WORDS = 4
const CONTAINED_RATIO = 0.7
const MIN_CONTAINED_WORDS = 3

/**
 * Whether two pieces of advice say the same thing in different words, closely
 * enough that showing both is repetition. Deliberately conservative: a pair
 * that is merely about the same surface, or that shares a subject but suggests
 * a different change, reads as two tips and is left as two.
 */
export function isNearDuplicateAdvice(a: string, b: string): boolean {
  const wordsA = contentWords(a)
  const wordsB = contentWords(b)
  const uniqueA = new Set(wordsA)
  const uniqueB = new Set(wordsB)
  if (uniqueA.size === 0 || uniqueB.size === 0) return false

  const shared = [...uniqueA].filter((word) => uniqueB.has(word)).length
  const sharedRatio = (2 * shared) / (uniqueA.size + uniqueB.size)
  if (sharedRatio >= SHARED_WORD_RATIO) return true

  if (longestSharedRun(wordsA, wordsB) >= SHARED_RUN_WORDS) return true

  // A brief line whose words are nearly all present in a longer one is that
  // longer one in summary. Measured against the shorter side, since the ratio
  // above is dragged down by the length gap.
  const shorter = Math.min(uniqueA.size, uniqueB.size)
  return shorter >= MIN_CONTAINED_WORDS && shared / shorter >= CONTAINED_RATIO
}

/**
 * A running record of the advice a page has already given, for surfaces that
 * assemble their tips from several sources and can only tell they have repeated
 * themselves once all of it is in one place. Ask it about each tip in the order
 * a reader meets them: the first wording of a suggestion answers true and is
 * remembered, and anything that restates it later answers false so the caller
 * can drop it.
 *
 * Blank and missing tips are not advice, so they answer false and are not
 * recorded: a surface with no tip is not "already said".
 */
export function createAdviceDeduper(): (advice: string | null | undefined) => boolean {
  const said: string[] = []
  return (advice) => {
    const text = advice?.trim()
    if (!text) return false
    if (said.some((earlier) => earlier === text || isNearDuplicateAdvice(earlier, text))) {
      return false
    }
    said.push(text)
    return true
  }
}
