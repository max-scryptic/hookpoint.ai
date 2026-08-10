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
  className,
}: {
  icon: typeof BookmarkCheckIcon
  label: string
  className?: string
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
              className,
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

export function TipMenu({
  tip,
  section,
  label,
}: {
  tip: string
  section: string
  // The word that introduces the tip, "Try:". It lives inside the trigger
  // rather than beside it so the label and the advice are one run of inline
  // text: a long tip wraps mid sentence instead of being pushed whole onto the
  // line below its own label.
  label?: string
}) {
  const { savedFingerprints, markSaved, markRemoved } = useSavedTips()
  const fingerprint = useMemo(() => tipFingerprint(tip), [tip])
  const saved = savedFingerprints.has(fingerprint)
  // Shown as the menu's heading, so the creator can see what kind of tip they
  // are looking at before they keep it.
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
          // A span rather than a button, so the tip can be laid out as inline
          // text (see the class list below). nativeButton={false} tells Base UI
          // to supply the semantics the element no longer has for itself: the
          // button role, tab stop, and Enter/Space activation.
          nativeButton={false}
          render={
            <span
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
              )}
            />
          }
        >
          {label && <span className="font-medium">{label} </span>}
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
      {/* What has already been done with this tip, sitting just outside the
          clickable advice. Nothing separates it from the trigger, so a mark
          stays on the same line as the tip's last word instead of wrapping off
          on its own. Colour is what separates the two marks at this size, green
          for kept and red for flagged, so a glance down a report reads without
          opening menus. Flagging a tip does not fade the advice: the tip still
          says what it says, and the mark beside it carries the state. */}
      {saved && (
        <TipStateMarker
          icon={BookmarkCheckIcon}
          label="Tip added to your checklist"
          className="text-emerald-600 dark:text-emerald-400"
        />
      )}
      {flagged && (
        <TipStateMarker
          icon={ThumbsDownIcon}
          label="Tip flagged as not useful"
          className="text-red-600 dark:text-red-400"
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
