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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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

// The small marker that trails a tip once something has been done with it. It
// sits outside the clickable advice, so what a creator can press is words only,
// and it says what it means on hover: an icon on its own leaves the creator to
// guess whether it stands for kept, done, or dismissed.
function TipStateMarker({
  icon: Icon,
  label,
}: {
  icon: typeof BookmarkCheckIcon
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            // Named for assistive tech, and reachable by keyboard so the
            // meaning is not hover-only.
            role="img"
            aria-label={label}
            tabIndex={0}
            className={cn(
              "ml-1 inline-flex cursor-help rounded-sm align-[-0.2em]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          />
        }
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TipMenu({ tip, section }: { tip: string; section: string }) {
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
          // A span rather than a button, because a button is an atomic inline
          // level box: a wrapped one is shrink-to-fit at the full width of the
          // line, so the underline and hover fill ran to the right edge of
          // every line, including a last line holding two words. A span with
          // display:inline lays the tip out as text, so the target ends where
          // the words do on each line. nativeButton={false} tells Base UI to
          // supply the semantics the element no longer has for itself: the
          // button role, tab stop, and Enter/Space activation.
          nativeButton={false}
          render={
            <span
              // The advice is the label; the menu is what opening it offers.
              aria-label={`${tip} (tip options)`}
              className={cn(
                // box-decoration-clone rounds and pads every wrapped fragment
                // rather than only the first and last.
                "-mx-1 inline box-decoration-clone cursor-pointer rounded-md px-1 py-0.5 text-left select-text",
                "underline decoration-blue-500/30 decoration-dotted underline-offset-4 transition-colors",
                "hover:bg-blue-500/10 hover:decoration-blue-500/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "data-popup-open:bg-blue-500/10 data-popup-open:decoration-blue-500/70",
                flagged && "text-blue-600/60 dark:text-blue-400/60",
              )}
            />
          }
        >
          {tip}
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
      {/* What has already been done with this tip, sitting just outside the
          clickable advice. Nothing separates it from the trigger, so it stays
          on the same line as the tip's last word instead of wrapping off on
          its own. */}
      {saved && (
        <TipStateMarker
          icon={BookmarkCheckIcon}
          label="Tip added to your checklist"
        />
      )}
      {flagged && (
        <TipStateMarker
          icon={ThumbsDownIcon}
          label="Tip flagged as not useful"
        />
      )}

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
