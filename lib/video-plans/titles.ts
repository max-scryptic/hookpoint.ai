// The rules a plan's candidate titles are held to, kept pure and free of
// imports so the form that collects them and the route that stores them agree
// without either one owning the definition.
//
// A creator types one title, then optionally a second and third when they are
// torn between ideas. The whole value of the second and third is that the
// packaging read judges them against the same thumbnail and the same hook, so
// the comparison is like-for-like; two identical titles would just buy the same
// verdict twice, which is why duplicates collapse here rather than being
// rejected with an error the creator has to go and fix.

// YouTube's own hard limit. A title longer than this could never be used, so
// there is no point analysing it.
export const TITLE_MAX_LENGTH = 100

// Three is the ceiling: enough to weigh a real shortlist, few enough that the
// report can show every one of them side by side without becoming a table.
export const MAX_TITLES = 3

export class InvalidTitlesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidTitlesError"
  }
}

// Normalises the raw title list from the form into what gets stored: trimmed,
// blank entries dropped, case-insensitive duplicates collapsed (keeping the
// first spelling the creator typed), capped at MAX_TITLES.
//
// Throws when nothing usable survives, or when a title is over YouTube's limit
// - the two cases where quietly carrying on would store a plan the creator did
// not describe.
export function normaliseTitles(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new InvalidTitlesError("Add at least one title idea.")
  }

  const seen = new Set<string>()
  const titles: string[] = []

  for (const raw of input) {
    if (typeof raw !== "string") continue
    const title = raw.trim()
    if (!title) continue

    if (title.length > TITLE_MAX_LENGTH) {
      throw new InvalidTitlesError(
        `Titles can be at most ${TITLE_MAX_LENGTH} characters, which is YouTube's own limit.`,
      )
    }

    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(title)

    if (titles.length === MAX_TITLES) break
  }

  if (titles.length === 0) {
    throw new InvalidTitlesError("Add at least one title idea.")
  }

  return titles
}
