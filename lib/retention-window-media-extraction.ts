// Runs the actual thumbnail/audio/scene-cue harvest for a video's pending
// retention_window_snapshots/retention_window_audio/
// retention_window_scene_cue_scans rows, once the source video is available.
// Each harvested snapshot also gets deterministic (no LLM) OCR run on it
// inline, right after extraction, using the JPEG bytes already in hand — see
// lib/media/ocr.ts.
// Triggered best-effort from whichever async process finishes last (see
// lib/retention-window-media-trigger.ts): the retention analysis, which
// computes the rows, the upload completing, which makes the original master
// readable, or the source-file normalisation callback, which swaps in the
// cheaper-to-decode proxies.
//
// Every row is processed independently and its own status updated as soon as
// it succeeds or fails, so a partial run (a timeout, a single bad seek) never
// strands the whole batch — rows left 'pending' just wait for the next trigger.
//
// Three cost structures shape this module:
//   • The source is decoded from the cheapest readable copy (the 360p
//     analysis proxy when normalisation has produced one — see
//     resolveAnalysisSourceStoragePath), and copied onto local disk once per
//     run when it fits (lib/media/local-source-cache.ts), so the dozens of
//     ffmpeg invocations a run makes read local bytes instead of each
//     re-seeking over HTTPS.
//   • Scene-cue scans decode every frame of their range, and windows' padded
//     ranges overlap heavily on a short video — so pending scans are merged
//     into coalesced spans (mergeScanSpans), each span is decoded exactly
//     once, and the master cue list is sliced back out per window
//     (sliceSceneCues). One master timeline, per-window views of it.
//   • Overlapping windows also derive snapshots at the same timestamps (their
//     flanking pairs straddle the same cuts), so the JPEG grab + OCR for a
//     given timestamp is computed once per run and shared across every row
//     that wants it — only the per-row storage object and status write repeat.
//
// The scene-cue scan is folded into this same pass (not a separate trigger)
// because it needs exactly the same source, over the same ranges, as the
// audio extraction below it — see lib/media/scene-detection.ts for why it's
// scoped to a span rather than a whole-video decode.
//
// Scene-cue scans run *before* snapshots, not after: a window's snapshot
// timestamps are derived from its detected cuts (see
// buildSnapshotTimestampsFromSceneCues in lib/retention-window-media.ts) —
// flanking frames just before/after each real transition, instead of a blind
// fixed-interval grid — so those rows can't be created until the scan for
// that window has actually run. A window with no cuts still gets a snapshot:
// a single frame at its start when the scan confirmed it's static, or the
// dense fixed grid when the scan *failed* (content unknown) — so a window is
// never left with no visual evidence just because ffmpeg errored once; see
// getPendingRetentionWindowSceneCueScans in lib/video-scene-cues.ts for how a
// failed scan itself gets retried.

import type { SupabaseClient } from "@supabase/supabase-js"

import { runWithConcurrency } from "@/lib/concurrency"
import {
  acquireLocalSource,
  type LocalSourceHandle,
} from "@/lib/media/local-source-cache"
import {
  defaultVideoExtractor,
  type VideoExtractor,
} from "@/lib/media/video-extraction"
import {
  scanVideoSceneCues,
  type SceneCueScanResult,
} from "@/lib/media/scene-detection"
import { createOcrEngine, type OcrEngine } from "@/lib/media/ocr"
import {
  createRetentionWindowSnapshotsFromSceneCues,
  getPendingRetentionWindowAudio,
  getPendingRetentionWindowSnapshots,
  updateRetentionWindowAudioStatus,
  updateRetentionWindowSnapshotStatus,
} from "@/lib/retention-window-media"
import {
  buildRetentionAudioObjectPath,
  buildRetentionSnapshotObjectPath,
  getLocalSourceCacheMaxBytes,
  getRetentionWindowExtractionConcurrency,
  getRetentionWindowMediaStorageProvider,
  getSourceVideoReadUrlExpirySeconds,
} from "@/lib/retention-window-media-config"
import {
  resolveAnalysisSourceStoragePath,
  resolvePlaybackStoragePath,
  type SourceFile,
} from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"
import {
  getPendingRetentionWindowSceneCueScans,
  replaceRetentionWindowSceneCues,
  updateRetentionWindowSceneCueScanStatus,
  type RetentionWindowSceneCueScan,
} from "@/lib/video-scene-cues"

