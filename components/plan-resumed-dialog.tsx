"use client"

import { useRouter } from "next/navigation"
import { CheckCircle2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface PlanResumedDetails {
  planName: string
}

// Confirmation shown after a scheduled cancellation is cleared and the paid
// plan continues. Mirrors PlanCancelledDialog and replaces the old inline
// "your plan will continue" banner.
export function PlanResumedDialog({
  details,
  onOpenChange,
}: {
  details: PlanResumedDetails | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  if (!details) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="items-start gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CheckCircle2Icon className="size-5" />
          </div>
          <div>
            <DialogTitle className="text-xl">Plan resumed</DialogTitle>
            <DialogDescription>
              Your {details.planName} plan will continue, and the scheduled
              cancellation is off.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            Nothing changes for you: you keep full{" "}
            <span className="font-medium text-foreground">
              {details.planName}
            </span>{" "}
            access and your billing carries on as normal. You won&rsquo;t lose
            your plan at the end of the current period.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => router.push("/dashboard")}>
            Go to dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
