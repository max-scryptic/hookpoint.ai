"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, TrashIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Deleting a plan takes its footage and its thumbnail with it, so it asks
// first. A plan is the only place that footage exists - it was never published
// anywhere - which is exactly why this is worth a confirmation and the tip
// checklist is not: a saved tip can be re-read from a report, and this cannot
// be got back at all.
export function VideoPlanDeleteButton({ planId }: { planId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/video-plans/${planId}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        setError(data?.message ?? "Could not delete this plan.")
        setBusy(false)
        return
      }
      router.push("/video-planner")
      router.refresh()
    } catch {
      setError("Could not delete this plan.")
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <TrashIcon className="size-4" />
        Delete plan
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this plan?</DialogTitle>
            <DialogDescription>
              This removes the plan, the footage you uploaded for it and its
              thumbnail. Any tips you saved to your checklist stay there.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Keep it
            </Button>
            <Button onClick={remove} disabled={busy}>
              {busy ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <TrashIcon className="size-4" />
              )}
              Delete plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
