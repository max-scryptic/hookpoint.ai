import type {
  ChannelInsightKind,
  ChannelPlaybookKind,
  PackagingFeature,
} from "@/lib/channel-trends"
import type {
  HookDelivery,
  PromiseType,
  TitleStyle,
} from "@/lib/packaging-taxonomy"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"

// COPY GUARDRAIL: no em dashes (U+2014), ever, in any copy in this file or
// anywhere on the Channel Trends page. Hyphens are fine. See
// lib/copy-guardrails.ts; enforced by lib/__tests__/copy-guardrails.test.ts.
//
// The written half of a channel insight: lib/channel-trends.ts decides WHICH
// patterns have earned a verdict; this map decides what the verdict says. One
// headline plus one concrete suggestion per event type per insight kind  - 
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
      "Give viewers a reason to follow the cut - carry a sentence, a sound, or motion across it so the change feels like a continuation, not a restart.",
  },
  topic_shift: {
    headline: "Abrupt topic changes are where your viewers bail.",
    action:
      "Signpost before you switch topics. One line that sells why the next section matters keeps viewers from treating the shift as an exit.",
  },
  visual_change: {
    headline: "Big visual switches keep costing you viewers.",
    action:
      "Ease into visual resets. When the whole frame changes - new location, new setup - anchor it with continuity: similar framing, an overlay, or your voice carrying over the change.",
  },
  audio_change: {
    headline: "Audio shifts line up with your drop-offs.",
    action:
      "Watch your sound transitions. Music ending, tone flattening or a loudness jump reads as a natural exit point - keep an audio bed running through slower moments.",
  },
  on_screen_text_change: {
    headline: "On-screen text moments line up with your drop-offs.",
    action:
      "Check your overlays. Text that arrives dense, fast or off-topic gives viewers a reason to skip - keep overlays short and tied to what you're saying in the moment.",
  },
  other: {
    headline: "One recurring pattern keeps showing up where viewers leave.",
    action:
      "Read the events below. These moments didn't fit a single cause, but they recur - the narratives usually show what they share.",
  },
}

const STRENGTH_COPY: Record<RetentionWindowEventType, InsightCopy> = {
  pacing_change: {
    headline: "Pace shifts are winning viewers back - use them on purpose.",
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
      "New angles, locations and b-roll line up with your retention gains - plan a visual reset into any segment that runs long.",
  },
  audio_change: {
    headline: "Sound changes are holding your viewers.",
    action:
      "Music drops, sound effects and tone shifts line up with your gains. Use audio as a re-engagement tool at natural lulls.",
  },
  on_screen_text_change: {
    headline: "On-screen text keeps your viewers watching - use it on purpose.",
    action:
      "Retention recovers when a key point lands as an overlay. Plan one for each moment your energy naturally dips - totals, rule changes, day counters.",
  },
  other: {
    headline: "One recurring pattern keeps showing up in your gains.",
    action:
      "Read the events below to see what these winning moments share - then do it deliberately.",
  },
}

// Hook windows carry no drop/gain polarity, so hook headlines describe the
// habit and the action points at the evidence instead of prescribing.
const HOOK_ACTION =
  "Open the events below and compare them against each video's hook window - repeat what your strongest hooks did in the first fifteen seconds."

