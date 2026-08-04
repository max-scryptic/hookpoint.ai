"use client"

import { useMemo, useState, useTransition } from "react"
import {
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  ListChecksIcon,
  ThumbsDownIcon,
} from "lucide-react"

import { useSavedTips } from "@/components/saved-tips-provider"
import { TipFeedbackDialog } from "@/components/tip-feedback-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  tipCategoryForSection,
  tipFingerprint,
  TIP_CATEGORY_LABELS,
  type TipFeedbackReason,
} from "@/lib/tips"
import { cn } from "@/lib/utils"

// A "Try:" tip that can be acted on: the advice itself is the control. Clicking
// it opens a small menu with the two things a creator can do with a tip, keep it
// on their checklist or say it missed.
//
// This replaces a pair of icon buttons that sat at the end of every tip. A
// report can carry dozens of tips, and dozens of pairs of icons made the page
// read like a toolbar rather than like advice; folding both into the tip means
// nothing sits beside the words except the tip's own state.
//
// The path the tip was read on is captured at click time rather than passed in,
// so no call site has to plumb it through: it is the page the creator is
// looking at, which is exactly what the checklist wants to link back to.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

function currentPath(): string | null {
  if (typeof window === "undefined") return null
  return `${window.location.pathname}${window.location.search}`
}

export function TipMenu({
  tip,
  section,
  label,
}: {
  tip: string
  section: string
  // The word that introduces the tip, "Try:" or "Or:". It lives inside the
  // trigger rather than beside it so the label and the advice are one run of
  // inline text: a long tip wraps mid sentence instead of being pushed whole
  // onto the line below its own label.
  label?: string
}) {
  const { savedFingerprints, markSaved } = useSavedTips()
  const fingerprint = useMemo(() => tipFingerprint(tip), [tip])
  const saved = savedFingerprints.has(fingerprint)
  // Shown as the menu's heading, so the creator can see which group of their
  // checklist a tip will land in before they keep it.
  const category = useMemo(() => tipCategoryForSection(section), [section])

  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [flagged, setFlagged] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [isSending, startSending] = useTransition()

  function save() {
    if (saved || isSaving) return
    setSaveError(null)
    startSaving(async () => {
      try {
        const response = await fetch("/api/tips/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tip, section, sourcePath: currentPath() }),
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not save this tip.")
        }
        markSaved(fingerprint)
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "Could not save this tip.",
        )
      }
    })
  }

  function sendFeedback(reason: TipFeedbackReason, notes: string) {
    setFeedbackError(null)
    startSending(async () => {
      try {
        const response = await fetch("/api/tips/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tip,
            section,
            sourcePath: currentPath(),
            reason,
            notes,
          }),
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not send your feedback.")
        }
        setFlagged(true)
        setDialogOpen(false)
      } catch (error) {
        setFeedbackError(
          error instanceof Error
            ? error.message
            : "Could not send your feedback.",
        )
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              // The advice is the label; the menu is what opening it offers.
              aria-label={`${tip} (tip options)`}
              className={cn(
                // Truly inline, not inline-block: a button is an atomic box by
                // default, so a long tip could not break across lines and got
                // bumped whole onto the next one, leaving "Try:" stranded above
                // it. As inline text it wraps word by word like the sentence it
                // is, and box-decoration-clone keeps the rounded hover
                // background intact on every wrapped fragment.
                "inline box-decoration-clone",
                // No horizontal padding or inset: an inline box only pads its
                // first and last fragment, so any would step the first line in
                // or out from the ones it wraps onto. The background is given
                // room vertically instead, which the line box absorbs.
                "-my-0.5 cursor-pointer rounded-md py-0.5 text-left select-text",
                "underline decoration-blue-500/30 decoration-dotted underline-offset-4 transition-colors",
                "hover:bg-blue-500/10 hover:decoration-blue-500/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "data-popup-open:bg-blue-500/10 data-popup-open:decoration-blue-500/70",
                flagged && "text-blue-600/60 dark:text-blue-400/60",
              )}
            />
          }
        >
          {label && <span className="font-medium">{label} </span>}
          {tip}
          {/* What has already been done with this tip, kept inside the trigger
              so the state travels with the words when the line wraps. */}
          {saved && (
            <BookmarkCheckIcon
              aria-hidden="true"
              className="ml-1 inline size-3.5 shrink-0 align-[-0.15em]"
            />
          )}
          {flagged && (
            <ThumbsDownIcon
              aria-hidden="true"
              className="ml-1 inline size-3.5 shrink-0 align-[-0.15em]"
            />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-auto min-w-52">
          {/* The heading names the whole menu, so everything in it sits in one
              group. The group is not decoration: the label reads its id from
              the group above it and throws without one, which took the whole
              page down the moment a tip was clicked. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {TIP_CATEGORY_LABELS[category]} tip
            </DropdownMenuLabel>
            <DropdownMenuItem disabled={saved || isSaving} onClick={save}>
              {saved ? <BookmarkCheckIcon /> : <BookmarkPlusIcon />}
              {saved ? "On your checklist" : "Add to checklist"}
            </DropdownMenuItem>
            {saved && (
              <DropdownMenuItem render={<a href="/dashboard/checklist" />}>
                <ListChecksIcon />
                Open your checklist
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={flagged}
            onClick={() => {
              setFeedbackError(null)
              setDialogOpen(true)
            }}
          >
            <ThumbsDownIcon />
            {flagged ? "Flagged as not useful" : "Not useful"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {saveError && (
        <span className="ml-1 text-xs text-destructive">{saveError}</span>
      )}

      {dialogOpen && (
        <TipFeedbackDialog
          tip={tip}
          section={section}
          submitting={isSending}
          error={feedbackError}
          onOpenChange={setDialogOpen}
          onSubmit={sendFeedback}
        />
      )}
    </>
  )
}
