"use client"

import { useMemo, useState, useTransition } from "react"
import {
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  ThumbsDownIcon,
} from "lucide-react"

import { useSavedTips } from "@/components/saved-tips-provider"
import { TipFeedbackDialog } from "@/components/tip-feedback-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { tipFingerprint, type TipFeedbackReason } from "@/lib/tips"
import { cn } from "@/lib/utils"

// The two controls that sit at the end of every "Try:" tip: keep it on the
// checklist, or flag it as not useful. Deliberately quiet, since a report can
// carry dozens of tips and these must not compete with the advice itself.
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

// An icon control on a tip: muted until it is hovered or focused, so the row
// still reads as one line of advice.
function TipActionButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
              "hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
              active
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TipActions({ tip, section }: { tip: string; section: string }) {
  const { savedFingerprints, markSaved } = useSavedTips()
  const fingerprint = useMemo(() => tipFingerprint(tip), [tip])
  const saved = savedFingerprints.has(fingerprint)

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
      <span className="inline-flex items-center gap-0.5 align-middle">
        <TipActionButton
          label={saved ? "On your tip checklist" : "Save to tip checklist"}
          active={saved}
          disabled={isSaving || saved}
          onClick={save}
        >
          {saved ? (
            <BookmarkCheckIcon className="size-4" />
          ) : (
            <BookmarkPlusIcon className="size-4" />
          )}
        </TipActionButton>
        <TipActionButton
          label={flagged ? "Flagged as not useful" : "Flag as not useful"}
          active={flagged}
          disabled={flagged}
          onClick={() => {
            setFeedbackError(null)
            setDialogOpen(true)
          }}
        >
          <ThumbsDownIcon className="size-4" />
        </TipActionButton>
        {saveError && (
          <span className="text-xs text-destructive">{saveError}</span>
        )}
      </span>

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
