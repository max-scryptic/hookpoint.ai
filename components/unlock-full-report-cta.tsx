"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LockIcon, SparklesIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { SOURCE_FILE_UPLOAD_SECTION_ID } from "@/components/source-file-upload"
import { SOURCE_FILE_READY_EVENT } from "@/components/source-video-thumbnail"
import { cn } from "@/lib/utils"

// The compact prompt at the top of a video's report offering the deeper,
// footage-based half of the analysis. Everything above the fold is read from
// the retention curve and the transcript; the frame-by-frame half only exists
// once the raw source file has been uploaded, so this is the one prompt that
// leads there.
//
// It sits on the same row as the video's KPIs rather than in a banner above
// them, so the report still opens on the title, the thumbnail and the numbers.
// That row is the size budget: one short line of copy under the headline, and
// nothing taller than the metrics beside it.
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
  // user is still on it would otherwise leave the prompt behind, still offering
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
    <section className="flex w-full items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 sm:ml-auto sm:w-auto">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {canUpload ? (
          <SparklesIcon className="size-3.5" />
        ) : (
          <LockIcon className="size-3.5" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-sm leading-tight font-medium">
          Unlock the full report
        </h2>
        <p className="text-xs leading-tight text-muted-foreground">
          {canUpload
            ? "Upload the raw source file to analyse every key moment frame by frame."
            : "Upgrade to Starter or Pro to analyse your footage frame by frame."}
        </p>
      </div>

      {canUpload ? (
        <Button
          size="sm"
          className="shrink-0"
          onClick={scrollToSourceFileUpload}
        >
          Unlock
        </Button>
      ) : (
        <Link
          href="/pricing"
          className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
        >
          Upgrade
        </Link>
      )}
    </section>
  )
}
