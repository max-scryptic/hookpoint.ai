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
import { TipExamples } from "@/components/tip-examples"
import { TipFeedbackDialog } from "@/components/tip-feedback-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { canGenerateTipExamples } from "@/lib/tip-examples"
import {
  tipCategoryForSection,
  tipFingerprint,
  TIP_CATEGORY_LABELS,
  type TipFeedbackReason,
} from "@/lib/tips"
import { cn } from "@/lib/utils"

// A "Try:" tip that can be acted on: the advice itself is the control. Clicking
// it opens the tip out into a card that shows what the advice actually looks
// like once carried out, three worked examples tabbed through by approach, with
// the two things a creator can do with a tip underneath: keep it on their
// checklist, or say it missed.
//
// The examples are the reason this is a card rather than the menu it used to
// be. A tip is one line of advice, and the gap between agreeing with it and
// doing it is the whole difficulty: "Open on the specific claim rather than the
// setup" is easy to nod at and hard to write. So opening a tip answers the
// question that follows it, in the creator's own subject matter, and the two
// actions sit below that answer rather than being the only thing on offer.
//
// Everything about the trigger is unchanged: the advice is the clickable thing,
// laid out as inline text so a long tip wraps mid sentence, and nothing sits
// beside the words except the tip's own state.
//
// The path the tip was read on is captured at click time rather than passed in,
// so no call site has to plumb it through: it is the page the creator is
// looking at, which is what the checklist wants to link back to and what the
// examples are grounded in.
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
  // Shown as the card's heading, so the creator can see what kind of tip they
  // are looking at before they keep it.
  const category = useMemo(() => tipCategoryForSection(section), [section])

  const [open, setOpen] = useState(false)
  // Read once, when the card is opened, rather than during render: the path is
  // a browser fact, and a server render has no window to read it from. Both the
  // examples and anything saved from this card record the same one.
  const [sourcePath, setSourcePath] = useState("")

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
            sourcePath: sourcePath || currentPath(),
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
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setSourcePath(currentPath() ?? "")
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          // A span rather than a button, so the tip can be laid out as inline
          // text (see the class list below). nativeButton={false} tells Base UI
          // to supply the semantics the element no longer has for itself: the
          // button role, tab stop, and Enter/Space activation.
          nativeButton={false}
          render={
            <span
              // The advice is the label; the examples and the two actions are
              // what opening it offers.
              aria-label={`${tip} (examples and tip options)`}
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
        </PopoverTrigger>

        {/* Wide enough for a quoted line of narration to read as one, and
            capped against the viewport so a tip opened on a phone stays on
            screen. The padding is per section rather than on the popup, so the
            rule above the actions runs the full width of the card. */}
        <PopoverContent
          align="start"
          aria-label={`Examples and options for the tip: ${tip}`}
          className="w-[26rem] max-w-[calc(100vw-2rem)] p-0"
        >
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">
                {TIP_CATEGORY_LABELS[category]} tip
              </span>
              <span className="text-sm font-medium">
                Three ways to put this into practice
              </span>
            </div>
            {/* A tip long enough to be a paragraph is a report section that
                leaked into a callout, and examples of it would be worth
                neither the wait nor the spend, so the card is the two actions
                alone. */}
            {canGenerateTipExamples(tip) ? (
              <TipExamples
                tip={tip}
                section={section}
                sourcePath={sourcePath}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                This tip is too long for worked examples.
              </p>
            )}
          </div>

          <Separator />

          {/* The two things a creator can do with a tip, under the examples
              rather than in place of them. Both stay usable while the examples
              are still loading, and if they never arrive. */}
          <div className="flex flex-wrap items-center gap-2 p-3">
            <Button
              size="sm"
              variant={saved ? "outline" : "default"}
              disabled={isSaving}
              onClick={saved ? remove : save}
            >
              {saved ? (
                <BookmarkXIcon data-icon="inline-start" />
              ) : (
                <BookmarkPlusIcon data-icon="inline-start" />
              )}
              {saved ? "Remove from checklist" : "Add to checklist"}
            </Button>
            {saved && (
              <a
                href="/checklist"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "gap-1",
                )}
              >
                <ListChecksIcon data-icon="inline-start" />
                Open checklist
              </a>
            )}
            {/* Flagging is a one-way, one-time thing, so once it is done the
                button goes rather than sitting there dead. The red mark on the
                tip is what says it was flagged. */}
            {!flagged && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                onClick={() => {
                  setFeedbackError(null)
                  // The dialog takes the focus and the escape key, so the card
                  // it was opened from gets out of its way.
                  setOpen(false)
                  setDialogOpen(true)
                }}
              >
                <ThumbsDownIcon data-icon="inline-start" />
                Not useful
              </Button>
            )}
          </div>

          {saveError && (
            <p className="px-3 pb-3 text-xs text-destructive">{saveError}</p>
          )}
        </PopoverContent>
      </Popover>
      {/* What has already been done with this tip, sitting just outside the
          clickable advice. Nothing separates it from the trigger, so a mark
          stays on the same line as the tip's last word instead of wrapping off
          on its own. Colour is what separates the two marks at this size, green
          for kept and red for flagged, so a glance down a report reads without
          opening cards. Flagging a tip does not fade the advice: the tip still
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
