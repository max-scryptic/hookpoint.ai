"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

// "Keep my plan" action for the settings "Cancellation scheduled" banner.
// Clears the pending cancellation via /api/billing/resume, then refreshes so the
// server re-resolves the plan state and the banner disappears.
export function BillingResumeButton({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resume() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/billing/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) {
        setError(data.error ?? "Something went wrong.")
        setIsLoading(false)
        return
      }
      router.refresh()
    } catch {
      setError("Something went wrong.")
      setIsLoading(false)
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled || isLoading}
        onClick={resume}
      >
        {isLoading ? "Keeping…" : "Keep my plan"}
      </Button>
      {error ? (
        <span className="text-sm text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