export interface SceneCueScanner {
  scan(
    sourceUrl: string,
    fromSeconds: number,
    toSeconds: number,
  ): Promise<SceneCueScanResult>
}

export interface RetentionWindowMediaExtractionDeps {
  extractor: VideoExtractor
  mediaStorage: StorageProvider
  sceneCueScanner: SceneCueScanner
  // A factory, not a shared instance: a fresh OCR engine (and the WASM
  // core/language-data load that comes with creating one) is created once
  // per extraction run, only if snapshots are actually pending, and
  // terminated at the end of that run.
  createOcrEngine: () => Promise<OcrEngine>
  // Copies the source onto local disk for the run when it fits the budget;
  // null means "stream from the signed URL", the pre-cache behaviour.
  acquireLocalSource: (
    url: string,
    sizeHintBytes: number | null,
  ) => Promise<LocalSourceHandle | null>
}

export function defaultRetentionWindowMediaExtractionDeps(): RetentionWindowMediaExtractionDeps {
  return {
    extractor: defaultVideoExtractor,
    mediaStorage: getRetentionWindowMediaStorageProvider(),
    sceneCueScanner: { scan: scanVideoSceneCues },
    createOcrEngine,
    acquireLocalSource: (url, sizeHintBytes) =>
      acquireLocalSource(url, {
        sizeHintBytes,
        maxBytes: getLocalSourceCacheMaxBytes(),
      }),
  }
}

// True when a source file is actually readable right now — the normalised
// proxy or the original master, whichever resolvePlaybackStoragePath resolves
// to. Extraction can run against either.
export function isSourceFileReady(sourceFile: SourceFile | null): boolean {
  return (
    sourceFile != null &&
    sourceFile.uploadStatus === "ready" &&
    resolvePlaybackStoragePath(sourceFile) != null
  )
}

// True when this run should wait for the in-flight 360p analysis proxy
// instead of decoding the source that's readable right now.
//
// Starting extraction against the original master in parallel with the
// transcode is a win only while the master is cheap enough to decode within
// the run's timeout budgets. The dividing line used is whether the master
// fits the local-source-cache budget: a source too large to pull onto local
// disk means every scene-cue scan streams the full-bitrate original over
// HTTPS — observed in production to sit at frame 0 for the entire 240s scan
// timeout for a ~52Mbps 4K master, burning the whole serverless invocation
// and failing every row, when the same rows extract in seconds from the 360p
// proxy that arrives minutes later. Deferred rows just stay 'pending'; the
// normalisation callback (or the next dashboard visit / retry) re-triggers
// extraction once the proxy is ready — or against the master once
// normalisation has conclusively failed and no proxy is coming.
export function shouldDeferExtractionUntilAnalysisProxy(
  sourceFile: Pick<SourceFile, "normalisationStatus">,
  analysisSourceSizeBytes: number | null,
  localCacheMaxBytes: number,
): boolean {
  const proxyInFlight =
    sourceFile.normalisationStatus === "pending" ||
    sourceFile.normalisationStatus === "processing"
  if (!proxyInFlight) return false
  // Unknown size defers too: it can't be proven cheap, and a proxy is
  // coming regardless.
  return (
    analysisSourceSizeBytes == null ||
    analysisSourceSizeBytes > localCacheMaxBytes
  )
}

// A coalesced range covering one or more pending scans, so the footage under
// overlapping windows is decoded once instead of once per window.
export interface MergedScanSpan {
  fromSeconds: number
  toSeconds: number
  scans: RetentionWindowSceneCueScan[]
}

// Two scans whose ranges are separated by no more than this are decoded as
// one span: decoding a few extra in-between seconds costs less than another
// ffmpeg spawn and seek to skip them.
export const SCAN_MERGE_GAP_SECONDS = 10

