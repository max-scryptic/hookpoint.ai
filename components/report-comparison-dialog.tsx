"use client"

import Link from "next/link"
import { CheckIcon, XIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

// The "Learn more" popup attached to the report's upgrade prompt: a plain
// side-by-side of what a basic report holds and what a complete one adds.
//
// The split it describes is the one the product actually makes. A basic report
// is read from the retention curve and the script alone, because that is all
// YouTube hands us. A complete report is what becomes possible once the raw
// source file is uploaded: the footage itself gets watched, so the report can
// say what was on screen when people left rather than only what was said.
//
// Rows here must stay honest about that split. Anything derived from the
// transcript or the analytics belongs in both columns; only work that needs the
// uploaded file belongs to Complete alone.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

interface ComparisonRow {
  label: string
  basic: boolean
  complete: boolean
}

// Ordered so the shared ground comes first and the rows that actually differ
// land together underneath it, which is the part a reader is here for.
const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "Retention curve and key moments", basic: true, complete: true },
  { label: "Script analysis", basic: true, complete: true },
  { label: "Pacing analysis", basic: true, complete: true },
  { label: "Title and thumbnail check", basic: true, complete: true },
  { label: "Video analysis, frame by frame", basic: false, complete: true },
  { label: "Audio analysis", basic: false, complete: true },
  { label: "Cuts and scene changes", basic: false, complete: true },
  { label: "Play key moments back in the report", basic: false, complete: true },
]

function Included({ included }: { included: boolean }) {
  return (
    <>
      {included ? (
        <CheckIcon className="mx-auto size-4 text-emerald-600 dark:text-emerald-500" />
      ) : (
        <XIcon className="mx-auto size-4 text-muted-foreground/60" />
      )}
      <span className="sr-only">{included ? "Included" : "Not included"}</span>
    </>
  )
}

export function ReportComparisonDialog() {
  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer font-medium text-foreground underline underline-offset-4 hover:no-underline">
        Learn more
      </DialogTrigger>

      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        {/* Title only. The table below says the same thing the summary line
            used to, row by row, so a sentence above it just repeats itself. */}
        <DialogTitle>Basic and complete reports</DialogTitle>

        {/* The vertical margins are on top of the dialog's own gap: the table
            reads as cramped without a little more air above the column headers
            and below the last row. */}
        <table className="my-3 w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                What you get
              </th>
              <th
                scope="col"
                className="w-20 border-b px-2 pb-2 text-center align-bottom font-medium sm:w-28"
              >
                Basic
                <span className="block text-xs font-normal text-muted-foreground">
                  Free
                </span>
              </th>
              <th
                scope="col"
                className="w-20 border-b px-2 pb-2 text-center align-bottom font-medium sm:w-28"
              >
                Complete
                <span className="block text-xs font-normal text-muted-foreground">
                  Starter and Pro
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label}>
                <th
                  scope="row"
                  className="border-b py-2.5 pr-3 text-left font-normal"
                >
                  {row.label}
                </th>
                <td className="border-b px-2 py-2.5 text-center">
                  <Included included={row.basic} />
                </td>
                <td className="border-b px-2 py-2.5 text-center">
                  <Included included={row.complete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* The close: one line and a button. The table above has already made
            the case, so this only has to name the next step. No inset panel
            here, so the copy starts on the same left edge as the title and the
            table rows. */}
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Upgrade to Starter or Pro to unlock complete reports, and much more,
            now.
          </p>
          <Link href="/pricing" className={cn(buttonVariants({ size: "sm" }))}>
            Upgrade to Starter or Pro
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}
