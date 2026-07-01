import { AnalysedVideoDetail } from "@/components/analysed-video-detail"
import { SourceFileUpload } from "@/components/source-file-upload"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import {
  getAnalysedVideo,
  healCachedTranscript,
  saveAnalysedVideo,
} from "@/lib/analysed-videos"
import {
  getPacingAnalysis,
  savePacingAnalysis,
} from "@/lib/pacing-analyses"
import {
  buildRetentionWindows,
  getRetentionWindows,
  saveRetentionWindows,
  type RetentionWindow,
} from "@/lib/retention-windows"
import { createPendingRetentionWindowMedia } from "@/lib/retention-window-media"
import { triggerRetentionWindowMediaExtraction } from "@/lib/retention-window-media-trigger"
import {
  generatePacingAnalysis,
  type PacingAnalysis,
} from "@/lib/pacing-analysis"
import { getSourceFileForVideo } from "@/lib/source-files/source-files"
import {
  getDurationToleranceSeconds,
  getFilenameSimilarityThreshold,
} from "@/lib/source-files/config"
import {
  discardSourceFile,
  isStaleSourceFile,
} from "@/lib/source-files/upload-service"
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

type AnalysisResult =
  | {
      status: "ok"
      video: VideoDetails
      retention: RetentionPoint[]
      retentionWindows: RetentionWindow[]
      transcript: TranscriptCue[]
      pacingAnalysis: PacingAnalysis | null
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
      if (retentionWindows.length === 0) {
        const built = buildRetentionWindows(
          cached.retention,
          cached.videoDetails.durationSeconds,
        )
        retentionWindows = built
        try {
          const savedWindows = await saveRetentionWindows(
            supabase,
            userId,
            cached.id,
            built,
          )
          await createPendingRetentionWindowMedia(
            supabase,
            userId,
            cached.id,
            savedWindows,
          )
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
      let pacingAnalysis = await getPacingAnalysis(
        supabase,
        userId,
        cached.id,
      )
      if (!pacingAnalysis && transcript.length > 0) {
        try {
          pacingAnalysis = await generatePacingAnalysis(
            cached.videoDetails,
            transcript,
          )
          if (pacingAnalysis) {
            await savePacingAnalysis(
              supabase,
              userId,
              cached.id,
              pacingAnalysis,
            )
          }
        } catch (pacingError) {
          console.error("Failed to generate pacing analysis", pacingError)
        }
      }

      return {
        status: "ok",
        video: cached.videoDetails,
        retention: cached.retention,
        retentionWindows,
        transcript,
        pacingAnalysis,
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
    let pacingAnalysis: PacingAnalysis | null = null
    if (transcript.length > 0) {
      try {
        pacingAnalysis = await generatePacingAnalysis(video, transcript)
      } catch (pacingError) {
        console.error("Failed to generate pacing analysis", pacingError)
      }
    }

    // Persist everything we fetched so future visits hit the cache above.
    try {
      const savedVideo = await saveAnalysedVideo(supabase, {
        userId,
        video,
        retention,
        transcript,
      })
      if (savedVideo) {
        try {
          const savedWindows = await saveRetentionWindows(
            supabase,
            userId,
            savedVideo.id,
            retentionWindows,
          )
          await createPendingRetentionWindowMedia(
            supabase,
            userId,
            savedVideo.id,
            savedWindows,
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
        if (pacingAnalysis) {
          try {
            await savePacingAnalysis(
              supabase,
              userId,
              savedVideo.id,
              pacingAnalysis,
            )
          } catch (pacingSaveError) {
            console.error("Failed to save pacing analysis", pacingSaveError)
          }
        }
      }
    } catch (saveError) {
      // Saving is best-effort — never block showing the analysis on a DB write.
      console.error("Failed to save analysed video", saveError)
    }

    return {
      status: "ok",
      video,
      retention,
      retentionWindows,
      transcript,
      pacingAnalysis,
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
  const result = await analyse(user.id, videoId)

  const title = result.status === "ok" ? result.video.title : "Analysis"

  // Load any existing raw source file for this video so the upload section can
  // render its current state on first paint. Best-effort: a failure here must
  // not break the analysis view.
  let initialSourceFile = null
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
    } catch (error) {
      console.error("Failed to load source file", error)
    }
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
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard/analysed-videos">
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
          <>
            <AnalysedVideoDetail
              video={result.video}
              retention={result.retention}
              retentionWindows={result.retentionWindows}
              transcript={result.transcript}
              pacingAnalysis={result.pacingAnalysis}
            />
            <SourceFileUpload
              videoId={videoId}
              videoTitle={result.video.title}
              youtubeDurationSeconds={result.video.durationSeconds}
              durationToleranceSeconds={getDurationToleranceSeconds()}
              filenameSimilarityThreshold={getFilenameSimilarityThreshold()}
              initialSourceFile={initialSourceFile}
            />
          </>
        )}

        {result.status === "not_found" && (
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            We couldn&apos;t find that video on YouTube.
          </div>
        )}

        {result.status === "no_data" && (
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            No retention data available. Make sure this video is on the YouTube
            channel you signed in with and has enough views.
          </div>
        )}

        {result.status === "reconnect" && (
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            Please reconnect your YouTube account to grant analytics access.
          </div>
        )}

        {result.status === "error" && (
          <div className="rounded-xl border bg-muted/30 p-8 text-sm text-muted-foreground">
            We couldn&apos;t analyse that video right now. Please try again
            later.
          </div>
        )}
      </div>
    </>
  )
}
