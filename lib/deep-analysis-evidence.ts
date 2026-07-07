// Aggregates every piece of "deep analysis" evidence a video's retention
// windows have accumulated so far — synthesized events, clipped transcripts,
// harvested snapshots (with signed read URLs) and the harvested audio clip
// (with a signed read URL) — grouped by window, for the analysis detail
// page's evidence breakdown (components/deep-analysis-evidence.tsx).
//
// Purely read-only: it never triggers extraction/analysis/synthesis, just
// renders whatever lib/retention-window-media-trigger.ts has produced so far,
// however partial.

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  getRetentionWindowCostsForVideo,
  type RetentionWindowCost,
} from "@/lib/retention-window-costs"
import { getRetentionWindowMediaStorageProvider } from "@/lib/retention-window-media-config"
import {
  getRetentionWindowAudioForVideo,
  getRetentionWindowSnapshotsForVideo,
  type RetentionWindowAudioClip,
  type RetentionWindowSnapshot,
} from "@/lib/retention-window-media"
import {
  getRetentionWindowEvents,
  type RetentionWindowEvent,
} from "@/lib/retention-window-events"
import { getRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import {
  getRetentionWindows,
  type PersistedRetentionWindow,
} from "@/lib/retention-windows"

// Long enough to cover a single page view without needing to be refreshed,
// the same reasoning the source-file playback URL (60 minutes) already uses.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60

export interface DeepAnalysisSnapshotView extends RetentionWindowSnapshot {
  imageUrl: string | null
}

export interface DeepAnalysisAudioView extends RetentionWindowAudioClip {
  audioUrl: string | null
}

export interface WindowEvidence {
  window: PersistedRetentionWindow
  displayLabel: string
  events: RetentionWindowEvent[]
  transcript: string | null
  snapshots: DeepAnalysisSnapshotView[]
  audio: DeepAnalysisAudioView | null
  // What each of this window's LLM calls cost, and their sum. Empty/0 for a
  // window analysed before cost tracking existed (or whose costing writes
  // failed) — those simply render no cost figure.
  costs: RetentionWindowCost[]
  totalCostUsd: number
}

const KIND_ORDER: Record<PersistedRetentionWindow["kind"], number> = {
  hook: 0,
  drop_off: 1,
  gain: 2,
}

function windowDisplayLabel(window: PersistedRetentionWindow): string {
  if (window.kind === "hook") return window.label ?? "Hook"
  const ordinal = window.windowIndex + 1
  return window.kind === "drop_off" ? `Drop-off #${ordinal}` : `Gain #${ordinal}`
}

// Loads a video's full evidence set and groups it by window, skipping any
// window nothing has been harvested or synthesized for yet (e.g. a hook
// window with no analysis range, or a window whose media is still pending).
// Windows are ordered hook, then drop-off, then gain — each by windowIndex —
// matching the order the rest of the detail page presents them in.
export async function getDeepAnalysisEvidence(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<WindowEvidence[]> {
  const [windows, events, transcripts, snapshots, audioClips, costs] =
    await Promise.all([
      getRetentionWindows(supabase, userId, analysedVideoId),
      getRetentionWindowEvents(supabase, userId, analysedVideoId),
      getRetentionWindowTranscripts(supabase, userId, analysedVideoId),
      getRetentionWindowSnapshotsForVideo(supabase, userId, analysedVideoId),
      getRetentionWindowAudioForVideo(supabase, userId, analysedVideoId),
      getRetentionWindowCostsForVideo(supabase, userId, analysedVideoId),
    ])

  const eventsByWindow = new Map<string, RetentionWindowEvent[]>()
  for (const event of events) {
    const group = eventsByWindow.get(event.retentionWindowId)
    if (group) group.push(event)
    else eventsByWindow.set(event.retentionWindowId, [event])
  }

  const transcriptByWindow = new Map(
    transcripts.map((t) => [t.retentionWindowId, t.transcript]),
  )

  const snapshotsByWindow = new Map<string, RetentionWindowSnapshot[]>()
  for (const snapshot of snapshots) {
    const group = snapshotsByWindow.get(snapshot.retentionWindowId)
    if (group) group.push(snapshot)
    else snapshotsByWindow.set(snapshot.retentionWindowId, [snapshot])
  }

  const audioByWindow = new Map(audioClips.map((a) => [a.retentionWindowId, a]))

  const costsByWindow = new Map<string, RetentionWindowCost[]>()
  for (const cost of costs) {
    const group = costsByWindow.get(cost.retentionWindowId)
    if (group) group.push(cost)
    else costsByWindow.set(cost.retentionWindowId, [cost])
  }

  const mediaStorage = getRetentionWindowMediaStorageProvider()

  async function signedUrlFor(storagePath: string | null): Promise<string | null> {
    if (!storagePath) return null
    try {
      return await mediaStorage.createSignedReadUrl(
        storagePath,
        SIGNED_URL_EXPIRY_SECONDS,
      )
    } catch (error) {
      console.error("Failed to sign deep analysis media URL", error)
      return null
    }
  }

  const sortedWindows = [...windows].sort((a, b) => {
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    return kindDiff !== 0 ? kindDiff : a.windowIndex - b.windowIndex
  })

  const result: WindowEvidence[] = []
  for (const window of sortedWindows) {
    const windowEvents = eventsByWindow.get(window.id) ?? []
    const transcript = transcriptByWindow.get(window.id) ?? null
    const windowSnapshots = snapshotsByWindow.get(window.id) ?? []
    const audio = audioByWindow.get(window.id) ?? null
    const windowCosts = costsByWindow.get(window.id) ?? []

    if (
      windowEvents.length === 0 &&
      transcript == null &&
      windowSnapshots.length === 0 &&
      audio == null
    ) {
      continue
    }

    const snapshotViews: DeepAnalysisSnapshotView[] = await Promise.all(
      windowSnapshots.map(async (snapshot) => ({
        ...snapshot,
        imageUrl:
          snapshot.status === "ready"
            ? await signedUrlFor(snapshot.storagePath)
            : null,
      })),
    )

    const audioView: DeepAnalysisAudioView | null = audio
      ? {
          ...audio,
          audioUrl: audio.status === "ready" ? await signedUrlFor(audio.storagePath) : null,
        }
      : null

    result.push({
      window,
      displayLabel: windowDisplayLabel(window),
      events: windowEvents,
      transcript,
      snapshots: snapshotViews,
      audio: audioView,
      costs: windowCosts,
      totalCostUsd: windowCosts.reduce((sum, cost) => sum + cost.costUsd, 0),
    })
  }

  return result
}
