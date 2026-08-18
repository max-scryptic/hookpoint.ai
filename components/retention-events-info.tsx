"use client"

import { InfoIcon } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// What each retention tab actually contains, in the same order the tabs are
// shown. Kept as data so the popover stays a list a reader can scan rather than
// a paragraph, and so a new window kind is one entry rather than new markup.
//
// The wording tracks the detectors: the fixed hook windows
// (RETENTION_WINDOWS in lib/youtube/youtube.ts), detectSignificantDropOffs
// (steeper than the curve's own median step, or underperforming similar
// videos, capped at SIGNIFICANT_DROP_OFF_LIMIT), detectRetentionGains
// (episodes rising 3% or more), detectRetentionHolds (near-flat stretches of
// at least 10s, after the hook, not overlapping a drop or gain) and the
// pacing pass, which reads the transcript alone.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013) in this file.
const EVENT_DEFINITIONS: { label: string; description: string }[] = [
  {
    label: "Hook",
    description:
      "The first 10 seconds, then 10 to 30 seconds. Always analysed, on every video.",
  },
  {
    label: "Drop-offs",
    description:
      "Up to 4 mid-video losses that fall far steeper than your curve's normal decline, or where you trail similar videos.",
  },
  {
    label: "Gains",
    description:
      "Stretches where retention rises by 3% or more, so viewers rewatching or coming back.",
  },
  {
    label: "Holds",
    description:
      "Flat stretches after the hook where retention barely moves for 10 seconds or longer.",
  },
  {
    label: "Pacing",
    description: "Slow or repetitive stretches read from your script.",
  },
]

// The info affordance next to the retention tabs. Answers the two questions a
// reader has when a window sits there with no advice on it: how the moment was
// picked, and why some windows carry a tip and others do not.
export function RetentionEventsInfo() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            aria-label="How retention windows are picked"
          />
        }
      >
        <InfoIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 flex-col gap-3 text-xs leading-relaxed"
      >
        <div className="flex flex-col gap-2">
          <p className="font-medium text-foreground">How windows are picked</p>
          <ul className="flex flex-col gap-1.5 text-muted-foreground">
            {EVENT_DEFINITIONS.map(({ label, description }) => (
              <li key={label}>
                <span className="font-medium text-foreground">{label}:</span>{" "}
                {description}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="font-medium text-foreground">When you get a tip</p>
          <p className="text-muted-foreground">
            Light analysis reads the transcript alone, so a window only earns a
            tip when the words themselves explain the moment. Deep analysis —
            when a raw source file is uploaded and analysed — also reads the
            frames, audio, cuts and pacing, so it can explain moments the script
            cannot and leaves fewer windows silent.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
