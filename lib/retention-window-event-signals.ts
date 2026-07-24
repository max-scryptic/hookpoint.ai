// Builds the deterministic `signals` block for a synthesized event: a
// comparison-grade snapshot of the measured evidence at the event's moment,
// captured from the same evidence bundle the synthesizer already assembled, so
// no extra model call and no fabrication risk. The model picks the timestamp,
// the type, and writes the narrative; this attaches the numbers that justified
// it (editing/audio/motion metrics and their deviations from the video's
// baseline and from the preceding control, plus the vision read of the nearest
// sampled frame) so they stop being hidden behind the prose.
//
// Deliberately decoupled from the synthesizer: it takes a structural subset of
// the evidence bundle (EventSignalsInput) rather than importing WindowEvidence,
// so there is no import cycle and the function is trivial to unit test. A full
// WindowEvidence satisfies EventSignalsInput structurally, so the orchestrator
// passes its bundle straight through.

import {
  EVENT_SIGNALS_SCHEMA_VERSION,
  type EventSignals,
} from "@/lib/retention-window-events"
import type {
  AudioAnalysis,
  SnapshotAnalysis,
} from "@/lib/retention-window-media-analysis"

// The subset of the window evidence bundle the signals block reads. Kept as its
// own type so this module never imports the synthesizer (which would cycle) and
// tests can build a minimal input by hand.
export interface EventSignalsInput {
  delta: number
  steepness: number | null
  relativePerformance: number | null
  editing: {
    cutsPerMinute: number | null
    freezeCoverage: number
    blackCoverage: number
  }
  baseline: {
    cutsPerMinute: number | null
    freezeCoverage: number | null
    blackCoverage: number | null
    speechRate: number | null
    motion: number | null
  }
  visual: Array<{
    chunkIndex: number
    timestampSeconds: number
    ocrText: string | null
    analysis: SnapshotAnalysis
  }>
  audio: AudioAnalysis | null
  contrast: {
    editingDelta: {
      cutsPerMinute: number | null
      freezeCoverage: number
      blackCoverage: number
    }
    audioDelta: {
      averageVolumeDb: number | null
      silence: number | null
      speechRate: number | null
    }
    motionDelta: number | null
    targetMotion: number | null
    controlMotion: number | null
  } | null
}

function subtractNullable(
  target: number | null,
  reference: number | null,
): number | null {
  return target != null && reference != null ? target - reference : null
}

// The sampled frame closest in time to the event's timestamp, or null when no
// frame was sampled for the window. Ties resolve to the earlier frame, since
// the scan first pass is chronological and a stable pick keeps signals
// reproducible across re-runs.
function nearestFrame(
  frames: EventSignalsInput["visual"],
  timestampSeconds: number,
): EventSignalsInput["visual"][number] | null {
  let best: EventSignalsInput["visual"][number] | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    const distance = Math.abs(frame.timestampSeconds - timestampSeconds)
    if (distance < bestDistance) {
      best = frame
      bestDistance = distance
    }
  }
  return best
}

// Assembles the structured signals for one event. Pure and deterministic: the
// same input and timestamp always produce the same block.
export function buildEventSignals(
  input: EventSignalsInput,
  timestampSeconds: number,
): EventSignals {
  const { editing, baseline, audio, contrast } = input
  const frame = nearestFrame(input.visual, timestampSeconds)

  return {
    schemaVersion: EVENT_SIGNALS_SCHEMA_VERSION,
    window: {
      delta: input.delta,
      steepness: input.steepness,
      relativePerformance: input.relativePerformance,
    },
    editing: {
      cutsPerMinute: editing.cutsPerMinute,
      freezeCoverage: editing.freezeCoverage,
      blackCoverage: editing.blackCoverage,
      cutsPerMinuteBaselineDelta: subtractNullable(
        editing.cutsPerMinute,
        baseline.cutsPerMinute,
      ),
      freezeCoverageBaselineDelta: subtractNullable(
        editing.freezeCoverage,
        baseline.freezeCoverage,
      ),
      blackCoverageBaselineDelta: subtractNullable(
        editing.blackCoverage,
        baseline.blackCoverage,
      ),
    },
    audio:
      audio == null
        ? null
        : {
            energy: audio.energy,
            tone: audio.tone,
            music: audio.music,
            musicDescription: audio.music_description,
            speakers: audio.speakers,
            speechRate: audio.speech_rate,
            speechRateBaselineDelta: subtractNullable(
              audio.speech_rate,
              baseline.speechRate,
            ),
            averageVolumeDb: audio.average_volume,
            silence: audio.silence,
            notableEvents: audio.notable_events,
          },
    contrast:
      contrast == null
        ? null
        : {
            cutsPerMinuteDelta: contrast.editingDelta.cutsPerMinute,
            freezeCoverageDelta: contrast.editingDelta.freezeCoverage,
            blackCoverageDelta: contrast.editingDelta.blackCoverage,
            averageVolumeDbDelta: contrast.audioDelta.averageVolumeDb,
            silenceDelta: contrast.audioDelta.silence,
            speechRateDelta: contrast.audioDelta.speechRate,
            motionDelta: contrast.motionDelta,
            targetMotion: contrast.targetMotion,
            controlMotion: contrast.controlMotion,
          },
    frame:
      frame == null
        ? null
        : {
            chunkIndex: frame.chunkIndex,
            timestampSeconds: frame.timestampSeconds,
            scene: frame.analysis.scene,
            faceVisible: frame.analysis.face_visible,
            containsText: frame.analysis.contains_text,
            containsCode: frame.analysis.contains_code,
            motion: frame.analysis.motion,
            peopleCount: frame.analysis.people_count,
            cameraMovement: frame.analysis.camera_movement,
            notableEvent: frame.analysis.notable_event,
            ocrText: frame.ocrText,
          },
  }
}
