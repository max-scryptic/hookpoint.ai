import { CircleCheckIcon, FileTextIcon, Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

// Which of the two reports a video carries, plus the state in between: a source
// file has landed but the footage-based half of the analysis is still running,
// so the report is on its way to Complete without being there yet.
export type ReportType = "basic" | "complete" | "processing"

// What separates the two report types, and - for anyone who cannot upload a
// source file yet - how to get the complete one. Shown from the info affordance
// beside the analysed videos table's Report Type header, and from the badge at
// the head of a report.
export const REPORT_TYPE_EXPLAINER =
  "Basic reports read your retention curve and transcript. Complete reports also read your uploaded source file frame by frame, so every key moment is judged on what viewers actually saw."

export const REPORT_TYPE_UPGRADE_HINT =
  "Upgrade to Starter or Pro to upload your source files and unlock complete reports."

// One pill per state, so a report type reads the same wherever it appears: the
// analysed videos table, the source-file card, and the head of the report
// itself. Complete earns the green; Basic stays neutral so the pair reads as a
// ladder rather than two equal options; Processing borrows the amber the rest
// of the pipeline's in-flight states use.
const REPORT_TYPE_META: Record<
  ReportType,
  {
    label: string
    icon: typeof CircleCheckIcon
    tone: string
    title?: string
  }
> = {
  basic: {
    label: "Basic",
    icon: FileTextIcon,
    tone: "border-border bg-muted text-foreground/80",
  },
  complete: {
    label: "Complete",
    icon: CircleCheckIcon,
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  processing: {
    label: "Processing…",
    icon: Loader2Icon,
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
    title:
      "Deeper analysis is still running. This updates automatically when it finishes.",
  },
}

export function ReportTypeBadge({
  type,
  className,
}: {
  type: ReportType
  className?: string
}) {
  const { label, icon: Icon, tone, title } = REPORT_TYPE_META[type]
  return (
    <span
      title={title}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          type === "processing" && "animate-spin",
        )}
      />
      {label}
    </span>
  )
}

// The report type a video carries, from the two facts every caller has: whether
// a source file has finished uploading, and whether its deeper analysis is
// still running. Kept here so the table, the report and anything else that
// shows the badge cannot drift apart on what counts as Complete.
export function reportTypeFor({
  hasSourceFile,
  processing,
}: {
  hasSourceFile: boolean
  processing: boolean
}): ReportType {
  if (!hasSourceFile) return "basic"
  return processing ? "processing" : "complete"
}
