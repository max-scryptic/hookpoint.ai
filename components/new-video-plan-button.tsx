"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// Starts a plan and opens it. The row is created empty and the creator fills it
// in on its own page, which is what lets a plan be left half-finished and come
// back to: an unfinished draft is a row in the list, not a form abandoned in a
// tab.
export function NewVideoPlanButton({
  label = "New Video Plan",
  variant = "default",
}: {
  label?: string
  variant?: "default" | "outline"
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/video-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No titles yet: they are typed on the plan's own page.
        body: JSON.stringify({ titles: [] }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        setError(data?.message ?? "Could not start a new video.")
        setBusy(false)
        return
      }
      const { plan } = (await response.json()) as { plan: { id: string } }
      router.push(`/video-planner/${plan.id}`)
      router.refresh()
    } catch {
      setError("Could not start a new video.")
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button variant={variant} disabled={busy} onClick={create}>
        {busy ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <PlusIcon className="size-4" />
        )}
        {label}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
