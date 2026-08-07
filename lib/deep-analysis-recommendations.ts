// Turns each ranked retention-window event into one concrete recommendation.
//
// COPY CONSTRAINT: these are written here rather than by a model, but they are
// rendered as "Try:" tips like every other, so they follow the same rule, which
// lib/tip-voice.ts states in full for the prompts. In short: the video being
// analysed is already published on YouTube.
// Its edit cannot be changed, and there is no way to put an alternate cut up
// against the live one, so a recommendation phrased as "re-cut this and compare
// it against the current edit" asks for something impossible. Every action here
// must read as guidance the uploader applies to the videos they make next.
//
// Carry that framing in the body of the sentence - "plan ...", "a stretch like
// this" - rather than in a "next time, ..." / "in future videos, ..." lead-in.
// The "Try:" label already says these are for the next video, so a lead-in only
// delays the advice, and it turns into a tic when every tip on the page opens
// the same way. cleanCopy (lib/copy-guardrails.ts) strips one at render time if
// it slips through, here or from a model-written tip. The timestamp stays in
// the recommendation because it says which moment taught the lesson, not which
// frames to go and change.
//
// WHY EACH BRANCH CARRIES SEVERAL WORDINGS
//
// A branch is picked from what was measured in the window, and one video hands
// the same measurement in three or four different places: a talking stretch
// with no cuts at 0:40, another at 3:09, another at 5:38. With one sentence per
// branch, all three rows printed the same tip, word for word, and a page of
// identical advice reads as a template rather than as analysis. So each branch
// holds an ordered list of *distinct actions* within the same family, not
// paraphrases of one action: the first is the most broadly useful, and the ones
// after it are other real ways to solve the same problem. The uniqueness pass
// below hands each window the first wording nothing else on the page has
// already said, and drops the recommendation entirely once a branch has nothing
// new left to offer. A window with no tip still shows its evidence; a window
// with a copy-pasted tip teaches nothing.

import { isNearDuplicateAdvice } from "@/lib/advice-similarity"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { AudioAnalysis } from "@/lib/retention-window-media-analysis"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import type { SceneCueMetrics } from "@/lib/video-scene-cues"

export type RecommendationActionType =
  | "trim_silence"
  | "replace_freeze"
  | "remove_black_frame"
  | "increase_visual_pacing"
  | "reduce_visual_pacing"
  | "adjust_delivery"
  | "add_visual_support"
  | "signpost_topic_shift"
  | "preserve_pattern"
  | "review_transition"

// One way of acting on what a window measured, with the line of subtext that
// explains what it buys. They travel together so the muted purpose under a tip
// always belongs to the tip it sits beneath.
export interface RecommendationCopy {
  // The forward-looking instruction shown to the uploader as the "Try:" line.
  // Always about their next videos, never about re-editing this one.
  action: string
  expectedPurpose: string
}

export interface DeepAnalysisRecommendation extends RecommendationCopy {
  id: string
  sourceEventId: string
  timestampSeconds: number
  actionType: RecommendationActionType
  rationale: string
  evidenceQuality: RankedRetentionWindowEvent["evidenceQuality"]
  insightScore: number
  // The other actions this branch could have suggested, in preference order.
  // Working state for dedupeDeepAnalysisRecommendations, which swaps one in
  // when the preferred wording is already on the page and then strips the field
  // so it never reaches a renderer or the client payload.
  alternativeCopy?: RecommendationCopy[]
}

export interface RecommendationBaseline {
  cutsPerMinute: number | null
  speechRate: number | null
}

interface RecommendationChoice {
  actionType: RecommendationActionType
  // Ordered, most broadly useful first, each a different action rather than
  // another way of phrasing the one above it.
  copy: readonly RecommendationCopy[]
}