const HOOK_COPY: Record<RetentionWindowEventType, InsightCopy> = {
  pacing_change: {
    headline: "Your hooks live and die by pace.",
    action: HOOK_ACTION,
  },
  scene_cut: {
    headline: "Fast cutting defines your hooks.",
    action: HOOK_ACTION,
  },
  topic_shift: {
    headline: "Your hooks move through ideas quickly.",
    action: HOOK_ACTION,
  },
  visual_change: {
    headline: "Your hooks lean on visual variety.",
    action: HOOK_ACTION,
  },
  audio_change: {
    headline: "Sound sets up your hooks.",
    action: HOOK_ACTION,
  },
  on_screen_text_change: {
    headline: "Text overlays carry your hooks.",
    action: HOOK_ACTION,
  },
  other: {
    headline: "Your hooks share a recurring pattern.",
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

export interface PlaybookCopy extends InsightCopy {
  whenToUse: string
}

const KEEP_COPY: Record<RetentionWindowEventType, InsightCopy> = {
  pacing_change: {
    headline: "A controlled pace is protecting attention.",
    action:
      "Preserve this rhythm through explanation-heavy sections. Plan any speed change as a deliberate reset instead of letting the section drift.",
  },
  scene_cut: {
    headline: "Purposeful cuts are sustaining attention.",
    action:
      "Keep using cuts that advance the idea or reveal new information. Your hold evidence suggests continuity matters more than cutting for its own sake.",
  },
  topic_shift: {
    headline: "Clear topic progression keeps viewers with you.",
    action:
      "Structure longer sections as a sequence of small, clearly connected ideas so viewers always know why the next point matters.",
  },
  visual_change: {
    headline: "Visual resets are protecting attention.",
    action:
      "Plan a relevant visual change into long explanations: a new angle, demonstration, b-roll example, or result that advances the point.",
  },
  audio_change: {
    headline: "Your sound design helps maintain momentum.",
    action:
      "Preserve the audio continuity and intentional energy shifts shown in these holds, especially through transitions and slower passages.",
  },
  on_screen_text_change: {
    headline: "Useful on-screen text is keeping viewers oriented.",
    action:
      "Continue using concise overlays to land key facts, steps, totals, or rules exactly when viewers need them.",
  },
  other: {
    headline: "A repeatable hold pattern is emerging.",
    action:
      "Compare the evidence receipts and preserve the shared behaviour when you plan the next version of this kind of section.",
  },
}

export function playbookCopy(
  kind: ChannelPlaybookKind,
  eventType: RetentionWindowEventType,
): PlaybookCopy {
  const copy =
    kind === "keep"
      ? KEEP_COPY[eventType]
      : kind === "fix"
        ? FIX_COPY[eventType]
        : STRENGTH_COPY[eventType]
  const whenToUse =
    kind === "keep"
      ? "Use while a section is already holding attention."
      : kind === "fix"
        ? "Check before every transition or slower passage."
        : "Deploy when a section begins to flatten."
  return { ...copy, whenToUse }
}

// --- Packaging feature labels ----------------------------------------------
// Human names for the packaging taxonomy's countable trait flags, shown in
// the "what your high-reach packaging does differently" contrast.

const TITLE_STYLE_LABELS: Record<TitleStyle, string> = {
  curiosity_gap: "Curiosity-gap title",
  how_to: "How-to title",
  number_list: "Numbered-list title",
  question: "Question title",
  negative_warning: "Warning / mistake title",
  result_claim: "Result-claim title",
  challenge: "Challenge title",
  personal_story: "Personal-story title",
  direct_label: "Plain descriptive title",
}

const PROMISE_LABELS: Record<PromiseType, string> = {
  transformation: "Transformation promise",
  result_reveal: "Result-reveal promise",
  how_to: "Instructional promise",
  list: "List promise",
  story: "Story promise",
  challenge: "Challenge promise",
  opinion: "Opinion promise",
  comparison: "Comparison promise",
  other: "Unclassified promise",
}

const HOOK_DELIVERY_LABELS: Record<HookDelivery, string> = {
  direct: "Hook pays off the promise immediately",
  delayed: "Hook takes its time reaching the promise",
  absent: "Hook never addresses the promise",
}

const FLAT_FEATURE_LABELS: Record<string, string> = {
  "thumb:face": "Face in the thumbnail",
  "thumb:no_face": "No face in the thumbnail",
  "thumb:text_free": "Text-free thumbnail",
  "thumb:text_light": "Light thumbnail text (1-3 words)",
  "thumb:text_heavy": "Text-heavy thumbnail (4+ words)",
  "alignment:tight": "Tight title-thumbnail-hook alignment",
  "alignment:loose": "Loose title-thumbnail-hook alignment",
}

export function packagingFeatureLabel(feature: PackagingFeature): string {
  const flat = FLAT_FEATURE_LABELS[feature]
  if (flat) return flat
  const [prefix, value] = feature.split(":") as [string, string]
  if (prefix === "title") return TITLE_STYLE_LABELS[value as TitleStyle]
  if (prefix === "promise") return PROMISE_LABELS[value as PromiseType]
  if (prefix === "hook") return HOOK_DELIVERY_LABELS[value as HookDelivery]
  return feature
}

// --- Taxonomy axis labels ---------------------------------------------------
// Human names for the 0-10 axes the packaging and script taxonomies score every
// video on. `name` heads the row; `meaning` says what a 10 would mean, so a bar
// is never a bare number the reader has to interpret.

export interface AxisCopy {
  name: string
  meaning: string
}

const AXIS_COPY: Record<string, AxisCopy> = {
  "title.specificity": {
    name: "Specificity",
    meaning: "names concrete numbers, people or stakes",
  },
  "title.curiosityGap": {
    name: "Curiosity gap",
    meaning: "withholds the payoff and opens a loop",
  },
  "title.emotionalCharge": {
    name: "Emotional charge",
    meaning: "pulls hard on a feeling",
  },
  "title.stakes": { name: "Stakes", meaning: "puts something on the line" },
  "title.relatability": {
    name: "Relatability",
    meaning: "a target viewer sees themselves in it",
  },
  "title.novelty": {
    name: "Novelty",
    meaning: "contrarian or pattern-breaking rather than well-worn",
  },
  "title.clarity": {
    name: "Clarity",
    meaning: "the payoff is unmistakable",
  },
  "thumbnail.faceProminence": {
    name: "Face prominence",
    meaning: "a face fills the frame",
  },
  "thumbnail.emotionIntensity": {
    name: "Expression intensity",
    meaning: "an extreme expression rather than a neutral one",
  },
  "thumbnail.colorContrast": {
    name: "Colour contrast",
    meaning: "high-contrast and thumbstopping",
  },
  "thumbnail.visualComplexity": {
    name: "Visual complexity",
    meaning: "busy and crowded rather than clean and single-subject",
  },
  "hook.payoffSpeed": {
    name: "Payoff speed",
    meaning: "the hook delivers the title's promise in the first breath",
  },
  "hook.restatesPromise": {
    name: "Restates the promise",
    meaning: "the hook says the title's promise back, head-on",
  },
  "hook.stakesEstablished": {
    name: "Stakes established",
    meaning: "vivid tension is set up immediately",
  },
  "hook.specificity": {
    name: "Hook specificity",
    meaning: "concrete detail up front rather than a vague setup",
  },
  "hook.personalDisclosure": {
    name: "Personal disclosure",
    meaning: "a candid first-person hook rather than an impersonal one",
  },
  "cross.titleThumbnailMatch": {
    name: "Title and thumbnail match",
    meaning: "both promise the same one thing",
  },
  "cross.hookDeliversPromise": {
    name: "Hook delivers the promise",
    meaning: "the first words cash what the packaging sold",
  },
  "substance.substanceDensity": {
    name: "Substance density",
    meaning: "dense with ideas rather than thin",
  },
  "substance.concreteness": {
    name: "Concreteness",
    meaning: "full of examples, numbers and names",
  },
  "substance.noveltyOfIdeas": {
    name: "Novelty of ideas",
    meaning: "fresh or surprising rather than familiar",
  },
  "substance.educationalValue": {
    name: "Educational value",
    meaning: "highly instructive",
  },
  "substance.entertainmentValue": {
    name: "Entertainment value",
    meaning: "highly entertaining",
  },
  "substance.fillerLevel": {
    name: "Filler",
    meaning: "heavy padding, throat-clearing and repeated points",
  },
  "structure.topicCohesion": {
    name: "Topic cohesion",
    meaning: "tightly single-threaded rather than scattered",
  },
  "structure.openLoops": {
    name: "Open loops",
    meaning: "leans on unresolved questions to pull viewers forward",
  },
  "structure.payoffPlacement": {
    name: "Payoff placement",
    meaning: "the value is held to the end rather than front-loaded",
  },
  "emotion.energy": {
    name: "Energy",
    meaning: "high intensity throughout",
  },
  "emotion.emotionalRange": {
    name: "Emotional range",
    meaning: "a wide dynamic range rather than one register",
  },
  "emotion.vulnerability": {
    name: "Vulnerability",
    meaning: "candid, personal disclosure across the script",
  },
  "humor.humorDensity": {
    name: "Humour",
    meaning: "levity running through the whole script",
  },
  "rhetoric.directAddress": {
    name: "Direct address",
    meaning: "constantly talking to \"you\"",
  },
  "rhetoric.stakes": {
    name: "Stakes",
    meaning: "high, vivid tension in the content itself",
  },
  "rhetoric.relatability": {
    name: "Relatability",
    meaning: "a target viewer clearly sees themselves in it",
  },
}

export function taxonomyAxisCopy(key: string): AxisCopy {
  return AXIS_COPY[key] ?? { name: key, meaning: "" }
}

// Rim labels for the radars, where a full axis name would run into its
// neighbours. Each one is a clipped version of the name above, never a
// different idea, and the chart keeps the full name one hover away. Axes whose
// name is already short enough are absent and fall back to it.
const AXIS_SHORT_LABELS: Record<string, string> = {
  "title.curiosityGap": "Curiosity",
  "title.emotionalCharge": "Emotion",
  "thumbnail.faceProminence": "Face",
  "thumbnail.emotionIntensity": "Expression",
  "thumbnail.colorContrast": "Contrast",
  "thumbnail.visualComplexity": "Complexity",
  "hook.payoffSpeed": "Payoff",
  "hook.restatesPromise": "Restates",
  "hook.stakesEstablished": "Stakes",
  "hook.specificity": "Specificity",
  "hook.personalDisclosure": "Personal",
  "cross.titleThumbnailMatch": "Title/thumb",
  "cross.hookDeliversPromise": "Hook",
  "substance.substanceDensity": "Substance",
  "substance.noveltyOfIdeas": "Novelty",
  "substance.educationalValue": "Educational",
  "substance.entertainmentValue": "Entertaining",
  "structure.topicCohesion": "Cohesion",
  "structure.payoffPlacement": "Payoff",
  "emotion.emotionalRange": "Range",
  "rhetoric.directAddress": "Direct",
}

export function taxonomyAxisShortLabel(key: string): string {
  return AXIS_SHORT_LABELS[key] ?? taxonomyAxisCopy(key).name
}

const AXIS_GROUP_LABELS: Record<string, string> = {
  title: "Title",
  thumbnail: "Thumbnail",
  opening: "Hook",
  alignment: "Alignment",
  substance: "Substance",
  structure: "Structure",
  emotion: "Emotion",
  rhetoric: "Rhetoric",
}

export function taxonomyAxisGroupLabel(group: string): string {
  return AXIS_GROUP_LABELS[group] ?? group
}

// --- Taxonomy category labels -----------------------------------------------
// Human names for the closed vocabularies the style profile counts over. Keyed
// by dimension so the same raw value can read differently in two places.

const DIMENSION_LABELS: Record<string, string> = {
  "packaging.archetype": "Packaging archetype",
  "packaging.primaryDriver": "What earns the click",
  "packaging.titleStyle": "Title style",
  "packaging.openingType": "How you open",
  "packaging.thumbnailMood": "Thumbnail mood",
  "script.format": "Content format",
  "script.archetype": "Script archetype",
  "script.dominantEmotion": "Dominant emotion",
  "script.arcShape": "Emotional arc",
  "script.engagementDriver": "What holds attention",
}

export function taxonomyDimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key
}

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  "packaging.archetype": {
    personal_stakes_confession: "Personal confession",
    warning: "Warning",
    tutorial: "Tutorial",
    listicle: "Listicle",
    hype: "Hype",
    story: "Story",
    opinion: "Opinion",
    other: "Other",
  },
  "packaging.primaryDriver": {
    curiosity: "Curiosity",
    specificity: "Specificity",
    emotion: "Emotion",
    identity: "Identity",
    authority: "Authority",
    novelty: "Novelty",
    controversy: "Controversy",
  },
  "packaging.titleStyle": {
    curiosity_gap: "Curiosity gap",
    how_to: "How-to",
    number_list: "Numbered list",
    question: "Question",
    negative_warning: "Warning or mistake",
    result_claim: "Result claim",
    challenge: "Challenge",
    personal_story: "Personal story",
    direct_label: "Plain descriptive",
  },
  "packaging.openingType": {
    cold_open_story: "Cold open story",
    bold_claim: "Bold claim",
    question: "Question",
    context_setup: "Context setup",
    meta_intro: "Meta intro",
  },
  "packaging.thumbnailMood": {
    serious: "Serious",
    celebratory: "Celebratory",
    alarming: "Alarming",
    casual: "Casual",
    mysterious: "Mysterious",
    other: "Other",
  },
  "script.format": {
    story: "Story",
    tutorial: "Tutorial",
    listicle: "Listicle",
    essay_opinion: "Opinion essay",
    review: "Review",
    vlog: "Vlog",
    interview: "Interview",
    explainer: "Explainer",
    other: "Other",
  },
  "script.archetype": {
    educational_deep_dive: "Educational deep dive",
    entertainment_story: "Entertainment story",
    hype: "Hype",
    calm_essay: "Calm essay",
    personal_vlog: "Personal vlog",
    listicle_roundup: "Listicle roundup",
    opinion_take: "Opinion take",
    other: "Other",
  },
  "script.dominantEmotion": {
    excitement: "Excitement",
    curiosity: "Curiosity",
    humor: "Humour",
    awe: "Awe",
    concern: "Concern",
    outrage: "Outrage",
    warmth: "Warmth",
    calm: "Calm",
    neutral: "Neutral",
  },
  "script.arcShape": {
    flat: "Flat",
    rising: "Rising",
    falling: "Falling",
    roller_coaster: "Roller coaster",
    u_shaped: "U-shaped",
  },
  "script.engagementDriver": {
    information: "Information",
    story: "Story",
    humor: "Humour",
    personality: "Personality",
    emotion: "Emotion",
    controversy: "Controversy",
    utility: "Utility",
  },
}

// Falls back to a title-cased version of the raw enum value, so a vocabulary
// that grows without this map still reads as words rather than snake_case.
export function taxonomyCategoryLabel(
  dimensionKey: string,
  value: string,
): string {
  const mapped = CATEGORY_LABELS[dimensionKey]?.[value]
  if (mapped) return mapped
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
