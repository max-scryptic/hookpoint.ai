"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { format } from "date-fns"
import {
  ArrowUpRightIcon,
  GripVerticalIcon,
  ListChecksIcon,
  ListFilterIcon,
  MoreVerticalIcon,
  Trash2Icon,
} from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  TIP_CATEGORY_LABELS,
  tipCategoryCounts,
  type SavedTip,
  type TipCategory,
} from "@/lib/tips"
import { cn } from "@/lib/utils"

// The creator's kept tips: a reference list to keep beside them while planning
// the next video, in the order they mean to work through it. Nothing is ticked
// off here. A tip is either worth keeping, in which case it stays and can be
// dragged to where it belongs, or it is not, in which case it goes.
//
// A table rather than a list of cards, and the video is why. Most of this
// advice was written about one specific video ("hint at why the papaya quest is
// exciting"), and read on its own weeks later a tip like that is unattributable:
// the creator has to open the report to find out which video they were being
// told about. So the video the tip came from is a column, and the columns beside
// it are the other three things worth scanning down: what the tip is about, when
// it was kept, and the way back to where it came from.
//
// One flat table, not grouped by what each tip is about: the order is the
// creator's own priority order, and grouping would cut it into runs that cannot
// be compared. The category column still says which group each line belongs to,
// so the grouping is readable off the table without being imposed on it.
//
// The filter above it is how a creator working on one thing gets to just that:
// it narrows what is shown without touching the order underneath, so putting it
// back on All puts the whole list back exactly as they left it.
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

// The videos a tip was written about, as one line. A comparison report is about
// a pair, and both of them are named: which of the two a head-to-head tip is
// aimed at is half of what it says.
function videoLabel(tip: SavedTip): string | null {
  return tip.videoTitles.length > 0 ? tip.videoTitles.join(" vs ") : null
}

