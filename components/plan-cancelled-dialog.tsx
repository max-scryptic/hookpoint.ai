"use client"

import { useRouter } from "next/navigation"
import { CalendarClockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Formats the access-until date for display, e.g. "11 Aug 2026".
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export interface PlanCancelledDetails {
  planName: string
  periodEnd: string
}

// Confirmation shown after a paid plan is scheduled to move to Free. Spells out
// that access continues until the end of the current billing period and offers a
// way to close or head back into the app. Replaces the old inline banner.
export function PlanCancelledDialog({
  details,
  onOpenChange,
}: {
  details: PlanCancelledDetails | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  if (!details) return null

  const accessUntil = formatDate(details.periodEnd)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="items-start gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarClockIcon className="size-5" />
          </div>
          <div>
            <DialogTitle className="text-xl">Cancellation scheduled</DialogTitle>
            <DialogDescription>
              Your {details.planName} plan is set to move to Free at the end of
              the current billing period.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            You keep full {details.planName} access until{" "}
            <span className="font-medium text-foreground">{accessUntil}</span>.
            After that your account moves to the Free plan. Nothing more to do,
            and you won&rsquo;t be charged again.
          </p>
          <p className="mt-3 text-muted-foreground">
            Changed your mind? You can resume your plan any time before then.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => router.push("/analyse-video")}>
            Analyse a video
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
