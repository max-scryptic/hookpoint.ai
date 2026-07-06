// Deterministic, API-only checks on a video's metadata "hygiene": the title,
// description, chapters and hashtags. None of this needs an LLM or the source
// file — it's a cheap, always-available surface pass that flags packaging
// basics a creator can fix in the Studio in seconds. Computed on render from
// the VideoDetails we already store, so there's nothing to persist.

import type { VideoDetails } from "@/lib/youtube/youtube"

export type HygieneStatus = "good" | "warn" | "info"

export interface HygieneCheck {
  id: string
  label: string
  status: HygieneStatus
  detail: string
}

export interface MetadataHygiene {
  // How many checks came back "good", out of the total scored (info checks are
  // excluded from the denominator — they're observations, not pass/fail).
  goodCount: number
  scoredCount: number
  checks: HygieneCheck[]
}

// YouTube truncates titles around 60-70 characters in most surfaces, and very
// short titles usually leave search/context on the table.
const TITLE_MAX_CHARS = 70
const TITLE_MIN_CHARS = 20

// A description short enough that it's almost certainly not helping search or
// context. Not a hard rule, just a nudge.
const DESCRIPTION_MIN_CHARS = 120

// YouTube ignores every hashtag on a video once there are more than 15.
const HASHTAG_HARD_LIMIT = 15

// Matches HH:MM:SS or MM:SS timestamps used for chapters in a description.
const TIMESTAMP_REGEX = /(?:^|\s)(\d{1,2}:)?\d{1,2}:\d{2}(?=\s|$)/gm

function countTimestamps(text: string): number {
  return (text.match(TIMESTAMP_REGEX) ?? []).length
}

// Chapters only activate when the description has a 0:00 line and at least three
// timestamps in ascending order — mirroring YouTube's own requirement.
function hasChapters(description: string): boolean {
  const hasZero = /(?:^|\s)0:00(?=\s|$)/m.test(description)
  return hasZero && countTimestamps(description) >= 3
}

function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length
}

export function computeMetadataHygiene(
  video: Pick<VideoDetails, "title" | "description">,
): MetadataHygiene {
  const title = video.title?.trim() ?? ""
  const description = video.description ?? ""
  const descriptionText = description.trim()

  const checks: HygieneCheck[] = []

  // --- Title length -------------------------------------------------------
  if (title.length === 0) {
    checks.push({
      id: "title-length",
      label: "Title",
      status: "warn",
      detail: "This video has no title.",
    })
  } else if (title.length > TITLE_MAX_CHARS) {
    checks.push({
      id: "title-length",
      label: "Title length",
      status: "warn",
      detail: `${title.length} characters — likely truncated in search and suggested feeds. Aim for under ${TITLE_MAX_CHARS}.`,
    })
  } else if (title.length < TITLE_MIN_CHARS) {
    checks.push({
      id: "title-length",
      label: "Title length",
      status: "warn",
      detail: `${title.length} characters — short titles often leave searchable context on the table.`,
    })
  } else {
    checks.push({
      id: "title-length",
      label: "Title length",
      status: "good",
      detail: `${title.length} characters — a sensible length that shows in full.`,
    })
  }

  // --- Title shoutiness ---------------------------------------------------
  const letters = title.replace(/[^\p{L}]/gu, "")
  const upper = title.replace(/[^\p{Lu}]/gu, "")
  if (letters.length >= 10 && upper.length / letters.length > 0.7) {
    checks.push({
      id: "title-caps",
      label: "Title casing",
      status: "warn",
      detail: "Mostly uppercase — reads as shouting and can suppress click-through.",
    })
  }

  // --- Description --------------------------------------------------------
  if (descriptionText.length === 0) {
    checks.push({
      id: "description",
      label: "Description",
      status: "warn",
      detail: "Empty — you're missing free searchable context and space for links.",
    })
  } else if (descriptionText.length < DESCRIPTION_MIN_CHARS) {
    checks.push({
      id: "description",
      label: "Description",
      status: "warn",
      detail: `Only ${descriptionText.length} characters — a fuller description helps search and context.`,
    })
  } else {
    checks.push({
      id: "description",
      label: "Description",
      status: "good",
      detail: `${descriptionText.length} characters of context.`,
    })
  }

  // --- Chapters -----------------------------------------------------------
  checks.push(
    hasChapters(description)
      ? {
          id: "chapters",
          label: "Chapters",
          status: "good",
          detail: "Timestamped chapters detected — easier navigation and extra search surface.",
        }
      : {
          id: "chapters",
          label: "Chapters",
          status: "info",
          detail:
            "No chapters detected. Adding timestamped chapters can improve navigation and retention.",
        },
  )

  // --- Hashtags -----------------------------------------------------------
  const hashtagCount = countHashtags(`${title}\n${description}`)
  if (hashtagCount > HASHTAG_HARD_LIMIT) {
    checks.push({
      id: "hashtags",
      label: "Hashtags",
      status: "warn",
      detail: `${hashtagCount} hashtags — YouTube ignores all of them once there are more than ${HASHTAG_HARD_LIMIT}.`,
    })
  } else if (hashtagCount === 0) {
    checks.push({
      id: "hashtags",
      label: "Hashtags",
      status: "info",
      detail: "No hashtags. A few relevant ones can add discovery surface.",
    })
  } else {
    checks.push({
      id: "hashtags",
      label: "Hashtags",
      status: "good",
      detail: `${hashtagCount} hashtag${hashtagCount === 1 ? "" : "s"} — within the limit YouTube honours.`,
    })
  }

  const scored = checks.filter((check) => check.status !== "info")
  return {
    goodCount: scored.filter((check) => check.status === "good").length,
    scoredCount: scored.length,
    checks,
  }
}
