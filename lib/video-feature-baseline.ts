import type { SupabaseClient } from "@supabase/supabase-js"

import type { SceneCueScanResult } from "@/lib/media/scene-detection"
import type { TranscriptCue } from "@/lib/youtube/youtube"

export const SPARSE_BASELINE_SCHEMA_VERSION = 1
export const SPARSE_BASELINE_SAMPLE_INTERVAL_SECONDS = 60
export const SPARSE_BASELINE_SAMPLE_DURATION_SECONDS = 8

export interface SparseVideoFeatureBaseline {
  schemaVersion: 1
  generatedAt: string
  videoDurationSeconds: number
  sampledSeconds: number
  ranges: Array<{ fromSeconds: number; toSeconds: number }>
  cutsPerMinute: number | null
  freezeCoverage: number | null
  blackCoverage: number | null
  motion: number | null
  speechRate: number | null
}

export function buildSparseBaselineRanges(
  durationSeconds: number,
  sampleDurationSeconds = SPARSE_BASELINE_SAMPLE_DURATION_SECONDS,
  intervalSeconds = SPARSE_BASELINE_SAMPLE_INTERVAL_SECONDS,
): Array<{ fromSeconds: number; toSeconds: number }> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []
  const duration = Math.max(0, durationSeconds)
  const sampleDuration = Math.min(Math.max(1, sampleDurationSeconds), duration)
  if (duration <= sampleDuration) return [{ fromSeconds: 0, toSeconds: duration }]

  const ranges: Array<{ fromSeconds: number; toSeconds: number }> = []
  for (let midpoint = intervalSeconds / 2; midpoint < duration; midpoint += intervalSeconds) {
    const fromSeconds = Math.max(0, Math.min(duration - sampleDuration, midpoint - sampleDuration / 2))
    ranges.push({ fromSeconds, toSeconds: fromSeconds + sampleDuration })
  }
  if (ranges.length === 0) {
    const fromSeconds = (duration - sampleDuration) / 2
    ranges.push({ fromSeconds, toSeconds: fromSeconds + sampleDuration })
  }
  return ranges
}

function overlapDuration(
  ranges: Array<{ fromSeconds: number; toSeconds: number }>,
  fromSeconds: number,
  toSeconds: number,
): number {
  return ranges.reduce(
    (sum, range) =>
      sum +
      Math.max(
        0,
        Math.min(toSeconds, range.toSeconds) - Math.max(fromSeconds, range.fromSeconds),
      ),
    0,
  )
}

export function computeSparseVideoFeatureBaseline(params: {
  durationSeconds: number
  transcript: TranscriptCue[]
  samples: Array<{
    range: { fromSeconds: number; toSeconds: number }
    result: SceneCueScanResult
  }>
  generatedAt?: string
}): SparseVideoFeatureBaseline | null {
  if (params.samples.length === 0) return null
  const ranges = params.samples.map((sample) => sample.range)
  const sampledSeconds = ranges.reduce(
    (sum, range) => sum + Math.max(0, range.toSeconds - range.fromSeconds),
    0,
  )
  if (sampledSeconds <= 0) return null

  const cuts = params.samples.reduce((sum, sample) => sum + sample.result.cuts.length, 0)
  let motionWeighted = 0
  let motionSeconds = 0
  for (const sample of params.samples) {
    for (const bucket of sample.result.motionBuckets ?? []) {
      const seconds = overlapDuration([sample.range], bucket.fromSeconds, bucket.toSeconds)
      motionWeighted += bucket.score * seconds
      motionSeconds += seconds
    }
  }
  const wordCount = params.transcript.reduce(
    (sum, cue) => sum + cue.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  )

  return {
    schemaVersion: SPARSE_BASELINE_SCHEMA_VERSION,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    videoDurationSeconds: params.durationSeconds,
    sampledSeconds,
    ranges,
    cutsPerMinute: (cuts / sampledSeconds) * 60,
    freezeCoverage:
      params.samples.reduce(
        (sum, sample) =>
          sum +
          sample.result.freezes.reduce(
            (inner, cue) =>
              inner + overlapDuration([sample.range], cue.fromSeconds, cue.toSeconds),
            0,
          ),
        0,
      ) / sampledSeconds,
    blackCoverage:
      params.samples.reduce(
        (sum, sample) =>
          sum +
          sample.result.blacks.reduce(
            (inner, cue) =>
              inner + overlapDuration([sample.range], cue.fromSeconds, cue.toSeconds),
            0,
          ),
        0,
      ) / sampledSeconds,
    motion: motionSeconds > 0 ? motionWeighted / motionSeconds : null,
    speechRate:
      params.durationSeconds > 0
        ? Math.round((wordCount / params.durationSeconds) * 60)
        : null,
  }
}

export async function getSparseVideoFeatureBaseline(
  supabase: SupabaseClient,
  userId: string,
  analysedVideoId: string,
): Promise<SparseVideoFeatureBaseline | null> {
  const { data, error } = await supabase
    .from("analysed_videos")
    .select("deep_feature_baseline")
    .eq("id", analysedVideoId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  const baseline = data?.deep_feature_baseline as SparseVideoFeatureBaseline | null
  return baseline?.schemaVersion === SPARSE_BASELINE_SCHEMA_VERSION ? baseline : null
}

export async function generateSparseVideoFeatureBaseline(params: {
  supabase: SupabaseClient
  userId: string
  analysedVideoId: string
  durationSeconds: number
  scan: (fromSeconds: number, toSeconds: number) => Promise<SceneCueScanResult>
}): Promise<SparseVideoFeatureBaseline | null> {
  const existing = await getSparseVideoFeatureBaseline(
    params.supabase,
    params.userId,
    params.analysedVideoId,
  )
  if (existing) return existing

  const { data, error } = await params.supabase
    .from("analysed_videos")
    .select("transcript")
    .eq("id", params.analysedVideoId)
    .eq("user_id", params.userId)
    .single()
  if (error) throw error

  const ranges = buildSparseBaselineRanges(params.durationSeconds)
  const samples = []
  for (const range of ranges) {
    try {
      samples.push({ range, result: await params.scan(range.fromSeconds, range.toSeconds) })
    } catch (error) {
      console.error("Failed to scan sparse video baseline sample", error)
    }
  }
  const baseline = computeSparseVideoFeatureBaseline({
    durationSeconds: params.durationSeconds,
    transcript: (data.transcript ?? []) as TranscriptCue[],
    samples,
  })
  if (!baseline) return null

  const { error: updateError } = await params.supabase
    .from("analysed_videos")
    .update({ deep_feature_baseline: baseline })
    .eq("id", params.analysedVideoId)
    .eq("user_id", params.userId)
  if (updateError) throw updateError
  return baseline
}
