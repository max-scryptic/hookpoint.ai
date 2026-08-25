// =============================================================================
// THE PROMPT REGISTRY - EVERY PROMPT THE APP SENDS TO A MODEL, IN ONE PLACE
//
// Each entry pairs a stable key with the prompt's shipped default text and the
// metadata the admin Prompts page renders it under. The key is what an override
// is stored against (public.prompt_versions.prompt_key) and what a call site
// asks for, so it is permanent: renaming one orphans its history and silently
// drops the live override back to the default.
//
// Adding a prompt means adding it here and calling resolvePrompt(key) at the
// site that sends it. Nothing else registers itself, which is deliberate - the
// admin page must be able to list every prompt without loading the pipeline
// modules that send them, and lib/__tests__/prompts-registry.test.ts fails the
// build if a default drifts out of sync with what a call site actually asks for.
//
// The defaults live in lib/prompts/defaults/*, which import nothing: the
// registry pulls from them, the resolver pulls from the registry, and the call
// sites pull from the resolver, so the chain never loops back on itself.
// =============================================================================

import { COMPARABILITY_PROMPT } from "@/lib/comparison-comparability"
import {
  PACKAGING_COMPARISON_PROMPT,
  RETENTION_COMPARISON_PROMPT,
  SCRIPT_COMPARISON_PROMPT,
} from "@/lib/prompts/defaults/comparison"
import {
  AUDIO_ANALYSIS_PROMPT,
  AUDIO_ANALYSIS_RETRY_PROMPT,
  AUDIO_ANALYSIS_USER_PROMPT,
  EVENT_SYNTHESIS_PROMPT,
  SNAPSHOT_ANALYSIS_PROMPT,
  TRANSCRIPT_TAXONOMY_PROMPT,
} from "@/lib/prompts/defaults/deep-analysis"
import {
  PACKAGING_ALIGNMENT_PROMPT,
  PACKAGING_TAXONOMY_PROMPT,
  PACING_PROMPT,
  RETENTION_ATTRIBUTION_PROMPT,
  SCRIPT_TAXONOMY_PROMPT,
} from "@/lib/prompts/defaults/light-analysis"
import { TIP_EXAMPLES_PROMPT } from "@/lib/prompts/defaults/tips"
import { TIP_VOICE_PROMPT } from "@/lib/tip-voice"

// The pipelines a prompt can belong to. Mirrors how the cost surfaces already
// split the app's LLM work (lib/llm-call-types.ts), plus a group for the
// fragments that are quoted by other prompts rather than sent on their own.
export const PROMPT_GROUPS = [
  "light_analysis",
  "deep_analysis",
  "comparison",
  "tips",
  "shared",
] as const

export type PromptGroup = (typeof PROMPT_GROUPS)[number]

export const PROMPT_GROUP_LABELS: Record<PromptGroup, string> = {
  light_analysis: "Light analysis",
  deep_analysis: "Deep analysis",
  comparison: "Video comparison",
  tips: "Tips",
  shared: "Shared fragments",
}

export const PROMPT_GROUP_DESCRIPTIONS: Record<PromptGroup, string> = {
  light_analysis:
    "The pass every video goes through when it is first analysed.",
  deep_analysis:
    "The opt-in pass over an uploaded source file: frames, audio and the retention curve read together.",
  comparison: "The head-to-head reports generated between two videos.",
  tips: "Written on demand when a creator opens a tip, rather than as part of a run.",
  shared:
    "Rules quoted by other prompts rather than sent on their own. Editing one changes every prompt that references it.",
}

// Which turn of the request the prompt is sent as. Worth showing in the admin,
// because it is the difference between a rule the model is configured with and
// a line it is asked to act on right next to the payload.
export type PromptRole = "developer" | "user" | "fragment"

export const PROMPT_ROLE_LABELS: Record<PromptRole, string> = {
  developer: "Developer turn",
  user: "User turn",
  fragment: "Fragment",
}

export type PromptDefinition = {
  key: string
  label: string
  group: PromptGroup
  role: PromptRole
  // What the prompt is for, in the admin list. One or two sentences.
  description: string
  // Where the resolved text is sent from, so an admin editing it can go and
  // read the code around it.
  source: string
  // The env var naming the model this prompt is sent to, where the call site
  // has one. Shown so an admin can see which model an edit will land on.
  modelEnvVar: string | null
  // The shipped text, used whenever no override is active for this key.
  default: string
  // Fragment keys this prompt quotes as {{placeholders}}. Resolved recursively
  // by lib/prompts/resolve.ts, so an override of the fragment reaches every
  // prompt that quotes it without those prompts being edited.
  fragments: readonly string[]
}

