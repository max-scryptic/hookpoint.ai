import { cn } from "@/lib/utils"

// The imagery for the landing page. Every visual here is hand-drawn SVG and
// markup rather than a screenshot, for three reasons: it stays sharp at any
// size, it reads correctly in both themes because it is painted from the same
// brand tokens as the product, and it never goes stale when a screen in the app
// is redesigned. Each one is a stylised version of a real surface, so a visitor
// arrives at the app recognising what they were shown.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

// The shape of a typical YouTube retention curve: a steep hook drop, a long
// gentle decline, a cliff in the middle, a flat hold, then a small rise where
// viewers rewatch. Drawn once here and reused wherever a curve is needed, so
// the same video is being talked about across the whole page.
const CURVE =
  "M0,10 C8,22 12,30 20,36 C30,44 34,46 44,49 C60,53 62,54 78,57 C100,60 108,63 126,65 C140,67 148,72 160,88 C166,96 170,99 178,101 C190,103 196,104 210,105 C228,106 232,106 250,107 C264,107 268,108 280,108 C288,108 292,104 300,100 C310,96 316,99 326,104 C340,111 348,115 362,119 C378,123 390,125 400,127"

const CURVE_AREA = `${CURVE} L400,150 L0,150 Z`

// A second, weaker curve for the head-to-head: same channel, worse opening.
const CURVE_B =
  "M0,10 C6,30 10,44 20,54 C32,66 38,68 50,71 C68,75 72,76 90,79 C112,83 120,85 138,88 C156,91 164,93 182,96 C200,99 208,100 226,102 C244,104 252,105 270,107 C288,109 296,110 314,113 C332,116 340,118 358,121 C376,124 390,126 400,128"

function ChartFrame({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 400 150"
      className={cn("h-full w-full", className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// The gridlines every chart sits on, kept faint so the curve stays the subject.
function Gridlines() {
  return (
    <g stroke="currentColor" className="text-border" strokeWidth="1">
      {[30, 60, 90, 120].map((y) => (
        <line key={y} x1="0" y1={y} x2="400" y2={y} strokeDasharray="3 5" />
      ))}
    </g>
  )
}

/**
 * The hero image: a stylised video report. The retention curve with its hook
 * window shaded, a drop-off and a gain called out on the curve itself, the
 * event badges underneath, and one written tip. It is the whole product promise
 * in a single frame, which is why it carries more detail than the others.
 */
export function ReportVisual({ className }: { className?: string }) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10 ring-1 ring-black/5 dark:shadow-black/40",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-3">
        <span className="size-2.5 rounded-full bg-destructive/40" />
        <span className="size-2.5 rounded-full bg-amber-400/50" />
        <span className="size-2.5 rounded-full bg-emerald-400/50" />
        <span className="ml-2 truncate text-xs font-medium text-muted-foreground">
          Report: How I edit 40 hour weeks into 8 minutes
        </span>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Audience retention
            </p>
            <p className="font-heading text-2xl font-semibold tracking-tight">
              38.4%{" "}
              <span className="text-sm font-normal text-muted-foreground">
                average view duration
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <StatChip label="Hook" value="71%" tone="warn" />
            <StatChip label="Drop-offs" value="3" tone="bad" />
            <StatChip label="Gains" value="1" tone="good" />
          </div>
        </div>

        <div className="relative h-40 sm:h-48">
          <ChartFrame>
            <defs>
              <linearGradient id="hp-curve-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-primary)"
                  stopOpacity="0.35"
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-primary)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>

            <Gridlines />

            {/* The fixed hook window: the first 10 seconds, always analysed. */}
            <rect
              x="0"
              y="0"
              width="26"
              height="150"
              fill="var(--color-primary)"
              opacity="0.09"
            />

            <path d={CURVE_AREA} fill="url(#hp-curve-fill)" />
            <path
              d={CURVE}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* The drop-off and the gain, marked on the curve itself. */}
            <line
              x1="160"
              y1="88"
              x2="160"
              y2="150"
              stroke="var(--color-destructive)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity="0.7"
            />
            {/* The gain is drawn in the same green the Gains tile uses, so the
                two are read as the same fact. */}
            <line
              x1="300"
              y1="100"
              x2="300"
              y2="150"
              className="text-emerald-500"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity="0.7"
            />
          </ChartFrame>

          {/* Markers ride above the stretched SVG so they stay circular. */}
          <Marker className="left-[40%] top-[59%]" tone="bad" />
          <Marker className="left-[75%] top-[67%]" tone="good" />

          {/* Sits above the curve and clear of the gain marker further right,
              so nothing the chart is pointing at ends up underneath it. */}
          <div className="absolute top-[4%] left-[41%] hidden max-w-[44%] rounded-lg border bg-popover/95 p-2.5 text-left shadow-lg backdrop-blur sm:block">
            <p className="text-[10px] font-semibold tracking-wide text-destructive uppercase">
              Drop-off at 2:41
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Retention falls 14% over 9 seconds, right as the b-roll cuts back
              to a static talking head.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400">
            Scene cut
          </Badge>
          <Badge className="bg-violet-500/10 text-violet-700 dark:text-violet-400">
            Topic shift
          </Badge>
          <Badge className="bg-orange-500/10 text-orange-700 dark:text-orange-400">
            Pacing change
          </Badge>
          <Badge className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">
            On screen text
          </Badge>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <p className="text-[11px] font-semibold tracking-wide text-primary uppercase">
            Fix for next time
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/80">
            Cut the 9 second recap at 2:41 and move the result you tease in the
            title to before the first sponsor beat.
          </p>
        </div>
      </div>
    </figure>
  )
}

