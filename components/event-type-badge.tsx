import type { RetentionWindowEventType } from "@/lib/retention-window-events"

// One colour per synthesized event type, shared by every surface that shows
// them (the deep-analysis evidence panel, the Channel Trends page) so an
// event type always reads the same across the product.
const EVENT_TYPE_STYLES: Record<RetentionWindowEventType, string> = {
  scene_cut: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  topic_shift: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  visual_change: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  audio_change: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  pacing_change: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  on_screen_text_change: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  other: "bg-muted text-muted-foreground",
}

export function formatEventTypeLabel(eventType: string): string {
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function EventTypeBadge({
  eventType,
}: {
  eventType: RetentionWindowEventType
}) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${EVENT_TYPE_STYLES[eventType]}`}
    >
      {formatEventTypeLabel(eventType)}
    </span>
  )
}
