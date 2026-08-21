import { AnalysedVideoDetail } from "@/components/analysed-video-detail"
import {
  DeepAnalysisStatusProvider,
  type DeepAnalysisProgressResponse,
} from "@/components/deep-analysis-progress"
import { OnboardingHintsProvider } from "@/components/onboarding-hints"
import { SourceFileUpload } from "@/components/source-file-upload"
import { UnlockFullReportCta } from "@/components/unlock-full-report-cta"
import {
  getPendingOnboardingHints,
  type OnboardingHint,
} from "@/lib/onboarding-hints"
import { getDeepAnalysisEvidence } from "@/lib/deep-analysis-evidence"
import { getDeepAnalysisRollout } from "@/lib/deep-analysis-config"
import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { planIncludesUploads } from "@/lib/plans"
import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveAnalysedVideo,
} from "@/lib/analysed-videos"
import { refreshAnalysedVideoStats } from "@/lib/analysed-video-stats"
import { getOrGeneratePacingAnalysis } from "@/lib/pacing-analyses"
import type { RetentionAttribution } from "@/lib/retention-attribution"
import type { PackagingAlignment } from "@/lib/packaging-alignment"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"
import { loadSurfaceExtras } from "@/lib/surface-extras"
import type { VideoAnalyticsSummary } from "@/lib/youtube/youtube"
import {
  buildRetentionWindows,
  getRetentionWindows,
  saveRetentionWindows,
  type RetentionWindow,
} from "@/lib/retention-windows"
import { createPendingRetentionWindowAudio } from "@/lib/retention-window-media"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import { saveRetentionWindowTranscripts } from "@/lib/retention-window-transcripts"
import { createPendingRetentionWindowSceneCueScans } from "@/lib/video-scene-cues"
import { createPendingRetentionWindowEventSynthesis } from "@/lib/retention-window-events"
import {
  generatePacingAnalysis,
  type PacingAnalysis,
} from "@/lib/pacing-analysis"
import {
  getSourceFileForVideo,
  type SourceFile,
} from "@/lib/source-files/source-files"
import {
  getDurationToleranceSeconds,
  getFilenameSimilarityThreshold,
} from "@/lib/source-files/config"
import {
  discardSourceFile,
  isStaleSourceFile,
} from "@/lib/source-files/upload-service"
import { getDeepAnalysisProgress } from "@/lib/retention-window-media-progress"
import { getLatestDeepAnalysisPipelineRun } from "@/lib/deep-analysis-pipeline-runs"
import { getStorageProvider } from "@/lib/storage/provider"
import { serialiseSourceFile } from "@/lib/source-files/serialise"
import {
  getGoogleAccessToken,
  ReconsentRequiredError,
} from "@/lib/youtube/google-auth"
import {
  getAudienceRetention,
  getVideoDetails,
  getVideoTranscript,
  type RetentionPoint,
  type TranscriptCue,
  type VideoDetails,
} from "@/lib/youtube/youtube"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// A first visit that backfills retention windows also triggers extraction in
// the background via after() (see triggerRetentionWindowMediaExtraction),
// which still runs within this render's invocation time budget — give it the
// same headroom /api/analyze and the normalisation callback grant themselves,
// so a video with several windows to scan isn't killed mid-extraction and
// left with rows stuck 'pending' forever.
export const maxDuration = 300

type AnalysisResult =
  | {
      status: "ok"
      video: VideoDetails
      retention: RetentionPoint[]
      retentionWindows: RetentionWindow[]
      transcript: TranscriptCue[]
      pacingAnalysis: PacingAnalysis | null
      retentionAttribution: RetentionAttribution | null
      packagingAlignment: PackagingAlignment | null
      scriptTaxonomy: ScriptTaxonomy | null
      analyticsSummary: VideoAnalyticsSummary | null
      // The analysed_videos row's own UUID — distinct from the route's YouTube
      // video id — that retention_windows and everything derived from them are
      // keyed on. Null when the video row itself failed to save, in which case
      // there's nothing for deep-analysis evidence to look up.
      analysedVideoId: string | null
    }
  | { status: "not_found" }
  | { status: "no_data" }
  | { status: "reconnect" }
  | { status: "error" }