// The shared fragments, declared first so the prompts that quote them can name
// their keys. A fragment is a prompt like any other: editable, versioned, and
// resolved through the same path.
export const TIP_VOICE_KEY = "tip_voice"
export const COMPARABILITY_KEY = "comparability"

const DEFINITIONS: readonly PromptDefinition[] = [
  // --- Shared fragments -----------------------------------------------------
  {
    key: TIP_VOICE_KEY,
    label: "Tip voice",
    group: "shared",
    role: "fragment",
    description:
      "The rules every \"Try:\" tip is written under: advice for the next video, never a note on the one that was analysed. Quoted by every prompt that writes a tip.",
    source: "lib/tip-voice.ts",
    modelEnvVar: null,
    default: TIP_VOICE_PROMPT,
    fragments: [],
  },
  {
    key: COMPARABILITY_KEY,
    label: "Comparability rules",
    group: "shared",
    role: "fragment",
    description:
      "What a pair of videos is allowed to be compared on when their audiences were very differently sized. Quoted by the comparison reports.",
    source: "lib/comparison-comparability.ts",
    modelEnvVar: null,
    default: COMPARABILITY_PROMPT,
    fragments: [],
  },

  // --- Light analysis -------------------------------------------------------
  {
    key: "pacing",
    label: "Pacing analysis",
    group: "light_analysis",
    role: "developer",
    description:
      "Reads narrative pacing window by window and picks the stretches most worth reviewing.",
    source: "lib/pacing-analysis.ts",
    modelEnvVar: "OPENAI_PACING_MODEL",
    default: PACING_PROMPT,
    fragments: [TIP_VOICE_KEY],
  },
  {
    key: "retention_attribution",
    label: "Retention attribution",
    group: "light_analysis",
    role: "developer",
    description:
      "Explains each hook, drop-off, gain and hold from the transcript spoken around it, and decides whether the words earn a tip.",
    source: "lib/retention-attribution.ts",
    modelEnvVar: "OPENAI_RETENTION_ATTRIBUTION_MODEL",
    default: RETENTION_ATTRIBUTION_PROMPT,
    fragments: [TIP_VOICE_KEY],
  },
  {
    key: "packaging_alignment",
    label: "Packaging alignment",
    group: "light_analysis",
    role: "developer",
    description:
      "Judges whether the title, thumbnail and spoken hook all promise the same thing. Sent with the thumbnail image.",
    source: "lib/packaging-alignment.ts",
    modelEnvVar: "OPENAI_PACKAGING_MODEL",
    default: PACKAGING_ALIGNMENT_PROMPT,
    fragments: [TIP_VOICE_KEY],
  },
  {
    key: "packaging_taxonomy",
    label: "Packaging taxonomy",
    group: "light_analysis",
    role: "developer",
    description:
      "Classifies the title, thumbnail and opening into the fixed packaging taxonomy that channel trends are built from.",
    source: "lib/packaging-taxonomy.ts",
    modelEnvVar: "OPENAI_PACKAGING_MODEL",
    default: PACKAGING_TAXONOMY_PROMPT,
    fragments: [],
  },
  {
    key: "script_taxonomy",
    label: "Script taxonomy",
    group: "light_analysis",
    role: "developer",
    description:
      "Classifies the spoken script into the fixed script taxonomy: format, substance, emotion, rhetoric and drivers.",
    source: "lib/script-taxonomy.ts",
    modelEnvVar: "OPENAI_SCRIPT_MODEL",
    default: SCRIPT_TAXONOMY_PROMPT,
    fragments: [],
  },

  // --- Deep analysis --------------------------------------------------------
  {
    key: "snapshot",
    label: "Snapshot analysis",
    group: "deep_analysis",
    role: "developer",
    description:
      "Describes the sampled frames of one retention window, scoring the visual-packaging axes on each.",
    source: "lib/retention-window-media-analysis.ts",
    modelEnvVar: "OPENAI_SNAPSHOT_ANALYSIS_MODEL",
    default: SNAPSHOT_ANALYSIS_PROMPT,
    fragments: [],
  },
  {
    key: "audio",
    label: "Audio analysis",
    group: "deep_analysis",
    role: "developer",
    description:
      "Describes the non-verbal audio of one window's clip: tone, energy, music, speaker count and audible events.",
    source: "lib/retention-window-media-analysis.ts",
    modelEnvVar: "OPENAI_AUDIO_ANALYSIS_MODEL",
    default: AUDIO_ANALYSIS_PROMPT,
    fragments: [],
  },
  {
    key: "audio_user_turn",
    label: "Audio analysis (user turn)",
    group: "deep_analysis",
    role: "user",
    description:
      "Sent beside the audio clip itself, because audio-capable models answer the clip instead of analysing it when only the developer turn asks.",
    source: "lib/retention-window-media-analysis.ts",
    modelEnvVar: "OPENAI_AUDIO_ANALYSIS_MODEL",
    default: AUDIO_ANALYSIS_USER_PROMPT,
    fragments: [],
  },
  {
    key: "audio_retry_turn",
    label: "Audio analysis (retry turn)",
    group: "deep_analysis",
    role: "user",
    description:
      "The blunter re-ask used for the single retry when the first audio response could not be parsed as JSON.",
    source: "lib/retention-window-media-analysis.ts",
    modelEnvVar: "OPENAI_AUDIO_ANALYSIS_MODEL",
    default: AUDIO_ANALYSIS_RETRY_PROMPT,
    fragments: [],
  },
  {
    key: "transcript_taxonomy",
    label: "Window transcript taxonomy",
    group: "deep_analysis",
    role: "developer",
    description:
      "Classifies one window's spoken words into the window taxonomy that the event synthesizer reads as corroborating context.",
    source: "lib/retention-window-transcript-taxonomy.ts",
    modelEnvVar: "OPENAI_SCRIPT_MODEL",
    default: TRANSCRIPT_TAXONOMY_PROMPT,
    fragments: [],
  },
  {
    key: "event_synthesis",
    label: "Event synthesis",
    group: "deep_analysis",
    role: "developer",
    description:
      "Turns all of a window's evidence (frames, audio, editing metrics, transcript, baselines, channel history) into the timestamped events shown on the video page.",
    source: "lib/retention-window-event-synthesis.ts",
    modelEnvVar: "OPENAI_EVENT_SYNTHESIS_MODEL",
    default: EVENT_SYNTHESIS_PROMPT,
    fragments: [],
  },

  // --- Tips -----------------------------------------------------------------
  {
    key: "tip_examples",
    label: "Tip examples",
    group: "tips",
    role: "developer",
    description:
      "Writes the three worked examples shown when a creator opens a \"Try:\" tip: the advice already carried out, in the words they would say or type.",
    source: "lib/tip-examples-generation.ts",
    modelEnvVar: "OPENAI_TIP_EXAMPLES_MODEL",
    default: TIP_EXAMPLES_PROMPT,
    fragments: [],
  },

  // --- Comparison reports ---------------------------------------------------
  {
    key: "script_comparison",
    label: "Script comparison report",
    group: "comparison",
    role: "developer",
    description:
      "Writes the head-to-head on what two videos say and how they say it.",
    source: "lib/script-comparison-report.ts",
    modelEnvVar: "OPENAI_SCRIPT_COMPARISON_MODEL",
    default: SCRIPT_COMPARISON_PROMPT,
    fragments: [COMPARABILITY_KEY, TIP_VOICE_KEY],
  },
  {
    key: "packaging_comparison",
    label: "Packaging comparison report",
    group: "comparison",
    role: "developer",
    description:
      "Writes the head-to-head on two videos' thumbnails, titles, hooks and how well each set aligns.",
    source: "lib/packaging-comparison-report.ts",
    modelEnvVar: "OPENAI_PACKAGING_COMPARISON_MODEL",
    default: PACKAGING_COMPARISON_PROMPT,
    fragments: [COMPARABILITY_KEY, TIP_VOICE_KEY],
  },
  {
    key: "retention_comparison",
    label: "Retention comparison report",
    group: "comparison",
    role: "developer",
    description:
      "Writes the head-to-head on two retention curves: who held more, where they separated, and why.",
    source: "lib/retention-comparison-report.ts",
    modelEnvVar: "OPENAI_RETENTION_COMPARISON_MODEL",
    default: RETENTION_COMPARISON_PROMPT,
    fragments: [TIP_VOICE_KEY],
  },
]

export const PROMPT_DEFINITIONS = DEFINITIONS

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]))

export type PromptKey = string

export function promptDefinition(key: string): PromptDefinition | null {
  return BY_KEY.get(key) ?? null
}

export function isPromptKey(key: string): boolean {
  return BY_KEY.has(key)
}

// Every registered key, in the order the admin page lists them: grouped, and in
// declaration order within a group.
export const PROMPT_KEYS: readonly string[] = DEFINITIONS.map(
  (definition) => definition.key,
)

// The definitions of one group, for the grouped admin listing.
export function promptsInGroup(group: PromptGroup): PromptDefinition[] {
  return DEFINITIONS.filter((definition) => definition.group === group)
}