// Ceiling on how long a single merged span may grow. Merging saves redundant
// decoding, but it also concentrates cost into one ffmpeg pass and makes a
// timeout fail *every* window in the span at once (all-or-nothing). Past this
// length the scan's own timeout budget stops scaling anyway — the per-second
// budget in computeSceneCueScanTimeoutMs (60s floor + 3s/s, capped at 240s)
// hits its cap right around 60s of footage, so a span longer than that is one
// the timeout can no longer model and is just betting the decode fits. Capping
// merges here keeps every span inside that modelled budget and bounds the
// blast radius: an unbounded merge is exactly what produced a single ~83s span
// that timed out and failed four windows together. A lone scan longer than the
// cap still forms its own span — the cap only blocks *merging*, never splits a
// scan.
export const SCAN_MERGE_MAX_SPAN_SECONDS = 60

export function mergeScanSpans(
  scans: RetentionWindowSceneCueScan[],
  gapSeconds: number = SCAN_MERGE_GAP_SECONDS,
  maxSpanSeconds: number = SCAN_MERGE_MAX_SPAN_SECONDS,
): MergedScanSpan[] {
  const sorted = [...scans].sort((a, b) => a.fromSeconds - b.fromSeconds)
  const spans: MergedScanSpan[] = []

  for (const scan of sorted) {
    const current = spans[spans.length - 1]
    const mergedToSeconds = current
      ? Math.max(current.toSeconds, scan.toSeconds)
      : 0
    if (
      current &&
      scan.fromSeconds <= current.toSeconds + gapSeconds &&
      mergedToSeconds - current.fromSeconds <= maxSpanSeconds
    ) {
      current.toSeconds = mergedToSeconds
      current.scans.push(scan)
    } else {
      spans.push({
        fromSeconds: scan.fromSeconds,
        toSeconds: scan.toSeconds,
        scans: [scan],
      })
    }
  }

  return spans
}

// A window's view of a merged span's master cue list: cuts at timestamps
// inside the window, freeze/black spans clipped to it. Timestamps are already
// absolute (the scan runs with -copyts), so no rebasing is needed.
export function sliceSceneCues(
  cues: SceneCueScanResult,
  fromSeconds: number,
  toSeconds: number,
): SceneCueScanResult {
  const clipSpans = (spans: SceneCueScanResult["freezes"]) =>
    spans
      .map((span) => ({
        fromSeconds: Math.max(span.fromSeconds, fromSeconds),
        toSeconds: Math.min(span.toSeconds, toSeconds),
      }))
      .filter((span) => span.toSeconds > span.fromSeconds)

  return {
    cuts: cues.cuts.filter(
      (cut) => cut.atSeconds >= fromSeconds && cut.atSeconds <= toSeconds,
    ),
    freezes: clipSpans(cues.freezes),
    blacks: clipSpans(cues.blacks),
  }
}