async function analyse(
  userId: string,
  videoId: string,
): Promise<AnalysisResult> {
  try {
    const supabase = await createClient()

    // Refresh this video's stored counters and KPI totals before reading the
    // row, so the header prints current numbers instead of the ones it had when
    // it was first opened. Throttled and best-effort; a no-op on a video that
    // hasn't been analysed yet, which the fetch below then handles.
    await refreshAnalysedVideoStats(supabase, userId, { videoIds: [videoId] })

    // Serve a previously-saved analysis when we have one, so we don't re-spend
    // YouTube API quota on a video we've already looked at.
    const cached = await getAnalysedVideo(supabase, userId, videoId)
    if (cached?.videoDetails && cached.retention) {
      const transcript = await healCachedTranscript(
        supabase,
        userId,
        videoId,
        cached.transcript,
      )
      // Retention windows are derived from the stored curve. Backfill any
      // analysis saved before they were persisted so older rows render too.
      let retentionWindows: RetentionWindow[] = await getRetentionWindows(
        supabase,
        userId,
        cached.id,
      )
      const built = buildRetentionWindows(
        cached.retention,
        cached.videoDetails.durationSeconds,
      )
      const needsFullWindowBackfill = retentionWindows.length === 0
      const needsHoldBackfill =
        !needsFullWindowBackfill &&
        !retentionWindows.some((window) => window.kind === "hold") &&
        built.some((window) => window.kind === "hold")
      if (needsFullWindowBackfill || needsHoldBackfill) {
        if (needsFullWindowBackfill) retentionWindows = built
        try {
          const savedWindows = await saveRetentionWindows(
            supabase,
            userId,
            cached.id,
            built,
          )
          // A legacy report that already has hooks, gains and drop-offs only
          // needs jobs for its newly-added holds. Passing every saved window to
          // the upsert helpers would reset settled paid work back to pending.
          const windowsToAnalyse = needsFullWindowBackfill
            ? savedWindows
            : savedWindows.filter((window) => window.kind === "hold")
          await createPendingRetentionWindowAudio(
            supabase,
            userId,
            cached.id,
            windowsToAnalyse,
          )
          await createPendingRetentionWindowSceneCueScans(
            supabase,
            userId,
            cached.id,
            windowsToAnalyse,
          )
          await createPendingRetentionWindowEventSynthesis(
            supabase,
            userId,
            cached.id,
            windowsToAnalyse,
          )
          await saveRetentionWindowTranscripts(
            supabase,
            userId,
            cached.id,
            windowsToAnalyse,
            transcript,
          )
          retentionWindows = savedWindows
          triggerRetentionWindowMediaExtraction(
            await getSourceFileForVideo(supabase, userId, videoId),
          )
        } catch (retentionSaveError) {
          console.error(
            "Failed to backfill retention windows",
            retentionSaveError,
          )
        }
      }
      let pacingAnalysis: PacingAnalysis | null = null
      try {
        pacingAnalysis = await getOrGeneratePacingAnalysis(
          supabase,
          userId,
          cached.id,
          cached.videoDetails,
          transcript,
        )
      } catch (pacingError) {
        console.error("Failed to generate pacing analysis", pacingError)
      }

      const extras = await loadSurfaceExtras(
        supabase,
        userId,
        cached.id,
        cached.videoDetails,
        retentionWindows,
        transcript,
      )

      return {
        status: "ok",
        video: cached.videoDetails,
        retention: cached.retention,
        retentionWindows,
        transcript,
        pacingAnalysis,
        retentionAttribution: extras.retentionAttribution,
        packagingAlignment: extras.packagingAlignment,
        scriptTaxonomy: extras.scriptTaxonomy,
        analyticsSummary: extras.analyticsSummary,
        analysedVideoId: cached.id,
      }
    }

    const accessToken = await getGoogleAccessToken(userId)

    const video = await getVideoDetails(accessToken, videoId)
    if (!video) return { status: "not_found" }

    const retention = await getAudienceRetention(accessToken, video)
    if (retention.length === 0) return { status: "no_data" }

    const retentionWindows = buildRetentionWindows(
      retention,
      video.durationSeconds,
    )
    // Best-effort: a missing or caption-less transcript must not fail the
    // analysis, so swallow errors and fall back to an empty transcript.
    const transcript = await getVideoTranscript(accessToken, videoId).catch(
      (transcriptError) => {
        console.error("Failed to fetch transcript", transcriptError)
        return [] as TranscriptCue[]
      },
    )
    // Persist everything we fetched so future visits hit the cache above, and
    // so pacing analysis below has a video row to claim against.
    let pacingAnalysis: PacingAnalysis | null = null
    let videoPersisted = false
    let analysedVideoId: string | null = null
    try {
      const savedVideo = await saveAnalysedVideo(supabase, {
        userId,
        video,
        retention,
        transcript,
      })
      if (savedVideo) {
        videoPersisted = true
        analysedVideoId = savedVideo.id
        try {
          const savedWindows = await saveRetentionWindows(
            supabase,
            userId,
            savedVideo.id,
            retentionWindows,
          )
          await createPendingRetentionWindowAudio(
            supabase,
            userId,
            savedVideo.id,
            savedWindows,
          )
          await createPendingRetentionWindowSceneCueScans(
            supabase,
            userId,
            savedVideo.id,
            savedWindows,
          )
          await createPendingRetentionWindowEventSynthesis(
            supabase,
            userId,
            savedVideo.id,
            savedWindows,
          )
          await saveRetentionWindowTranscripts(
            supabase,
            userId,
            savedVideo.id,
            savedWindows,
            transcript,
          )
          triggerRetentionWindowMediaExtraction(
            await getSourceFileForVideo(supabase, userId, videoId),
          )
        } catch (retentionSaveError) {
          console.error(
            "Failed to save retention windows",
            retentionSaveError,
          )
        }
        if (transcript.length > 0) {
          try {
            pacingAnalysis = await getOrGeneratePacingAnalysis(
              supabase,
              userId,
              savedVideo.id,
              video,
              transcript,
            )
          } catch (pacingError) {
            console.error("Failed to generate pacing analysis", pacingError)
          }
        }
      }
    } catch (saveError) {
      // Saving is best-effort — never block showing the analysis on a DB write.
      console.error("Failed to save analysed video", saveError)
    }

    // The video row failed to save, so there's nothing to claim/save a pacing
    // analysis against — fall back to generating one just for this response.
    if (!videoPersisted && transcript.length > 0) {
      try {
        pacingAnalysis = await generatePacingAnalysis(video, transcript, {
          userId,
        })
      } catch (pacingError) {
        console.error("Failed to generate pacing analysis", pacingError)
      }
    }

    // The surface extras need a persisted row to claim/cache against. When the
    // save failed there's nothing to attach them to, so skip them for this
    // render — they'll be generated on the next visit once the row exists.
    const extras = analysedVideoId
      ? await loadSurfaceExtras(
          supabase,
          userId,
          analysedVideoId,
          video,
          retentionWindows,
          transcript,
        )
      : {
          retentionAttribution: null,
          packagingAlignment: null,
          scriptTaxonomy: null,
          analyticsSummary: null,
        }

    return {
      status: "ok",
      video,
      retention,
      retentionWindows,
      transcript,
      pacingAnalysis,
      retentionAttribution: extras.retentionAttribution,
      packagingAlignment: extras.packagingAlignment,
      scriptTaxonomy: extras.scriptTaxonomy,
      analyticsSummary: extras.analyticsSummary,
      analysedVideoId,
    }
  } catch (error) {
    if (error instanceof ReconsentRequiredError) {
      return { status: "reconnect" }
    }
    console.error("Failed to analyse video", error)
    return { status: "error" }
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ videoId: string }>
}) {
  const { videoId } = await params
  const user = await requireAuthenticatedUser()
  const deepAnalysisRollout = getDeepAnalysisRollout(user.id)
  const result = await analyse(user.id, videoId)

  const title = result.status === "ok" ? result.video.title : "Analysis"

  // Load any existing raw source file for this video so the upload section can
  // render its current state on first paint. Best-effort: a failure here must
  // not break the analysis view.
  let initialSourceFile = null
  let readySourceFile: SourceFile | null = null
  if (result.status === "ok") {
    try {
      const supabase = await createClient()
      let sourceFile = await getSourceFileForVideo(supabase, user.id, videoId)
      // If a previous upload was abandoned mid-flight (the user navigated away
      // while it was uploading), the record is stranded in the "uploading" state
      // and would otherwise render a spinner stuck on "Validating your file…".
      // Wipe it so the section starts fresh and the user can upload again.
      if (sourceFile && isStaleSourceFile(sourceFile)) {
        try {
          await discardSourceFile(
            supabase,
            getStorageProvider(),
            user.id,
            sourceFile,
          )
        } catch (error) {
          console.error("Failed to discard stale source file", error)
        }
        sourceFile = null
      }
      initialSourceFile = sourceFile ? serialiseSourceFile(sourceFile) : null
      if (sourceFile && sourceFile.uploadStatus === "ready") {
        readySourceFile = sourceFile
      }
    } catch (error) {
      console.error("Failed to load source file", error)
    }
  }

  // Whether this user's plan includes source-file uploads. Paid plans get the
  // upload card at the foot of the report; Free plans cannot upload at all, so
  // that slot carries the upgrade prompt instead. A failed entitlement lookup
  // falls back to "cannot upload", the same fail-closed default the billing
  // code uses, so we never offer an upload the API would then refuse.
  let canUploadSourceFile = false
  if (result.status === "ok") {
    try {
      const entitlement = await getEntitlement(user.id)
      canUploadSourceFile = planIncludesUploads(entitlement.plan)
    } catch (error) {
      console.error("Failed to resolve plan for the source file card", error)
    }
  }

  // The upgrade prompt is only worth showing while there is something left to
  // unlock: no source file has been accepted for this video yet, so the
  // footage-based half of the analysis hasn't been run. A file that is still
  // pending or that failed validation counts as nothing uploaded, matching what
  // the upload card itself offers in those states.
  const reportUnlocked =
    initialSourceFile != null &&
    initialSourceFile.uploadStatus !== "pending" &&
    initialSourceFile.uploadStatus !== "failed" &&
    initialSourceFile.validationStatus !== "failed"
  // Only Free sees a prompt. A paid user already has the upload card below the
  // report, so a second nudge toward it just repeats itself.
  const showUnlockCta =
    result.status === "ok" && !reportUnlocked && !canUploadSourceFile

  // The one-time coach marks this creator has still to meet, read here so the
  // first paint already knows which — if any — to draw. Best-effort: a report
  // is worth more than a hint, so a failed read simply shows none.
  let pendingHints: OnboardingHint[] = []
  if (result.status === "ok") {
    try {
      const supabase = await createClient()
      pendingHints = await getPendingOnboardingHints(supabase, user.id)
    } catch (error) {
      console.error("Failed to load onboarding hints", error)
    }
  }

  // Only surface the deep-analysis evidence section once the pipeline has
  // fully settled for this video — every window's snapshots/audio have been
  // harvested and analysed, and events have been synthesized from all of it.
  // Showing it any earlier just flashes an empty-looking "0 events" card
  // before there's anything to actually show.
  let deepAnalysisEvidence: Awaited<
    ReturnType<typeof getDeepAnalysisEvidence>
  > | null = null
  // The same read handed to the client provider below, so the source-file
  // card's "Processing…" badge is correct in the first paint rather than
  // appearing a poll later. Mirrors what /api/videos/:id/analysis-progress
  // returns, including the idle answer for a video with no ready file yet.
  let initialDeepAnalysisProgress: DeepAnalysisProgressResponse | null = null
  if (result.status === "ok" && result.analysedVideoId && readySourceFile) {
    try {
      const supabase = await createClient()
      const [progress, pipelineRun] = await Promise.all([
        getDeepAnalysisProgress(
          supabase,
          user.id,
          result.analysedVideoId,
          readySourceFile,
        ),
        // The card's failure signal. Best-effort, exactly as the poll endpoint
        // treats it: a run we can't read shouldn't cost us the stage snapshot.
        getLatestDeepAnalysisPipelineRun(
          supabase,
          user.id,
          result.analysedVideoId,
        ).catch(() => null),
      ])
      initialDeepAnalysisProgress = { ...progress, pipelineRun }
      if (progress.complete) {
        // Only charge transcoding when the source was actually transcoded by
        // Qencode; when normalisation was skipped/disabled the original is used
        // as-is, so there's no transcoding cost to attribute.
        const transcodedDurationSeconds =
          readySourceFile.normalisationStatus === "ready"
            ? result.video.durationSeconds
            : null
        deepAnalysisEvidence = await getDeepAnalysisEvidence(
          supabase,
          user.id,
          result.analysedVideoId,
          transcodedDurationSeconds,
        )
      }
    } catch (error) {
      console.error("Failed to load deep analysis evidence", error)
    }
  } else if (result.status === "ok") {
    // No fully-uploaded source file, so there is nothing to analyse yet — the
    // idle reading the progress endpoint gives for exactly this case.
    initialDeepAnalysisProgress = { active: false, complete: true, stages: null }
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/analysed-videos">
                  Analysed Videos
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage className="max-w-[40ch] truncate">
                  {title}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {result.status === "ok" && (
          // One poll of the deep-analysis pipeline for the whole report: the
          // header reads it for its "Processing…" badge while a run is in
          // flight, and the source-file card below reads it to prompt a retry
          // when the last run failed.
          <DeepAnalysisStatusProvider
            videoId={videoId}
            initialProgress={initialDeepAnalysisProgress}
          >
            {/* Wraps the report and the upload card together: the card is what
                announces a file landing without a reload, and the coach marks
                the report then draws are the answer to it. */}
            <OnboardingHintsProvider pendingHints={pendingHints}>
              <AnalysedVideoDetail
                video={result.video}
                retention={result.retention}
                retentionWindows={result.retentionWindows}
                transcript={result.transcript}
                pacingAnalysis={result.pacingAnalysis}
                retentionAttribution={result.retentionAttribution}
                packagingAlignment={result.packagingAlignment}
                scriptTaxonomy={result.scriptTaxonomy}
                analyticsSummary={result.analyticsSummary}
                deepAnalysisEvidence={
                  deepAnalysisRollout.insights ? deepAnalysisEvidence : null
                }
                showDeepRecommendations={deepAnalysisRollout.recommendations}
                hasSourceFile={readySourceFile != null}
              />
              {/* The foot of the report is the one slot that leads to the
                  footage-based half of it. On a paid plan that is the upload
                  card; on Free, where uploading isn't available, the upgrade
                  prompt takes its place. */}
              {showUnlockCta ? (
                <UnlockFullReportCta />
              ) : (
                <SourceFileUpload
                  videoId={videoId}
                  videoTitle={result.video.title}
                  youtubeDurationSeconds={result.video.durationSeconds}
                  durationToleranceSeconds={getDurationToleranceSeconds()}
                  filenameSimilarityThreshold={getFilenameSimilarityThreshold()}
                  initialSourceFile={initialSourceFile}
                />
              )}
            </OnboardingHintsProvider>
          </DeepAnalysisStatusProvider>
        )}

        {result.status === "not_found" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            We couldn&apos;t find that video on YouTube.
          </div>
        )}

        {result.status === "no_data" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            No retention data available. Make sure this video is on the YouTube
            channel you signed in with and has enough views.
          </div>
        )}

        {result.status === "reconnect" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            Please reconnect your YouTube account to grant analytics access.
          </div>
        )}

        {result.status === "error" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            We couldn&apos;t analyse that video right now. Please try again
            later.
          </div>
        )}
      </div>
    </>
  )
}
