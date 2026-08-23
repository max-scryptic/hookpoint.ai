"use client"

import { useState } from "react"
import Link from "next/link"
import { CircleCheckIcon } from "lucide-react"

import { useAnalysisLauncher } from "@/components/analysis-launcher"
import { HintCallout, useOnboardingHint } from "@/components/onboarding-hints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseVideoId } from "@/lib/youtube/youtube"

interface AlreadyAnalysed {
  videoId: string
  title?: string
}

export function AnalyseVideoForm({
  showFirstAnalysisHint = false,
}: {
  // Whether this creator has yet to analyse anything, and so is owed the coach
  // mark that says a pasted link is one of the two ways to start. The other one
  // lives on the uploads list below; both answer to the same hint, so using
  // either way puts both away. See ONBOARDING_HINTS in lib/onboarding-hints.ts.
  showFirstAnalysisHint?: boolean
}) {
  // The launcher owns the "analysing your video" popup and the redirect to the
  // report once /api/analyze resolves (see AnalysisLauncherProvider). The form
  // just validates the URL, then hands the video off to it.
  const launcher = useAnalysisLauncher()
  const firstAnalysisHint = useOnboardingHint("first_video_analysis")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [alreadyAnalysed, setAlreadyAnalysed] =
    useState<AlreadyAnalysed | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // The button only lights up once the input looks like a YouTube video URL or
  // ID. Ownership of the video is confirmed server-side on submit.
  const videoId = parseVideoId(url)
  const canSubmit = videoId !== null && !isValidating

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setError(null)
    setAlreadyAnalysed(null)
    setIsValidating(true)
    // Submitting a link is the lesson the coach mark was teaching, so it goes
    // now rather than on the way back: whether the video validates or not, the
    // creator has found this box.
    firstAnalysisHint.dismiss()

    try {
      const response = await fetch("/api/validate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        videoId?: string
        title?: string
        alreadyAnalysed?: boolean
        error?: string
        message?: string
      }

      if (!response.ok || !data.ok || !data.videoId) {
        setError(
          data.error === "reconnect_required"
            ? (data.message ?? "Please reconnect your YouTube account.")
            : (data.error ?? "We couldn't validate that video."),
        )
        setIsValidating(false)
        return
      }

      // Already analysed: don't re-spend quota — surface the saved results.
      if (data.alreadyAnalysed) {
        setAlreadyAnalysed({ videoId: data.videoId, title: data.title })
        setIsValidating(false)
        return
      }

      // Brand-new analysis: hand off to the launcher, which shows the popup,
      // runs /api/analyze, and redirects to the report once it resolves — so the
      // user never lands on an empty "analysing" page.
      setIsValidating(false)
      launcher?.startAnalysis(data.videoId)
    } catch {
      setError("Something went wrong. Please try again.")
      setIsValidating(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="relative flex items-start gap-2">
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            if (error) setError(null)
            if (alreadyAnalysed) setAlreadyAnalysed(null)
          }}
          placeholder="Paste a YouTube video URL from your channel"
          aria-invalid={error ? true : undefined}
          aria-label="YouTube video URL"
          className="h-9"
        />
        <Button type="submit" size="lg" disabled={!canSubmit}>
          {isValidating ? "Checking…" : "Analyse Video"}
        </Button>
        {/* Hung under the input rather than placed in the flow, so it floats
            over the list below instead of pushing the page down when it appears
            — and leaves nothing to settle back when it goes. */}
        {showFirstAnalysisHint && firstAnalysisHint.pending && (
          <div className="absolute top-full left-0 z-20 mt-2 w-72 max-w-[80vw]">
            <HintCallout
              title="Start with a link"
              arrow={{ side: "top", align: "start" }}
              onDismiss={firstAnalysisHint.dismiss}
            >
              Paste a video URL from your channel to see where its viewers
              stayed and where they left.
            </HintCallout>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {alreadyAnalysed && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <CircleCheckIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
          <span>
            You&apos;ve already analysed
            {alreadyAnalysed.title ? ` “${alreadyAnalysed.title}”` : " this video"}.
          </span>
          <Link
            href={`/analysed-video/${alreadyAnalysed.videoId}`}
            className="font-medium text-emerald-600 underline underline-offset-4 dark:text-emerald-500"
          >
            View analysis
          </Link>
        </div>
      )}
    </form>
  )
}