// The filter above the table. Every choice is a category the creator has
// actually kept something under, so opening it doubles as a read on what their
// checklist is made of before they narrow it to anything.
//
// The same single-select dropdown the video and comparison lists filter with,
// so a filter looks and behaves the same wherever the creator meets one.
function CategoryFilter({
  counts,
  active,
  onChange,
}: {
  counts: { category: TipCategory; count: number }[]
  active: TipCategory | "all"
  onChange: (category: TipCategory | "all") => void
}) {
  const choices: { value: TipCategory | "all"; label: string }[] = [
    { value: "all", label: "All categories" },
    ...counts.map(({ category }) => ({
      value: category,
      label: TIP_CATEGORY_LABELS[category],
    })),
  ]

  const activeLabel =
    choices.find((choice) => choice.value === active)?.label ?? "All categories"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="h-9 gap-2" />}
          aria-label={`Filter the checklist by category. Showing ${activeLabel}.`}
        >
          <ListFilterIcon className="size-4" />
          {activeLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-auto min-w-(--anchor-width)"
        >
          <DropdownMenuRadioGroup
            value={active}
            onValueChange={(value) => onChange(value as TipCategory | "all")}
          >
            {choices.map((choice) => (
              <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                {choice.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Tinted the same colour as the Title / Thumbnail / Hook badges on a video's
// packaging cards, so a category reads as a label at a glance rather than as
// another grey line of metadata.
function CategoryBadge({ category }: { category: TipCategory }) {
  return (
    <span className="inline-block rounded-md border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-purple-700 dark:border-blue-400/40 dark:bg-blue-400/10 dark:text-blue-300">
      {TIP_CATEGORY_LABELS[category]}
    </span>
  )
}

// Everything that can be done to one tip, behind the row's own menu: opening
// the report it came from, and taking it off the checklist. Both were buttons
// on the row before; at four columns wide they would be competing with the
// content for the same space, and neither is pressed often enough to earn it.
function TipActions({
  tip,
  busy,
  onRemove,
}: {
  tip: SavedTip
  busy: boolean
  onRemove: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Actions for this tip"
          />
        }
      >
        <MoreVerticalIcon className="size-4" />
      </DropdownMenuTrigger>
      {/* Width sizes to content rather than to the icon trigger, so the labels
          stay on one line. */}
      <DropdownMenuContent align="end" className="w-auto">
        {/* A tip saved without a readable path, or one whose report has since
            been deleted, has nowhere to go back to, so the item is left out
            rather than offered dead. */}
        {tip.sourcePath && (
          <DropdownMenuItem render={<Link href={tip.sourcePath} />}>
            <ArrowUpRightIcon className="size-4" />
            Open the report
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2Icon className="size-4" />
          Remove from checklist
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TipRow({
  tip,
  index,
  total,
  dragging,
  onDragStart,
  onMoveByKey,
  onRemove,
  busy,
}: {
  tip: SavedTip
  index: number
  total: number
  dragging: boolean
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void
  onMoveByKey: (direction: -1 | 1) => void
  onRemove: () => void
  busy: boolean
}) {
  const video = videoLabel(tip)
  const saved = format(new Date(tip.createdAt), "d MMM yyyy")

  return (
    <TableRow
      data-tip-id={tip.id}
      className={cn("align-top", dragging && "bg-muted hover:bg-muted")}
    >
      {/* Every cell aligns to the top of the row explicitly: the base cell
          centres its content, which on a row as tall as a three line tip would
          leave the video, the category and the date floating in the middle of
          it, well below the first line of the advice they belong to. */}
      <TableCell className="py-3 pr-0 pl-2 align-top">
        <button
          type="button"
          aria-label={`Reorder this tip. Currently ${index + 1} of ${total}. Use the up and down arrow keys to move it.`}
          onPointerDown={onDragStart}
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
            "flex size-6 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground",
            "hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </TableCell>

      <TableCell className="px-4 py-3 align-top whitespace-normal">
        <p className="text-sm leading-relaxed">{tip.tip}</p>
        {/* Compact metadata shown only when the columns holding it are hidden.
            Each piece appears at exactly the width its own column disappears
            at, so nothing is ever said twice on the same screen. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground lg:hidden">
          {video && <span className="md:hidden">{video}</span>}
          <span className="sm:hidden">
            <CategoryBadge category={tip.category} />
          </span>
          <span>Saved {saved}</span>
        </div>
      </TableCell>

      <TableCell className="hidden max-w-3xs px-4 py-3 align-top text-sm whitespace-normal text-muted-foreground md:table-cell">
        {video ?? (
          // The report is what named the video, so a tip that no longer has one
          // says why rather than leaving the cell blank and unexplained.
          <span className="text-muted-foreground/70">No video recorded</span>
        )}
      </TableCell>

      <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
        <CategoryBadge category={tip.category} />
      </TableCell>

      <TableCell className="hidden px-4 py-3 align-top text-sm text-muted-foreground lg:table-cell">
        {saved}
      </TableCell>

      <TableCell className="px-2 py-3 text-right align-top">
        <TipActions tip={tip} busy={busy} onRemove={onRemove} />
      </TableCell>
    </TableRow>
  )
}

export function TipChecklist({ tips: initialTips }: { tips: SavedTip[] }) {
  const [tips, setTips] = useState(initialTips)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [category, setCategory] = useState<TipCategory | "all">("all")
  const [, startTransition] = useTransition()

  const counts = tipCategoryCounts(tips)
  // Removing the last tip of the category being shown would otherwise leave the
  // creator looking at an empty table filtered to something they no longer have
  // anything under, so the filter falls back to the whole list instead.
  const active = counts.some((count) => count.category === category)
    ? category
    : "all"
  const visible =
    active === "all" ? tips : tips.filter((tip) => tip.category === active)

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

  // The row being dragged over is found by hit testing the pointer rather than
  // by an event on that row. Under a filter that only ever finds a row the
  // filter kept, and the tip is moved to where that row sits in the whole list,
  // so a drag the creator can see is applied to the order they cannot.
  //
  // The dragged tip only takes the other one's place once it is past that row's
  // halfway line. Tips are several lines long and no two rows are the same
  // height, so swapping the moment the rows overlap would put the cursor back
  // over the tip it just displaced and swap it straight back, over and over.
  function dragOver(event: PointerEvent) {
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

  // The rest of the drag is followed on the window rather than on the handle.
  // The handle captures the pointer when the drag starts, but the first reorder
  // moves that handle's row in the DOM and the browser drops the capture along
  // with it, so the release would land somewhere else entirely: the drag would
  // never be told it had ended, and the row that was moved would sit
  // highlighted long after the pointer was let go.
  //
  // No dependency list, so every render re-binds handlers that close over the
  // order as it stands now.
  useEffect(() => {
    if (draggingId === null) return
    const onMove = (event: PointerEvent) => dragOver(event)
    const onEnd = () => endDrag()
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onEnd)
    window.addEventListener("pointercancel", onEnd)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onEnd)
      window.removeEventListener("pointercancel", onEnd)
    }
  })

  // The arrow keys step past the neighbour the creator can see, which under a
  // filter is not the neighbour in the whole list. The tip takes that visible
  // neighbour's place in the full order, matching what a drag onto it would do.
  function moveByKey(tip: SavedTip, direction: -1 | 1) {
    const shown = visible.findIndex((candidate) => candidate.id === tip.id)
    const neighbour = visible[shown + direction]
    if (shown === -1 || !neighbour) return

    const from = tips.findIndex((candidate) => candidate.id === tip.id)
    const to = tips.findIndex((candidate) => candidate.id === neighbour.id)
    if (from === -1 || to === -1) return

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
      {/* Nothing to narrow when every tip is about the same thing, so the
          filter only appears once there is a choice to make. */}
      {counts.length > 1 && (
        <CategoryFilter counts={counts} active={active} onChange={setCategory} />
      )}
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card",
          draggingId !== null && "select-none",
        )}
      >
        <Table className="text-left">
          <TableHeader>
            <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
              <TableHead className="w-10 py-3 pr-0 pl-2">
                <span className="sr-only">Order</span>
              </TableHead>
              <TableHead className="px-4 py-3 text-accent-foreground">
                Tip
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground md:table-cell">
                Video
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground sm:table-cell">
                Category
              </TableHead>
              <TableHead className="hidden px-4 py-3 text-accent-foreground lg:table-cell">
                Date added
              </TableHead>
              <TableHead className="w-12 px-2 py-3">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((tip, index) => (
              <TipRow
                key={tip.id}
                tip={tip}
                index={index}
                total={visible.length}
                dragging={draggingId === tip.id}
                busy={pendingId === tip.id}
                onDragStart={(event) => startDrag(event, tip)}
                onMoveByKey={(direction) => moveByKey(tip, direction)}
                onRemove={() => remove(tip)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
