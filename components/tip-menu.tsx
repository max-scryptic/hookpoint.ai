"use client"

import { useMemo, useState, useTransition } from "react"
import {
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  BookmarkXIcon,
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

export function TipMenu({ tip, section }: { tip: string; section: string }) {
  const { savedFingerprints, markSaved, markRemoved } = useSavedTips()
  const fingerprint = useMemo(() => tipFingerprint(tip), [tip])
  const saved = savedFingerprints.has(fingerprint)
  // Shown as the menu's heading, so the creator can see which group of their
  // checklist a tip will land in before they keep it.
  const category = useMemo(() => tipCategoryForSection(section), [section])

  const [saveError, setSaveError] = useState<string | null>(null)
  // One flag for both directions: keeping and removing are the same button, and
  // it should be inert while either is in flight.
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

  // Keeping a tip can be undone from where it was kept, so the creator does not
  // have to open their checklist to take back a click. The tip is removed by its
  // words rather than by a row id, which is all a report knows about it.
  function remove() {
    if (!saved || isSaving) return
    setSaveError(null)
    startSaving(async () => {
      try {
        const response = await fetch("/api/tips/checklist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tip }),
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not remove this tip.")
        }
        markRemoved(fingerprint)
      } catch (error) {
        setSaveError(
          error instanceof Error ? error.message : "Could not remove this tip.",
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
                // Inline, so a tip still wraps and reads as one sentence
                // running on from "Try:" rather than as a block of its own.
                "-mx-1 -my-0.5 cursor-pointer rounded-md px-1 py-0.5 text-left align-baseline select-text",
                "underline decoration-blue-500/30 decoration-dotted underline-offset-4 transition-colors",
                "hover:bg-blue-500/10 hover:decoration-blue-500/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "data-popup-open:bg-blue-500/10 data-popup-open:decoration-blue-500/70",
              )}
            />
          }
        >
          {tip}
          {/* What has already been done with this tip, kept inside the trigger
              so the state travels with the words when the line wraps. Flagging a
              tip does not fade the advice: the tip still says what it says, and
              the mark beside it carries the state on its own. Colour is what
              separates the two marks at this size, green for kept and red for
              flagged, so a glance down a report reads without opening menus. */}
          {saved && (
            <BookmarkCheckIcon
              aria-hidden="true"
              className="ml-1 inline size-3.5 shrink-0 align-[-0.15em] text-emerald-600 dark:text-emerald-400"
            />
          )}
          {flagged && (
            <ThumbsDownIcon
              aria-hidden="true"
              className="ml-1 inline size-3.5 shrink-0 align-[-0.15em] text-red-600 dark:text-red-400"
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
            {/* A kept tip offers the way back out rather than restating that it
                is kept: the mark on the tip already says that, so the menu is
                left with something to do. */}
            <DropdownMenuItem
              disabled={isSaving}
              onClick={saved ? remove : save}
            >
              {saved ? <BookmarkXIcon /> : <BookmarkPlusIcon />}
              {saved ? "Remove from checklist" : "Add to checklist"}
            </DropdownMenuItem>
            {saved && (
              <DropdownMenuItem render={<a href="/dashboard/checklist" />}>
                <ListChecksIcon />
                Open your checklist
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {/* Flagging is a one-way, one-time thing, so once it is done the item
              goes rather than sitting there dead. The menu is then the checklist
              alone, and the red mark on the tip is what says it was flagged. */}
          {!flagged && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setFeedbackError(null)
                  setDialogOpen(true)
                }}
              >
                <ThumbsDownIcon />
                Not useful
              </DropdownMenuItem>
            </>
          )}
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
