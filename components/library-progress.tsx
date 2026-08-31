import { Card, CardContent } from "@/components/ui/card"

// The progressive-unlock meter: one line saying what the next analysis buys,
// the count against the target it is climbing toward, and the bar itself.
//
// Shared so every feature gated on library size shows the same thing in the
// same place: Channel Trends counts toward its early and established stages
// (components/channel-trends.tsx), the Video Planner counts toward the library
// it grounds a plan in (app/(app)/video-planner/page.tsx). The caller writes
// the message, because only it knows what is on the other side of the bar.
//
// Purely presentational, and carries no colour of its own beyond the primary
// fill: the message says everything the bar does, so the meter still reads with
// the bar ignored.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments included).
// Hyphens are fine.
export function LibraryProgress({
  message,
  count,
  target,
}: {
  // What the creator gets when the bar fills, phrased as the next step:
  // "Deeply analyse 4 more videos to unlock the planner."
  message: string
  // Deeply analysed videos in the library right now.
  count: number
  // The count this bar fills at.
  target: number
}) {
  const progress =
    target <= 0 ? 100 : Math.min(100, Math.max(0, (count / target) * 100))

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{message}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {count}/{target}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