function choiceForEvent(params: {
  event: RankedRetentionWindowEvent
  window: PersistedRetentionWindow
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
}): RecommendationChoice {
  const { event, window, editing, baseline, audio } = params
  const isGain = window.kind === "gain"

  if (isGain) {
    return {
      actionType: "preserve_pattern",
      copy: [
        {
          action:
            "Treat this as a pattern to repeat: when you reach a comparable beat in your next videos, use the same delivery, visual change, and transition timing you used here.",
          expectedPurpose:
            "Repeating a proven pattern deliberately is what turns one gain into a habit.",
        },
        {
          action:
            "Write down the three parts of a beat like this, the setup, the payoff and how long each ran, and build them into the plan for your next video.",
          expectedPurpose:
            "Written down as a recipe, a moment that worked survives past the video it happened in.",
        },
        {
          action:
            "Place a beat like this early in your next videos, while most of the audience is still watching, so more of them reach the moment that lands.",
          expectedPurpose:
            "Where a strong moment sits decides how many people ever see it.",
        },
      ],
    }
  }

  if (editing && editing.freezeCoverage >= 0.05) {
    return {
      actionType: "replace_freeze",
      copy: [
        {
          action:
            "Keep the picture moving through a stretch like this: plan relevant B-roll, a close-up, or a supporting graphic to cover it rather than letting the frame hold.",
          expectedPurpose: "Keeps the picture advancing while the point is delivered.",
        },
        {
          action:
            "Record a second camera angle for talking sections so there is somewhere to go whenever the main shot would otherwise sit still.",
          expectedPurpose:
            "A second angle turns a held frame into a cut you can make at any moment.",
        },
        {
          action:
            "Build a slow push in or a reframe into a shot you know you will hold, so the screen keeps changing while you talk.",
          expectedPurpose:
            "Motion inside the shot does the work of a cut without needing one.",
        },
      ],
    }
  }
  if (editing && editing.blackCoverage >= 0.05) {
    return {
      actionType: "remove_black_frame",
      copy: [
        {
          action:
            "Bridge a transition like this with a continuous visual instead of cutting to black, or hold the black for only a few frames.",
          expectedPurpose: "A smoother transition gives viewers less of a cue to leave.",
        },
        {
          action:
            "Run the audio of the next section under the last moment of the one before it, so the sound carries the viewer across the join.",
          expectedPurpose:
            "Sound that continues across a join keeps it from reading as an ending.",
        },
        {
          action:
            "Design one short title card you reuse for section breaks, with a line of text and a beat of music, so a break lands as part of the video.",
          expectedPurpose:
            "A break that looks designed reads as structure rather than as a stop.",
        },
      ],
    }
  }
  if (audio?.silence != null && audio.silence >= 0.1) {
    return {
      actionType: "trim_silence",
      copy: [
        {
          action:
            "Cut dead air like this while you edit, keeping only the short pause a sentence genuinely needs.",
          expectedPurpose: "A tighter audio transition sustains momentum through the point.",
        },
        {
          action:
            "Set yourself a limit for how long a gap between sentences may run, half a second is a common one, and close anything past it on your edit pass.",
          expectedPurpose:
            "A number to edit against catches the gaps that judgement alone lets through.",
        },
        {
          action:
            "Say the next sentence in your head before you stop speaking, so the gaps you leave while thinking never make it onto the recording.",
          expectedPurpose: "Silence that is never recorded is silence you never have to cut.",
        },
      ],
    }
  }

  if (
    audio?.speech_rate != null &&
    baseline.speechRate != null &&
    baseline.speechRate > 0
  ) {
    const ratio = audio.speech_rate / baseline.speechRate
    if (ratio <= 0.8) {
      return {
        actionType: "adjust_delivery",
        copy: [
          {
            action:
              "Keep the delivery on an explanation like this closer to your usual speaking pace, or plan a shorter version of it.",
            expectedPurpose:
              "A pace closer to your established norm is what viewers arrive expecting.",
          },
          {
            action:
              "Script a long explanation as three or four beats and give each one a single sentence, so the section moves at the speed you talk everywhere else.",
            expectedPurpose:
              "Written as beats, an explanation stops expanding while it is being spoken.",
          },
          {
            action:
              "Run through an explanation once before you record it, so the take you keep is the one where you already know what comes next.",
            expectedPurpose: "A rehearsed take carries the pace that a first attempt loses.",
          },
        ],
      }
    }
    if (ratio >= 1.25) {
      return {
        actionType: "adjust_delivery",
        copy: [
          {
            action:
              "Give a key point like this slightly more room, or simplify the wording so it stays easy to follow at speed.",
            expectedPurpose:
              "A pace closer to your established norm is what viewers arrive expecting.",
          },
          {
            action:
              "Leave a beat of silence after a key point before you move on, so it has time to land.",
            expectedPurpose: "A pause after the point is what gives the audience time to take it in.",
          },
          {
            action:
              "Split a dense point into two sentences and put the number or the name at the end of each, where it is easiest to catch.",
            expectedPurpose:
              "Short sentences survive a fast delivery in a way that long ones do not.",
          },
        ],
      }
    }
  }

  if (
    editing?.cutsPerMinute != null &&
    baseline.cutsPerMinute != null &&
    baseline.cutsPerMinute > 0
  ) {
    const ratio = editing.cutsPerMinute / baseline.cutsPerMinute
    if (ratio <= 0.7) {
      return {
        actionType: "increase_visual_pacing",
        copy: [
          {
            action:
              "Plan at least one purposeful visual change for a stretch like this: B-roll, a crop change, a demonstration, or concise on-screen text.",
            expectedPurpose: "Pacing closer to the rest of the video, without adding noise.",
          },
          {
            action:
              "Put the numbers, names and steps you are talking about on screen as you say them, so there is something new to look at through a long spoken passage.",
            expectedPurpose:
              "On-screen text gives a talking passage a second channel to hold attention with.",
          },
          {
            action:
              "Mark the supporting shots you will need beside the script before you record, so every couple of sentences already has somewhere to go.",
            expectedPurpose:
              "Deciding what to cut to before the shoot is what makes the footage exist later.",
          },
          {
            action:
              "Cut a long explanation into two or three shorter passages and change what fills the screen at each one.",
            expectedPurpose:
              "A change of screen at each beat marks progress through the explanation.",
          },
        ],
      }
    }
    if (ratio >= 1.4) {
      return {
        actionType: "reduce_visual_pacing",
        copy: [
          {
            action:
              "Cut less through a stretch like this: leave out the non-essential cuts and let the most informative shot stay on screen long enough to register.",
            expectedPurpose: "Clearer visual continuity is easier to follow.",
          },
          {
            action:
              "Decide which single image carries the point, then hold it and add a cut only where something the audience has not seen appears.",
            expectedPurpose:
              "One image held is read; four images flashed past are only glimpsed.",
          },
          {
            action:
              "Keep quick cutting for the moments that are about energy, and let the sections where you explain something run on a steady frame.",
            expectedPurpose: "Reserving fast cutting for a purpose is what keeps it effective.",
          },
        ],
      }
    }
  }

  // Structure, not craft: a topic shift needs setup in the script, so the advice
  // belongs to how the next video is written rather than to any edit decision.
  if (event.eventType === "topic_shift") {
    return {
      actionType: "signpost_topic_shift",
      copy: [
        {
          action:
            "Signpost a shift like this before you make it: say what is coming and why it matters to what viewers came for, then keep the new section short and tie it back to the main topic.",
          expectedPurpose:
            "A signposted shift reads as part of the promise instead of a different video.",
        },
        {
          action:
            "Open every new section with one line naming what it pays off, so a change of subject arrives as the next step rather than as a break.",
          expectedPurpose:
            "A stated payoff gives the audience a reason to stay through the change.",
        },
        {
          action:
            "Group related material together when you order the script, and move anything that breaks the through line to the end, where leaving costs you least.",
          expectedPurpose:
            "Order decides how often a viewer is asked to accept a change of subject.",
        },
      ],
    }
  }

  if (event.primaryEvidence === "visual" || event.eventType === "visual_change") {
    return {
      actionType: "add_visual_support",
      copy: [
        {
          action:
            "Give a spoken point like this something to look at as you make it: a relevant demonstration, graphic, or framing change.",
          expectedPurpose: "Gives the spoken point clearer visual support.",
        },
        {
          action:
            "Show the thing you are describing happening, rather than describing it, whenever it is something you can put in front of the camera.",
          expectedPurpose:
            "Watching something happen takes less effort than picturing it from a description.",
        },
        {
          action:
            "Prepare a simple diagram for an explanation with several parts and reveal it one part at a time as you reach each.",
          expectedPurpose: "A diagram built up in steps keeps the visual in sync with the words.",
        },
      ],
    }
  }

  return {
    actionType: "review_transition",
    copy: [
      {
        action:
          "Get through a transition like this faster: move straight into the next point rather than talking your way into it.",
        expectedPurpose:
          "Turns the retention signal at this moment into an editing habit for the next video.",
      },
      {
        action:
          "Write the opening sentence of each section so it starts on the point itself, with no wind-up in front of it.",
        expectedPurpose:
          "A section that opens on its point never has to earn back the seconds spent arriving at it.",
      },
      {
        action:
          "Trim the tail of a section as you edit, so one point ends and the next begins with nothing in between.",
        expectedPurpose: "The join is where attention is loosest, so it is worth keeping short.",
      },
    ],
  }
}