// Extracts every pending snapshot, audio, and scene-cue-scan row for one
// video. Best-effort per row — an ffmpeg failure is recorded on that row and
// the run continues. Never mints a signed read URL (or otherwise does any
// work) when nothing is pending.
export async function extractPendingRetentionWindowMedia(
  admin: SupabaseClient,
  sourceStorage: StorageProvider,
  sourceFile: SourceFile,
  deps: RetentionWindowMediaExtractionDeps = defaultRetentionWindowMediaExtractionDeps(),
): Promise<void> {
  const analysisSource = resolveAnalysisSourceStoragePath(sourceFile)
  if (!analysisSource) return

  if (
    shouldDeferExtractionUntilAnalysisProxy(
      sourceFile,
      analysisSource.sizeBytes,
      getLocalSourceCacheMaxBytes(),
    )
  ) {
    return
  }

  const [initialPendingSnapshots, pendingAudio, pendingSceneCueScans] =
    await Promise.all([
      getPendingRetentionWindowSnapshots(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
      ),
      getPendingRetentionWindowAudio(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
      ),
      getPendingRetentionWindowSceneCueScans(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
      ),
    ])

  if (
    initialPendingSnapshots.length === 0 &&
    pendingAudio.length === 0 &&
    pendingSceneCueScans.length === 0
  ) {
    return
  }

  const sourceUrl = await sourceStorage.createSignedReadUrl(
    analysisSource.storagePath,
    getSourceVideoReadUrlExpirySeconds(),
  )

  // One download for the whole run when the source fits on local disk; every
  // ffmpeg call below then reads the local file instead of re-seeking over
  // HTTPS. Falls back to the signed URL (the pre-cache behaviour) when it
  // doesn't fit or the download fails.
  const localSource = await deps.acquireLocalSource(
    sourceUrl,
    analysisSource.sizeBytes,
  )
  const source = localSource?.path ?? sourceUrl

  try {
    const concurrency = getRetentionWindowExtractionConcurrency()

    await runWithConcurrency(
      mergeScanSpans(pendingSceneCueScans),
      concurrency,
      (span) => scanMergedSpan(admin, sourceFile, source, span, deps),
    )

    // Re-read pending snapshots after the scan loop above: it may have just
    // created fresh rows (derived from cues) for whichever windows it scanned,
    // which the earlier read couldn't have seen yet.
    const pendingSnapshots =
      pendingSceneCueScans.length > 0
        ? await getPendingRetentionWindowSnapshots(
            admin,
            sourceFile.userId,
            sourceFile.analysedVideoId,
          )
        : initialPendingSnapshots

    // One OCR engine (the WASM core + trained language data load) for every
    // snapshot in this run, not one per snapshot — recreating it per frame
    // would pay that load cost repeatedly for no benefit. Engine setup itself
    // is best-effort: it's a deterministic add-on to a snapshot row, not a
    // prerequisite for it, so a broken/missing OCR runtime (a bad deploy, a
    // worker-thread spawn failure) should fall back to skipping OCR rather
    // than aborting extraction outright and leaving every pending snapshot,
    // and everything after it, stuck 'pending' with nothing left to retry it.
    let ocrEngine: OcrEngine | null = null
    if (pendingSnapshots.length > 0) {
      try {
        ocrEngine = await deps.createOcrEngine()
      } catch (error) {
        console.error("Failed to start OCR engine", error)
      }
    }

    // Overlapping windows derive snapshot rows at the same timestamps (their
    // flanking pairs straddle the same detected cuts), so the expensive part
    // — the ffmpeg frame grab and its OCR — is computed once per distinct
    // timestamp and shared across every row that wants it. A shared failure
    // fails each sharing row this run; they retry as pending next trigger.
    const frameCache = new Map<
      number,
      Promise<{ jpeg: Buffer; ocrText: string | null }>
    >()
    const harvestFrame = (timestampSeconds: number) => {
      let frame = frameCache.get(timestampSeconds)
      if (!frame) {
        frame = (async () => {
          const jpeg = await deps.extractor.extractThumbnail(
            source,
            timestampSeconds,
          )
          // Deterministic OCR is best-effort: a recognition failure shouldn't
          // fail the whole frame, since the JPEG itself extracted fine — just
          // leave ocrText null, the same tolerance ffmpeg's own volumedetect/
          // silencedetect measurements already get on the audio side.
          const ocrText = ocrEngine
            ? await ocrEngine
                .recognize(jpeg)
                .then((result) => result.text)
                .catch((error) => {
                  console.error(
                    "Failed to OCR retention window snapshot",
                    error,
                  )
                  return null
                })
            : null
          return { jpeg, ocrText }
        })()
        frameCache.set(timestampSeconds, frame)
      }
      return frame
    }

    try {
      await runWithConcurrency(pendingSnapshots, concurrency, async (snapshot) => {
        try {
          const { jpeg, ocrText } = await harvestFrame(snapshot.timestampSeconds)
          const path = buildRetentionSnapshotObjectPath({
            userId: sourceFile.userId,
            analysedVideoId: sourceFile.analysedVideoId,
            retentionWindowId: snapshot.retentionWindowId,
            chunkIndex: snapshot.chunkIndex,
          })
          await deps.mediaStorage.putObject(path, jpeg, {
            contentType: "image/jpeg",
          })
          await updateRetentionWindowSnapshotStatus(
            admin,
            sourceFile.userId,
            snapshot.id,
            { status: "ready", storagePath: path, ocrText },
          )
        } catch (error) {
          console.error("Failed to extract retention window snapshot", error)
          await updateRetentionWindowSnapshotStatus(
            admin,
            sourceFile.userId,
            snapshot.id,
            {
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to extract thumbnail",
            },
          ).catch(() => {})
        }
      })
    } finally {
      await ocrEngine?.terminate().catch(() => {})
    }

    await runWithConcurrency(pendingAudio, concurrency, async (audio) => {
      try {
        const clip = await deps.extractor.extractAudioSegment(
          source,
          audio.fromSeconds,
          audio.toSeconds,
        )
        const path = buildRetentionAudioObjectPath({
          userId: sourceFile.userId,
          analysedVideoId: sourceFile.analysedVideoId,
          retentionWindowId: audio.retentionWindowId,
        })
        await deps.mediaStorage.putObject(path, clip, {
          contentType: "audio/mpeg",
        })
        await updateRetentionWindowAudioStatus(
          admin,
          sourceFile.userId,
          audio.id,
          {
            status: "ready",
            storagePath: path,
          },
        )
      } catch (error) {
        console.error("Failed to extract retention window audio", error)
        await updateRetentionWindowAudioStatus(
          admin,
          sourceFile.userId,
          audio.id,
          {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Failed to extract audio",
          },
        ).catch(() => {})
      }
    })
  } finally {
    await localSource?.cleanup()
  }
}