function Marker({ className, tone }: { className?: string; tone: Tone }) {
  return (
    <span
      className={cn(
        "absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4",
        tone === "bad"
          ? "bg-destructive ring-destructive/20"
          : "bg-emerald-500 ring-emerald-500/20",
        className
      )}
    />
  )
}

type Tone = "good" | "bad" | "warn"

function StatChip({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: Tone
}) {
  return (
    <div className="rounded-lg border bg-muted/40 px-2.5 py-1.5 text-center">
      <p className="text-[10px] leading-none text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm leading-none font-semibold",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Badge({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * The report feature image: the retention events found in one video, listed the
 * way the report lists them, so the reader can see that a report is a walk
 * through named moments rather than another dashboard.
 */
export function EventsVisual({ className }: { className?: string }) {
  const events = [
    {
      time: "0:00 - 0:10",
      kind: "Hook",
      tone: "bg-primary/10 text-primary",
      note: "71% still watching at 10s, 6 points under your channel median.",
      tip: true,
    },
    {
      time: "2:41",
      kind: "Drop-off",
      tone: "bg-destructive/10 text-destructive",
      note: "Loses 14% in 9 seconds. Static frame, recap, music out.",
      tip: true,
    },
    {
      time: "4:02 - 4:35",
      kind: "Hold",
      tone: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
      note: "Retention barely moves. The demo carries the middle of the video.",
      tip: false,
    },
    {
      time: "6:12",
      kind: "Gain",
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      note: "Rises 4%. Viewers scrubbing back to the result you teased.",
      tip: false,
    },
  ]

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:p-5",
        className
      )}
    >
      <div className="flex flex-wrap gap-1.5 border-b pb-3">
        {["Hook", "Drop-offs", "Gains", "Holds", "Pacing"].map((tab, index) => (
          <span
            key={tab}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium",
              index === 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.time} className="rounded-xl border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  event.tone
                )}
              >
                {event.kind}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {event.time}
              </span>
              {event.tip && (
                <span className="ml-auto rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                  Fix suggested
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-foreground/75">
              {event.note}
            </p>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/**
 * The deep-analysis feature image: a strip of frames around one losing moment,
 * with the signals read off each of them. This is the half of the product that
 * looks at the video and not just the curve.
 */
export function EvidenceVisual({ className }: { className?: string }) {
  // Each frame gets its own subject size and position so the strip reads as
  // four different shots rather than the same still four times.
  const frames = [
    {
      time: "2:38",
      label: "Wide shot",
      tone: "text-blue-600 dark:text-blue-400",
      subject: "bottom-2 left-1/2 size-4 -translate-x-1/2",
    },
    {
      time: "2:41",
      label: "Cut to desk",
      tone: "text-violet-600 dark:text-violet-400",
      subject: "bottom-1.5 left-[38%] size-7 -translate-x-1/2",
    },
    {
      time: "2:44",
      label: "Recap begins",
      tone: "text-orange-600 dark:text-orange-400",
      subject: "bottom-1.5 left-1/2 size-7 -translate-x-1/2",
    },
    {
      time: "2:47",
      label: "Music drops out",
      tone: "text-pink-600 dark:text-pink-400",
      subject: "bottom-1.5 left-[58%] size-6 -translate-x-1/2",
    },
  ]

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:p-5",
        className
      )}
    >
      <div className="grid grid-cols-4 gap-2">
        {frames.map((frame, index) => (
          <div key={frame.time} className="space-y-1.5">
            <div
              className={cn(
                "relative aspect-video overflow-hidden rounded-lg border bg-gradient-to-br",
                index === 1
                  ? "from-primary/30 to-accent ring-2 ring-primary"
                  : "from-muted to-secondary"
              )}
            >
              {/* A suggestion of a frame: a horizon line and a subject. */}
              <span className="absolute inset-x-0 bottom-1/4 h-px bg-foreground/10" />
              <span
                className={cn(
                  "absolute rounded-full bg-foreground/15",
                  frame.subject
                )}
              />
              <span className="absolute top-1.5 left-1.5 rounded bg-background/70 px-1 text-[8px] font-medium text-muted-foreground">
                {frame.time}
              </span>
            </div>
            <p
              className={cn(
                "truncate text-[10px] font-medium sm:text-[11px]",
                frame.tone
              )}
            >
              {frame.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 rounded-xl border bg-muted/40 p-3">
        <EvidenceRow
          label="Transcript"
          value={"“So, quick recap of what we just did...”"}
        />
        <EvidenceRow label="Visuals" value="Static frame held for 9s, no cuts" />
        <EvidenceRow label="Audio" value="Bed music ends, room tone only" />
      </div>
    </figure>
  )
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-[11px] leading-snug">
      <span className="w-16 shrink-0 font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/75">{value}</span>
    </div>
  )
}

/**
 * The comparator feature image: two retention curves on one chart, plus the
 * packaging read that explains the gap between them.
 */
export function ComparisonVisual({ className }: { className?: string }) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:p-5",
        className
      )}
    >
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="size-2.5 rounded-full bg-primary" />
          Video A
        </span>
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <span className="size-2.5 rounded-full bg-chart-3" />
          Video B
        </span>
        <span className="ml-auto rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          A holds 12% longer
        </span>
      </div>

      <div className="mt-3 h-32 sm:h-36">
        <ChartFrame>
          <Gridlines />
          <path
            d={CURVE_B}
            fill="none"
            stroke="var(--color-chart-3)"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={CURVE}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </ChartFrame>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <CompareRow label="Hook promise" a="Explicit" b="Implied" winner="a" />
        <CompareRow label="Title match" a="Strong" b="Partial" winner="a" />
        <CompareRow label="Pace, first 30s" a="4 cuts" b="1 cut" winner="a" />
        <CompareRow label="Payoff timing" a="6:12" b="2:40" winner="b" />
      </div>
    </figure>
  )
}

function CompareRow({
  label,
  a,
  b,
  winner,
}: {
  label: string
  a: string
  b: string
  winner: "a" | "b"
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-medium">
        <span className={winner === "a" ? "text-primary" : "text-foreground/60"}>
          {a}
        </span>
        <span className="text-[9px] text-muted-foreground">vs</span>
        <span className={winner === "b" ? "text-primary" : "text-foreground/60"}>
          {b}
        </span>
      </div>
    </div>
  )
}

/**
 * The channel-trends feature image: what repeats across a library, ranked, with
 * the strength of each pattern shown as a bar.
 */
export function TrendsVisual({ className }: { className?: string }) {
  const trends = [
    { label: "Cold open, no intro", value: 86, note: "12 videos" },
    { label: "Question in first 5s", value: 72, note: "9 videos" },
    { label: "Mid-roll recap", value: 34, note: "7 videos", weak: true },
    { label: "Face on thumbnail", value: 64, note: "15 videos" },
  ]

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:p-5",
        className
      )}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Patterns across your library
        </p>
        <p className="text-[10px] text-muted-foreground">18 videos analysed</p>
      </div>

      <div className="mt-3 space-y-3">
        {trends.map((trend) => (
          <div key={trend.label}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[11px] font-medium sm:text-xs">
                {trend.label}
              </p>
              <p className="shrink-0 text-[10px] text-muted-foreground">
                {trend.note}
              </p>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  trend.weak
                    ? "bg-gradient-to-r from-destructive/50 to-destructive"
                    : "bg-gradient-to-r from-primary to-chart-3"
                )}
                style={{ width: `${trend.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] leading-relaxed text-foreground/80">
        Videos that open cold hold{" "}
        <span className="font-semibold text-primary">9% more</span> of their
        audience through the first minute than the ones with an intro.
      </p>
    </figure>
  )
}

/**
 * The checklist feature image: tips kept from reports, in the order the creator
 * wants to work through them.
 */
export function ChecklistVisual({ className }: { className?: string }) {
  const tips = [
    { text: "Open on the result, not the setup", done: true },
    { text: "Cut the 2:41 recap entirely", done: true },
    { text: "Add a visual change every 20s in act two", done: false },
    { text: "Move the sponsor read past the 4 minute mark", done: false },
  ]

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-2xl border bg-card p-4 shadow-xl shadow-primary/5 sm:p-5",
        className
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">
        Checklist for the next upload
      </p>
      <ul className="mt-3 space-y-2">
        {tips.map((tip) => (
          <li
            key={tip.text}
            className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-2.5 py-2"
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                tip.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border"
              )}
            >
              {tip.done && (
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                  <path
                    d="M2.5 6.2 4.8 8.5 9.5 3.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span
              className={cn(
                "text-[11px] leading-snug sm:text-xs",
                tip.done && "text-muted-foreground line-through"
              )}
            >
              {tip.text}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/**
 * The soft brand wash that sits behind the hero and the closing call to action.
 * Two blurred colour fields plus a faint grid, so the page has depth without
 * anything competing with the copy.
 */
export function BrandBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div className="absolute -top-40 -left-32 size-[36rem] rounded-full bg-primary/20 blur-3xl dark:bg-primary/25" />
      <div className="absolute -top-24 right-[-10rem] size-[32rem] rounded-full bg-chart-3/20 blur-3xl dark:bg-chart-3/20" />
      <div
        className="absolute inset-0 opacity-[0.4] dark:opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
        }}
      />
    </div>
  )
}