export function compileDeepAnalysisRecommendations(params: {
  events: RankedRetentionWindowEvent[]
  window: PersistedRetentionWindow
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
  maxRecommendations?: number
}): DeepAnalysisRecommendation[] {
  return params.events.slice(0, params.maxRecommendations ?? 2).map((event) => {
    const { actionType, copy } = choiceForEvent({ ...params, event })
    const [preferred, ...alternatives] = copy
    return {
      id: `${params.window.id}:${event.id}`,
      sourceEventId: event.id,
      timestampSeconds: event.timestampSeconds,
      evidenceQuality: event.evidenceQuality,
      insightScore: event.insightScore,
      actionType,
      action: preferred.action,
      expectedPurpose: preferred.expectedPurpose,
      alternativeCopy: alternatives,
      rationale: event.narrative,
    }
  })
}

// Makes every recommendation across a video say something the video has not
// already said, and is the last thing to run before they are rendered.
//
// Two different ways the same advice arrives twice, handled separately:
//
//   1. Nearby windows overlap, so one moment can be measured twice and produce
//      the same action type seconds apart. That is one piece of advice about
//      one beat, so only the stronger of the pair survives.
//   2. Windows far apart in the video legitimately measure the same thing. The
//      lesson is real in both places, but printing one sentence twice is not
//      how to teach it, so the later window moves down its branch's list to an
//      action nothing else has suggested. When the list runs out, its
//      recommendation goes rather than repeating one already on the page.
//
// Wording is compared with isNearDuplicateAdvice, not string equality, so a
// branch cannot smuggle a duplicate through by rephrasing it.
export function dedupeDeepAnalysisRecommendations(
  groups: DeepAnalysisRecommendation[][],
): void {
  const ordered = groups
    .flatMap((recommendations, groupIndex) =>
      recommendations.map((recommendation) => ({ recommendation, groupIndex })),
    )
    .sort((a, b) => b.recommendation.insightScore - a.recommendation.insightScore)
  const kept: DeepAnalysisRecommendation[] = []
  const keepIds = new Set<string>()
  for (const { recommendation } of ordered) {
    const sameMoment = kept.some(
      (existing) =>
        existing.actionType === recommendation.actionType &&
        Math.abs(existing.timestampSeconds - recommendation.timestampSeconds) <= 20,
    )
    if (sameMoment) continue

    const { action, expectedPurpose, alternativeCopy = [] } = recommendation
    const unsaid = [{ action, expectedPurpose }, ...alternativeCopy].find(
      (copy) =>
        !kept.some(
          (existing) =>
            existing.action === copy.action ||
            isNearDuplicateAdvice(existing.action, copy.action),
        ),
    )
    if (!unsaid) continue

    recommendation.action = unsaid.action
    recommendation.expectedPurpose = unsaid.expectedPurpose
    // Working state only: the wordings not used are of no interest to a
    // renderer, and this object is serialised into the page payload.
    delete recommendation.alternativeCopy
    kept.push(recommendation)
    keepIds.add(recommendation.id)
  }
  for (const recommendations of groups) {
    recommendations.splice(
      0,
      recommendations.length,
      ...recommendations.filter((recommendation) => keepIds.has(recommendation.id)),
    )
  }
}
