"use client"

import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import type {
  DeepAnalysisFeedbackReason,
  DeepAnalysisFeedbackRating,
  DeepAnalysisInsightFeedback,
} from "@/lib/deep-analysis-insight-feedback"

const REASON_LABELS: Array<{
  value: DeepAnalysisFeedbackReason
  label: string
}> = [
  { value: "incorrect", label: "Incorrect" },
  { value: "too_generic", label: "Too generic" },
  { value: "not_actionable", label: "Not actionable" },
  { value: "already_known", label: "Already knew this" },
  { value: "other", label: "Other" },
]

export function DeepAnalysisFeedback({
  videoId,
  retentionWindowId,
  initialFeedback,
}: {
  videoId: string
  retentionWindowId: string
  initialFeedback: DeepAnalysisInsightFeedback | null
}) {
  const [rating, setRating] = useState<DeepAnalysisFeedbackRating | null>(
    initialFeedback?.rating ?? null,
  )
  const [reason, setReason] = useState<DeepAnalysisFeedbackReason | null>(
    initialFeedback?.reason ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(
    nextRating: DeepAnalysisFeedbackRating,
    nextReason: DeepAnalysisFeedbackReason | null = null,
  ) {
    const previous = rating
    const previousReason = reason
    setRating(nextRating)
    setReason(nextRating === "not_helpful" ? nextReason : null)
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/videos/${videoId}/deep-analysis-feedback`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              retentionWindowId,
              rating: nextRating,
              reason: nextRating === "not_helpful" ? nextReason : null,
            }),
          },
        )
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not save your feedback.")
        }
      } catch (submitError) {
        setRating(previous)
        setReason(previousReason)
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Could not save your feedback.",
        )
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-muted-foreground">
          Was this insight useful?
        </span>
        <Button
          type="button"
          size="sm"
          variant={rating === "helpful" ? "secondary" : "outline"}
          disabled={isPending}
          aria-pressed={rating === "helpful"}
          onClick={() => submit("helpful")}
        >
          <ThumbsUpIcon /> Helpful
        </Button>
        <Button
          type="button"
          size="sm"
          variant={rating === "not_helpful" ? "secondary" : "outline"}
          disabled={isPending}
          aria-pressed={rating === "not_helpful"}
          onClick={() => submit("not_helpful", reason)}
        >
          <ThumbsDownIcon /> Not helpful
        </Button>
        {rating && !error && (
          <span className="text-xs text-muted-foreground">Feedback saved.</span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      {rating === "not_helpful" && (
        <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-36">
          <span className="mr-1 text-xs text-muted-foreground">What was wrong?</span>
          {REASON_LABELS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={reason === option.value ? "secondary" : "ghost"}
              disabled={isPending}
              aria-pressed={reason === option.value}
              onClick={() => submit("not_helpful", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