// Decodes one merged span exactly once, then fans the master cue list back
// out to each window scan it covers: per-window cue rows, cue-derived
// snapshot rows, and the scan's own status.
async function scanMergedSpan(
  admin: SupabaseClient,
  sourceFile: SourceFile,
  source: string,
  span: MergedScanSpan,
  deps: RetentionWindowMediaExtractionDeps,
): Promise<void> {
  // Snapshots still get derived and created below even when the scan itself
  // fails — from empty cues, which is exactly the fallback a window with
  // genuinely zero detected cuts already gets (see
  // buildSnapshotTimestampsFromSceneCues). Without this, a single transient
  // ffmpeg failure (a network hiccup, a bad seek) would leave every window in
  // the span with no visual evidence at all until the next full re-analyze.
  let spanCues: SceneCueScanResult | null = null
  let spanError: string | null = null
  try {
    spanCues = await deps.sceneCueScanner.scan(
      source,
      span.fromSeconds,
      span.toSeconds,
    )
  } catch (error) {
    console.error("Failed to scan retention window scene cues", error)
    spanError =
      error instanceof Error ? error.message : "Failed to scan scene cues"
  }

  for (const scan of span.scans) {
    let cues: SceneCueScanResult = { cuts: [], freezes: [], blacks: [] }
    let scanError = spanError

    if (spanCues) {
      cues = sliceSceneCues(spanCues, scan.fromSeconds, scan.toSeconds)
      try {
        await replaceRetentionWindowSceneCues(
          admin,
          sourceFile.userId,
          sourceFile.analysedVideoId,
          scan.retentionWindowId,
          cues,
        )
      } catch (error) {
        console.error("Failed to save retention window scene cues", error)
        scanError =
          error instanceof Error ? error.message : "Failed to save scene cues"
      }
    }

    try {
      await createRetentionWindowSnapshotsFromSceneCues(
        admin,
        sourceFile.userId,
        sourceFile.analysedVideoId,
        scan.retentionWindowId,
        scan.fromSeconds,
        scan.toSeconds,
        cues,
        // A confirmed-static window (the scan ran and returned zero cuts)
        // samples a single frame at its start; a window whose scan failed
        // (spanCues null) keeps the dense fallback grid since its content is
        // genuinely unknown. See buildSnapshotTimestampsFromSceneCues.
        spanCues == null,
      )
      // The scan's own status still faithfully reports failure when the
      // ffmpeg call itself errored — snapshots existing doesn't mean cut
      // detection actually ran for this window, and a failed scan is what
      // makes it eligible for retry (see getPendingRetentionWindowSceneCueScans).
      await updateRetentionWindowSceneCueScanStatus(
        admin,
        sourceFile.userId,
        scan.id,
        scanError ? { status: "failed", error: scanError } : { status: "ready" },
      )
    } catch (error) {
      console.error(
        "Failed to save retention window snapshots derived from scene cues",
        error,
      )
      await updateRetentionWindowSceneCueScanStatus(
        admin,
        sourceFile.userId,
        scan.id,
        {
          status: "failed",
          error:
            scanError ??
            (error instanceof Error
              ? error.message
              : "Failed to save snapshots"),
        },
      ).catch(() => {})
    }
  }
}
