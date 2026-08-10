"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LockIcon, SparklesIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { SOURCE_FILE_UPLOAD_SECTION_ID } from "@/components/source-file-upload"
import { SOURCE_FILE_READY_EVENT } from "@/components/source-video-thumbnail"
import { cn } from "@/lib/utils"

// The banner at the top of a video's report offering the deeper, footage-based
// half of the analysis. Everything above the fold is read from the retention
// curve and the transcript; the frame-by-frame half only exists once the raw
// source file has been uploaded, so this is the one prompt that leads there.
//
// Two audiences, one headline. A paid user only has to scroll to the upload
// card further down the page, so the button takes them straight to it. A Free
// user cannot upload at all, so theirs points at the plans instead.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// Brings the raw source-file card into view, and moves keyboard focus with it
// so the next Tab continues from the card the button promised rather than from
// the top of the page. preventScroll stops the focus call from cancelling the
// smooth scroll with an instant jump.
function scrollToSourceFileUpload() {
  const section = document.getElementById(SOURCE_FILE_UPLOAD_SECTION_ID)
  if (!section) return

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches
  section.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  })
  section.focus({ preventScroll: true })
}

export function UnlockFullReportCta({
  videoId,
  canUpload,
}: {
  videoId: string
  // True when the user's plan includes source-file uploads. False on Free,
  // where the report can only be unlocked by upgrading first.
  canUpload: boolean
}) {
  // The page renders this on the server, so an upload that completes while the
  // user is still on it would otherwise leave the banner behind, still offering
  // something they have just done. The upload card announces a finished upload
  // on the window; take that as the cue to retire.
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    function handleSourceFileReady(event: Event) {
      const readyVideoId = (event as CustomEvent<{ videoId?: string }>).detail
        ?.videoId
      if (readyVideoId === videoId) setUnlocked(true)
    }

    window.addEventListener(SOURCE_FILE_READY_EVENT, handleSourceFileReady)
    return () =>
      window.removeEventListener(SOURCE_FILE_READY_EVENT, handleSourceFileReady)
  }, [videoId])

  if (unlocked) return null

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {canUpload ? (
          <SparklesIcon className="size-4.5" />
        ) : (
          <LockIcon className="size-4.5" />
        )}
      </span>

      <div className="flex-1">
        <h2 className="font-heading text-base font-medium">
          Unlock the full report
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {canUpload
            ? "This report is read from your retention curve and transcript. Upload the raw source file and every key moment is analysed frame by frame too: the edit, the visuals, the on-screen text and the audio."
            : "Deep analysis reads the footage itself, frame by frame: the edit, the visuals, the on-screen text and the audio behind every key moment. Upgrade to Starter or Pro to upload your source file and unlock it."}
        </p>
      </div>

      {canUpload ? (
        <Button
          size="lg"
          className="shrink-0 self-start sm:self-auto"
          onClick={scrollToSourceFileUpload}
        >
          Unlock full report
        </Button>
      ) : (
        <Link
          href="/pricing"
          className={cn(
            buttonVariants({ size: "lg" }),
            "shrink-0 self-start sm:self-auto",
          )}
        >
          Upgrade to unlock
        </Link>
      )}
    </section>
  )
}
