"use client"

import { useState, useTransition } from "react"
import { format } from "date-fns"
import {
  ArrowUpRightIcon,
  CheckIcon,
  ListChecksIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { SavedTip } from "@/lib/tips"
import { cn } from "@/lib/utils"

// The creator's kept tips, to work through while making the next video. Open
// ones lead; ticked ones fall to a done list underneath rather than vanishing,
// so a tip can be un-ticked when the next video comes around.
//
// State is held here and each change is written straight through to the API, so
// ticking and removing feel immediate. A failed write is rolled back and said
// out loud rather than left looking as though it landed.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

function TipRow({
  tip,
  onToggle,
  onRemove,
  busy,
}: {
  tip: SavedTip
  onToggle: () => void
  onRemove: () => void
  busy: boolean
}) {
  const done = tip.completedAt !== null
  return (
    <li className="flex items-start gap-3 p-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "Mark as still to do" : "Mark as done"}
        disabled={busy}
        onClick={onToggle}
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input hover:border-primary/60 hover:bg-muted",
        )}
      >
        {done && <CheckIcon className="size-3.5" />}
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", done && "text-muted-foreground line-through")}>
          {tip.tip}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium">
            {tip.section}
          </span>
          <span>Saved {format(new Date(tip.createdAt), "d MMM yyyy")}</span>
          {tip.sourcePath && (
            <Link
              href={tip.sourcePath}
              className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline"
            >
              Open the report
              <ArrowUpRightIcon className="size-3" />
            </Link>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Remove this tip"
        disabled={busy}
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2Icon />
      </Button>
    </li>
  )
}

function TipList({
  title,
  tips,
  onToggle,
  onRemove,
  pendingId,
}: {
  title: string
  tips: SavedTip[]
  onToggle: (tip: SavedTip) => void
  onRemove: (tip: SavedTip) => void
  pendingId: string | null
}) {
  if (tips.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        {title} ({tips.length})
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {tips.map((tip) => (
          <TipRow
            key={tip.id}
            tip={tip}
            busy={pendingId === tip.id}
            onToggle={() => onToggle(tip)}
            onRemove={() => onRemove(tip)}
          />
        ))}
      </ul>
    </section>
  )
}

export function TipChecklist({ tips: initialTips }: { tips: SavedTip[] }) {
  const [tips, setTips] = useState(initialTips)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const open = tips.filter((tip) => tip.completedAt === null)
  const done = tips.filter((tip) => tip.completedAt !== null)

  function toggle(tip: SavedTip) {
    const completed = tip.completedAt === null
    const previous = tips
    setError(null)
    setPendingId(tip.id)
    setTips((current) =>
      current.map((candidate) =>
        candidate.id === tip.id
          ? {
              ...candidate,
              completedAt: completed ? new Date().toISOString() : null,
            }
          : candidate,
      ),
    )
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tips/checklist/${tip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed }),
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not update this tip.")
        }
      } catch (updateError) {
        setTips(previous)
        setError(
          updateError instanceof Error
            ? updateError.message
            : "Could not update this tip.",
        )
      } finally {
        setPendingId(null)
      }
    })
  }

  function remove(tip: SavedTip) {
    const previous = tips
    setError(null)
    setPendingId(tip.id)
    setTips((current) => current.filter((candidate) => candidate.id !== tip.id))
    startTransition(async () => {
      try {
        const response = await fetch(`/api/tips/checklist/${tip.id}`, {
          method: "DELETE",
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not remove this tip.")
        }
      } catch (deleteError) {
        setTips(previous)
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "Could not remove this tip.",
        )
      } finally {
        setPendingId(null)
      }
    })
  }

  if (tips.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <ListChecksIcon className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Your checklist is empty</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Every report ends its sections on a blue &quot;Try:&quot; tip. Use the
          bookmark beside one to keep it here, and it will be waiting the next
          time you plan a video.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <TipList
        title="To try"
        tips={open}
        onToggle={toggle}
        onRemove={remove}
        pendingId={pendingId}
      />
      <TipList
        title="Done"
        tips={done}
        onToggle={toggle}
        onRemove={remove}
        pendingId={pendingId}
      />
    </div>
  )
}
