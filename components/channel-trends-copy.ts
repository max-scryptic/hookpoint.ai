import type { ChannelInsightKind } from "@/lib/channel-trends"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"

// The written half of a channel insight: lib/channel-trends.ts decides WHICH
// patterns have earned a verdict; this map decides what the verdict says. One
// headline plus one concrete suggestion per event type per insight kind —
// deliberately phrased as correlation ("shows up where viewers leave"), never
// causation, because the events are evidence-backed but still correlational.

export interface InsightCopy {
  headline: string
  action: string
}

const FIX_COPY: Record<RetentionWindowEventType, InsightCopy> = {
  pacing_change: {
    headline: "Sudden pacing changes are your most consistent viewer-loser.",
    action:
      "Bridge your energy shifts. When you drop from a fast section into a slower one, tease what's coming, keep music running under the transition, or trim the slow section shorter than feels natural.",
  },
  scene_cut: {
    headline: "Hard scene cuts keep showing up where viewers leave.",
    action:
      "Give viewers a reason to follow the cut — carry a sentence, a sound, or motion across it so the change feels like a continuation, not a restart.",
  },
  topic_shift: {
    headline: "Abrupt topic changes are where your viewers bail.",
    action:
      "Signpost before you switch topics. One line that sells why the next section matters keeps viewers from treating the shift as an exit.",
  },
  visual_change: {
    headline: "Big visual switches keep costing you viewers.",
    action:
      "Ease into visual resets. When the whole frame changes — new location, new setup — anchor it with continuity: similar framing, an overlay, or your voice carrying over the change.",
  },
  audio_change: {
    headline: "Audio shifts line up with your drop-offs.",
    action:
      "Watch your sound transitions. Music ending, tone flattening or a loudness jump reads as a natural exit point — keep an audio bed running through slower moments.",
  },
  on_screen_text_change: {
    headline: "On-screen text moments line up with your drop-offs.",
    action:
      "Check your overlays. Text that arrives dense, fast or off-topic gives viewers a reason to skip — keep overlays short and tied to what you're saying in the moment.",
  },
  other: {
    headline: "One recurring pattern keeps showing up where viewers leave.",
    action:
      "Read the events below. These moments didn't fit a single cause, but they recur — the narratives usually show what they share.",
  },
}

const STRENGTH_COPY: Record<RetentionWindowEventType, InsightCopy> = {
  pacing_change: {
    headline: "Pace shifts are winning viewers back — use them on purpose.",
    action:
      "A deliberate change of speed re-engages your audience. When a section starts to flatten, shift gear instead of pushing through at the same tempo.",
  },
  scene_cut: {
    headline: "Quick cuts pull your viewers back in.",
    action:
      "Bursts of cutting reliably line up with your retention gains. Deploy them deliberately when a section starts to drag, not just where the edit happens to be busy.",
  },
  topic_shift: {
    headline: "Fresh topics pull your viewers back in.",
    action:
      "Your audience rewards a change of subject. When retention sags, move to the next idea sooner than feels comfortable.",
  },
  visual_change: {
    headline: "Visual variety is holding your audience.",
    action:
      "New angles, locations and b-roll line up with your retention gains — plan a visual reset into any segment that runs long.",
  },
  audio_change: {
    headline: "Sound changes are holding your viewers.",
    action:
      "Music drops, sound effects and tone shifts line up with your gains. Use audio as a re-engagement tool at natural lulls.",
  },
  on_screen_text_change: {
    headline: "On-screen text keeps your viewers watching — use it on purpose.",
    action:
      "Retention recovers when a key point lands as an overlay. Plan one for each moment your energy naturally dips — totals, rule changes, day counters.",
  },
  other: {
    headline: "One recurring pattern keeps showing up in your gains.",
    action:
      "Read the events below to see what these winning moments share — then do it deliberately.",
  },
}

// Hook windows carry no drop/gain polarity, so hook headlines describe the
// habit and the action points at the evidence instead of prescribing.
const HOOK_ACTION =
  "Open the events below and compare them against each video's hook window — repeat what your strongest openings did in the first fifteen seconds."

const HOOK_COPY: Record<RetentionWindowEventType, InsightCopy> = {
  pacing_change: {
    headline: "Your openings live and die by pace.",
    action: HOOK_ACTION,
  },
  scene_cut: {
    headline: "Fast cutting defines your openings.",
    action: HOOK_ACTION,
  },
  topic_shift: {
    headline: "Your openings move through ideas quickly.",
    action: HOOK_ACTION,
  },
  visual_change: {
    headline: "Your openings lean on visual variety.",
    action: HOOK_ACTION,
  },
  audio_change: {
    headline: "Sound sets up your openings.",
    action: HOOK_ACTION,
  },
  on_screen_text_change: {
    headline: "Text overlays carry your openings.",
    action: HOOK_ACTION,
  },
  other: {
    headline: "Your openings share a recurring pattern.",
    action: HOOK_ACTION,
  },
}

const COPY_BY_KIND: Record<
  ChannelInsightKind,
  Record<RetentionWindowEventType, InsightCopy>
> = {
  fix: FIX_COPY,
  strength: STRENGTH_COPY,
  hook: HOOK_COPY,
}

export function insightCopy(
  kind: ChannelInsightKind,
  eventType: RetentionWindowEventType,
): InsightCopy {
  return COPY_BY_KIND[kind][eventType]
}
