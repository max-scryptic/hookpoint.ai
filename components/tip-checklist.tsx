"use client"

import { useRef, useState, useTransition } from "react"
import { format } from "date-fns"
import {
  ArrowUpRightIcon,
  GripVerticalIcon,
  ListChecksIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { TIP_CATEGORY_LABELS, type SavedTip } from "@/lib/tips"
import { cn } from "@/lib/utils"

// The creator's kept tips: a reference list to keep beside them while planning
// the next video, in the order they mean to work through it. Nothing is ticked
// off here. A tip is either worth keeping, in which case it stays and can be
// dragged to where it belongs, or it is not, in which case it goes.
//
// One flat list, not grouped by what each tip is about: the order is now the
// creator's own priority order, and grouping would cut it into runs that cannot
// be compared. Each line still says which category it belongs to, so the
// grouping is readable off the list without being imposed on it.
//
// Reordering is driven by pointer events rather than HTML5 drag and drop, so
// dragging works the same with a finger as with a mouse, and the handle is a
// button that takes the arrow keys for anyone not using either.
//
// State is held here and each change is written straight through to the API, so
// dragging and removing feel immediate. A failed write is rolled back and said
// out loud rather than left looking as though it landed.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

function move<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function sameOrder(a: SavedTip[], b: SavedTip[]): boolean {
  return a.length === b.length && a.every((tip, index) => tip.id === b[index].id)
}

function TipRow({
  tip,
  index,
  total,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  onMoveByKey,
  onRemove,
  busy,
}: {
  tip: SavedTip
  index: number
  total: number
  dragging: boolean
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void
  onDragMove: (event: React.PointerEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  onMoveByKey: (direction: -1 | 1) => void
  onRemove: () => void
  busy: boolean
}) {
  return (
    <li
      data-tip-id={tip.id}
      className={cn(
        "flex items-start gap-3 bg-card p-4 transition-colors",
        dragging && "bg-muted",
      )}
    >
      <button
        type="button"
        aria-label={`Reorder this tip. Currently ${index + 1} of ${total}. Use the up and down arrow keys to move it.`}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault()
            onMoveByKey(-1)
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            onMoveByKey(1)
          }
        }}
        className={cn(
          "mt-0.5 flex size-6 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <GripVerticalIcon className="size-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm">{tip.tip}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium">
            {TIP_CATEGORY_LABELS[tip.category]}
          </span>
          <span>{tip.section}</span>
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

export function TipChecklist({ tips: initialTips }: { tips: SavedTip[] }) {
  const [tips, setTips] = useState(initialTips)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // The list as it stood when the drag began, so one failed write puts back the
  // order the creator started from rather than an intermediate frame of the
  // drag.
  const orderBeforeDrag = useRef<SavedTip[] | null>(null)

  function saveOrder(next: SavedTip[], previous: SavedTip[]) {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch("/api/tips/checklist", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: next.map((tip) => tip.id) }),
        })
        if (!response.ok) {
          const result = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(result.error ?? "Could not save the new order.")
        }
      } catch (orderError) {
        setTips(previous)
        setError(
          orderError instanceof Error
            ? orderError.message
            : "Could not save the new order.",
        )
      }
    })
  }

  function startDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    tip: SavedTip,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    // Stops a touch drag from scrolling the page and a mouse drag from
    // selecting the tip text under the cursor.
    event.preventDefault()
    orderBeforeDrag.current = tips
    setDraggingId(tip.id)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  // The pointer is captured by the handle, so the row being dragged over is
  // found by hit testing rather than by an event on that row.
  //
  // The dragged tip only takes the other one's place once it is past that row's
  // halfway line. Tips are several lines long and no two are the same height, so
  // swapping the moment the rows overlap would put the cursor back over the tip
  // it just displaced and swap it straight back, over and over.
  function dragOver(event: React.PointerEvent<HTMLButtonElement>) {
    if (draggingId === null) return
    const over = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-tip-id]")
    const overId = over?.dataset.tipId
    if (!over || !overId || overId === draggingId) return

    const from = tips.findIndex((tip) => tip.id === draggingId)
    const to = tips.findIndex((tip) => tip.id === overId)
    if (from === -1 || to === -1) return

    const bounds = over.getBoundingClientRect()
    const middle = bounds.top + bounds.height / 2
    if (to > from ? event.clientY < middle : event.clientY > middle) return

    setTips(move(tips, from, to))
  }

  function endDrag() {
    if (draggingId === null) return
    const previous = orderBeforeDrag.current
    orderBeforeDrag.current = null
    setDraggingId(null)
    if (previous && !sameOrder(previous, tips)) {
      saveOrder(tips, previous)
    }
  }

  function moveByKey(tip: SavedTip, direction: -1 | 1) {
    const from = tips.findIndex((candidate) => candidate.id === tip.id)
    const to = from + direction
    if (from === -1 || to < 0 || to >= tips.length) return
    const previous = tips
    const next = move(tips, from, to)
    setTips(next)
    saveOrder(next, previous)
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
          Every report ends its sections on a blue &quot;Try:&quot; tip. Click
          one and add it to your checklist, and it will be waiting here the next
          time you plan a video.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <ul
        className={cn(
          "divide-y overflow-hidden rounded-xl border bg-card",
          draggingId !== null && "select-none",
        )}
      >
        {tips.map((tip, index) => (
          <TipRow
            key={tip.id}
            tip={tip}
            index={index}
            total={tips.length}
            dragging={draggingId === tip.id}
            busy={pendingId === tip.id}
            onDragStart={(event) => startDrag(event, tip)}
            onDragMove={dragOver}
            onDragEnd={endDrag}
            onMoveByKey={(direction) => moveByKey(tip, direction)}
            onRemove={() => remove(tip)}
          />
        ))}
      </ul>
    </div>
  )
}
