"use client"

import { useState } from "react"
import { CheckIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  TIP_FEEDBACK_REASON_LABELS,
  TIP_FEEDBACK_REASONS,
  TIP_NOTES_MAX_LENGTH,
  type TipFeedbackReason,
} from "@/lib/tips"
import { cn } from "@/lib/utils"

// Opened when a creator flags a "Try:" tip as not useful. They pick what was
// wrong and can write the rest in their own words; both are sent back with the
// tip and the section it was read in, and read in the admin under Tip Feedback.
// Rendered only while open, so each flag starts on a blank form.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

export function TipFeedbackDialog({
  tip,
  section,
  submitting,
  error,
  onOpenChange,
  onSubmit,
}: {
  tip: string
  section: string
  submitting: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (reason: TipFeedbackReason, notes: string) => void
}) {
  const [reason, setReason] = useState<TipFeedbackReason | null>(null)
  const [notes, setNotes] = useState("")

  function handleSubmit() {
    if (!reason || submitting) return
    onSubmit(reason, notes)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Ignore close attempts mid-request so the form does not vanish while
        // the feedback is still being sent.
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-xl">What missed here?</DialogTitle>
          <DialogDescription>
            Telling us why this one did not land is how the advice gets better.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">{section}</p>
          <p className="mt-1 text-sm">{tip}</p>
        </div>

        <fieldset
          disabled={submitting}
          className="flex flex-col gap-2"
          aria-label="What was wrong with this tip"
        >
          {TIP_FEEDBACK_REASONS.map((option) => {
            const selected = reason === option
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => setReason(option)}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  "disabled:pointer-events-none disabled:opacity-60",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:bg-muted/50",
                )}
              >
                <span>{TIP_FEEDBACK_REASON_LABELS[option]}</span>
                {selected ? (
                  <CheckIcon className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            )
          })}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="tip-feedback-notes"
            className="text-sm font-medium text-foreground"
          >
            Anything else?{" "}
            <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="tip-feedback-notes"
            value={notes}
            disabled={submitting}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={TIP_NOTES_MAX_LENGTH}
            placeholder="What would have been more useful here?"
            className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            size="lg"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Never mind
          </Button>
          <Button
            type="button"
            size="lg"
            className="min-w-32"
            disabled={reason === null || submitting}
            aria-busy={submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                Sending
              </>
            ) : (
              "Send feedback"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
