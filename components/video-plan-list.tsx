"use client"

import { useRouter } from "next/navigation"
import { ClapperboardIcon, ImageIcon } from "lucide-react"

import { NewVideoPlanButton } from "@/components/new-video-plan-button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { VideoPlanStatus } from "@/lib/video-plans/video-plans"

// One row of the planner's list. Deliberately smaller than a serialised plan:
// the list never shows a packaging read or a transcript, and a plan carries
// enough of both to make listing fifty of them expensive.
export interface VideoPlanListItem {
  id: string
  titles: string[]
  // The images the creator intends to publish with. One today, because a plan
  // holds one thumbnail; an array so a plan that later holds several needs
  // nothing here to change.
  thumbnailUrls: string[]
  status: VideoPlanStatus
  createdAt: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

// Every plan the creator has, newest first, with the button that starts another
// above it. A plan is a row from the moment it is created, so this is where an
// unfinished draft is picked back up as much as it is where a finished read is
// re-opened; clicking a row opens the plan either way.
export function VideoPlanList({
  plans,
  canCreate,
}: {
  plans: VideoPlanListItem[]
  canCreate: boolean
}) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Planned videos
        </h2>
        {canCreate && <NewVideoPlanButton />}
      </div>

      {plans.length === 0 ? (
        // The same dashed placeholder the rest of the app shows for an empty
        // list, so a planner with nothing in it looks like a place waiting to be
        // filled rather than a heading over nothing.
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <ClapperboardIcon className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No planned videos yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Start a plan for the cut you are about to publish. You add the
            footage, the titles you are weighing up and the thumbnail on the
            plan&apos;s own page, and can come back to finish it later.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="text-left">
            <TableHeader>
              <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
                <TableHead className="px-4 py-3 text-accent-foreground">
                  Thumbnail
                </TableHead>
                <TableHead className="px-4 py-3 text-accent-foreground">
                  Title
                </TableHead>
                <TableHead className="px-4 py-3 text-accent-foreground">
                  Status
                </TableHead>
                <TableHead className="hidden px-4 py-3 text-right text-accent-foreground sm:table-cell">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => {
                const href = `/video-planner/${plan.id}`
                const name = plan.titles[0] ?? "Untitled plan"
                return (
                  <TableRow
                    key={plan.id}
                    className="cursor-pointer align-top hover:bg-muted/40"
                    onClick={() => router.push(href)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        router.push(href)
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open the plan for ${name}`}
                  >
                    <TableCell className="px-4 py-3">
                      <ThumbnailCell urls={plan.thumbnailUrls} />
                    </TableCell>
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <TitlesCell titles={plan.titles} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <PlanStatusBadge status={plan.status} />
                    </TableCell>
                    <TableCell className="hidden px-4 py-3 text-right text-sm text-muted-foreground sm:table-cell">
                      {formatDate(plan.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function ThumbnailCell({ urls }: { urls: string[] }) {
  if (urls.length === 0) {
    return (
      <div className="flex aspect-video w-24 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground sm:w-28">
        <ImageIcon className="size-4" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {urls.map((url) => (
        // Signed per request by the thumbnail route, so there is no stable URL
        // for next/image to optimise and no domain to configure for it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt=""
          className="aspect-video w-24 shrink-0 rounded-md border bg-muted object-cover sm:w-28"
        />
      ))}
    </div>
  )
}

// The title the creator led with names the plan, with the alternatives they are
// weighing beneath it. A plan with no titles at all is one still being filled
// in, so it says so rather than rendering a blank cell.
function TitlesCell({ titles }: { titles: string[] }) {
  if (titles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">No titles yet</p>
    )
  }

  return (
    <div className="min-w-0">
      <p className="line-clamp-2 text-sm font-medium">{titles[0]}</p>
      {titles.slice(1).map((title, index) => (
        <p
          key={index}
          className="line-clamp-1 text-sm text-muted-foreground"
        >
          {title}
        </p>
      ))}
    </div>
  )
}

function PlanStatusBadge({ status }: { status: VideoPlanStatus }) {
  const { label, className } = planBadge(status)
  return (
    <span
      className={`inline-block shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  )
}

function planBadge(status: VideoPlanStatus): {
  label: string
  className: string
} {
  switch (status) {
    case "ready":
      return {
        label: "Ready",
        className:
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      }
    case "failed":
      return {
        label: "Needs a retry",
        className:
          "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      }
    case "processing":
      return { label: "Reading…", className: "text-muted-foreground" }
    default:
      return { label: "Draft", className: "text-muted-foreground" }
  }
}
