"use client"

import { useState } from "react"
import { CheckIcon, Loader2Icon } from "lucide-react"

import {
  CANCELLATION_REASONS,
  type CancellationReason,
} from "@/lib/billing/cancellation-reasons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Shown before a paid plan is actually cancelled: the user must pick a reason
// (and can leave notes) so we can record why they're leaving. Submitting hands
// the reason + notes back to the caller, which performs the cancellation and
// persists the feedback. Rendered only while open so each run starts with a
// fresh, unselected form.
export function CancelSurveyDialog({
  planName,
  submitting,
  error,
  onOpenChange,
  onSubmit,
}: {
  planName: string
  submitting: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (reason: CancellationReason, notes: string) => void
}) {
  const [reason, setReason] = useState<CancellationReason | null>(null)
  const [notes, setNotes] = useState("")

  function handleSubmit() {
    if (!reason || submitting) return
    onSubmit(reason, notes)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Ignore close attempts mid-request so the survey doesn't vanish while
        // the cancellation is being scheduled.
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-xl">Before you downgrade</DialogTitle>
          <DialogDescription>
            You&rsquo;re about to cancel your {planName} plan. Mind telling us
            why? It helps us improve Hookpoint.
          </DialogDescription>
        </DialogHeader>

        <fieldset
          disabled={submitting}
          className="flex flex-col gap-2"
          aria-label="Reason for cancelling"
        >
          {CANCELLATION_REASONS.map((option) => {
            const selected = reason === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setReason(option.value)}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  "disabled:pointer-events-none disabled:opacity-60",
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:bg-muted/50",
                )}
              >
                <span>{option.label}</span>
                {selected ? (
                  <CheckIcon className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            )
          })}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cancel-notes"
            className="text-sm font-medium text-foreground"
          >
            Anything else? <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="cancel-notes"
            value={notes}
            disabled={submitting}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Tell us more about your decision…"
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
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Never mind
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || submitting}
            aria-busy={submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                Cancelling…
              </>
            ) : (
              "Confirm cancellation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
