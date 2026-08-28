import { delayStyle } from "@/components/landing/landing-motion"
import { cn } from "@/lib/utils"

// The imagery for the landing page. Every visual here is hand-drawn SVG and
// markup rather than a screenshot, for three reasons: it stays sharp at any
// size, it is painted from the page's own tokens rather than pinned to a
// moment in time, and it never goes stale when a screen in the app is
// redesigned. Each one is a stylised version of a real surface, so a visitor
// arrives at the app recognising what they were shown.
//
// LOOK: these are the product screenshots of this page, so they carry the
// system's frame and nothing else. Carbon on void, a graphite hairline, 12px
// corners, no drop shadow. Data is where colour lives (violet for a retention
// curve, coral for a loss, green for a gain); the lime accent belongs to the
// one button a screen is asking to be pressed and never appears in here.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.
//
// MOTION: each figure is meant to sit inside a <Reveal> (components/landing/
// landing-reveal.tsx) and inside an element carrying `group`. The landing-draw,
// landing-rise, landing-bar, landing-fade and landing-pop classes below play
// once the reveal wrapper reports itself on screen, and the group-hover states
// answer the pointer. Both degrade to a fully drawn, still figure when either
// wrapper is missing, so a visual is never invisible or inert by accident.

// The frame every figure on this page wears: carbon on the void with a
// graphite hairline, 12px corners, 24px of padding. There is no drop shadow
// anywhere in it. A black shadow against a near-black page does nothing, so a
// surface here is defined by its edge, and the only thing hovering it changes
// is how bright that edge is.
const CARD_FRAME =
  "overflow-hidden rounded-[12px] border border-graphite bg-carbon transition-colors duration-500 ease-out group-hover:border-smoke"

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
    <g stroke="currentColor" className="text-graphite" strokeWidth="1">
      {[30, 60, 90, 120].map((y) => (
        <line key={y} x1="0" y1={y} x2="400" y2={y} strokeDasharray="3 5" />
      ))}
    </g>
  )
}

// The colour a retention curve is drawn in. Data is chromatic on this page;
// controls are not. Violet reads clearly on the void without ever being
// mistaken for the one lime thing on screen that can be pressed.
const CURVE_COLOR = "var(--color-iris-violet)"

/**
 * The hero image: a stylised video report. The retention curve with its hook
 * window shaded, a drop-off and a gain called out on the curve itself, the
 * event badges underneath, and one written tip. It is the whole product promise
 * in a single frame, which is why it carries more detail than the others.
 */
export function ReportVisual({ className }: { className?: string }) {
  return (
    <figure className={cn(CARD_FRAME, "linear-edge-soft", className)}>
      <div className="flex items-center gap-2 border-b border-graphite bg-white/[0.02] px-4 py-3">
        <span className="size-2 rounded-full bg-smoke" />
        <span className="size-2 rounded-full bg-smoke" />
        <span className="size-2 rounded-full bg-smoke" />
        <span className="ml-2 truncate font-mono text-[12px] tracking-[-0.013em] text-fog">
          RET-2703 How I edit 40 hour weeks into 8 minutes
        </span>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] leading-[1.4] text-fog">
              Audience retention
            </p>
            <p className="mt-1 text-[24px] leading-[1.2] font-w510 tracking-copy text-paper">
              38.4%{" "}
              <span className="text-[13px] font-normal text-fog">
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

        <div className="relative h-48 sm:h-64 lg:h-72">
          <ChartFrame>
            <defs>
              <linearGradient id="hp-curve-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CURVE_COLOR} stopOpacity="0.28" />
                <stop offset="100%" stopColor={CURVE_COLOR} stopOpacity="0" />
              </linearGradient>
            </defs>

            <Gridlines />

            {/* The fixed hook window: the first 10 seconds, always analysed. */}
            <rect
              x="0"
              y="0"
              width="26"
              height="150"
              fill="var(--color-paper)"
              opacity="0.04"
            />

            <path
              d={CURVE_AREA}
              fill="url(#hp-curve-fill)"
              className="landing-fade"
              style={delayStyle(700)}
            />
            {/* The curve draws itself left to right once the card arrives, so
                the reader watches the retention story rather than finding it
                already finished. */}
            <path
              d={CURVE}
              pathLength="1"
              fill="none"
              stroke={CURVE_COLOR}
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="landing-draw"
              style={delayStyle(150)}
            />

            {/* The drop-off and the gain, marked on the curve itself. They are
                dashed, so they fade in rather than draw: an animated dash
                offset would slide the dashes along the rule. Their softness
                lives in stroke-opacity, leaving the element's own opacity free
                for the fade to animate from nothing up to full. */}
            <line
              x1="160"
              y1="88"
              x2="160"
              y2="150"
              stroke="var(--color-coral-red)"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              strokeOpacity="0.7"
              className="landing-fade"
              style={delayStyle(900)}
            />
            {/* The gain is drawn in the same green the Gains tile uses, so the
                two are read as the same fact. */}
            <line
              x1="300"
              y1="100"
              x2="300"
              y2="150"
              className="landing-fade text-pulse-green"
              style={delayStyle(1050)}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              strokeOpacity="0.7"
            />
          </ChartFrame>

          {/* Markers ride above the stretched SVG so they stay circular. */}
          <Marker className="left-[40%] top-[59%]" tone="bad" delay={950} />
          <Marker className="left-[75%] top-[67%]" tone="good" delay={1100} />

          {/* Sits above the curve and clear of the gain marker further right,
              so nothing the chart is pointing at ends up underneath it. */}
          <div
            className="landing-pop absolute top-[4%] left-[41%] hidden max-w-[38%] origin-bottom-left rounded-[6px] border border-graphite bg-obsidian/95 p-3 text-left backdrop-blur sm:block"
            style={delayStyle(1200)}
          >
            <p className="font-mono text-[12px] tracking-[-0.013em] text-coral-red">
              Drop-off at 2:41
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.45] text-fog">
              Retention falls 14% over 9 seconds, right as the b-roll cuts back
              to a static talking head.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {SIGNAL_BADGES.map((badge, index) => (
            <Badge
              key={badge.label}
              className={badge.tone}
              style={delayStyle(1300 + index * 90)}
            >
              {badge.label}
            </Badge>
          ))}
        </div>

        {/* The written fix: the thing the whole report exists to produce. It is
            marked by a bright hairline down its left edge and by being the only
            paper-white line in the figure, not by a filled panel. The lime is
            two hundred pixels away on the button, and one of those is enough
            for any screen. */}
        <div className="border-l border-mist bg-white/[0.02] py-2.5 pr-3 pl-4">
          <p className="text-[12px] leading-[1.4] text-fog">Fix for next time</p>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-paper">
            Cut the 9 second recap at 2:41 and move the result you tease in the
            title to before the first sponsor beat.
          </p>
        </div>
      </div>
    </figure>
  )
}

// The chips that float around the hero report: three facts the report itself is
// making, lifted off the card and onto the page so the eye has somewhere to go
// after the curve. They are decoration over a figure that already says all of
// this, which is why they are hidden from assistive technology and only drawn
// once there is a column wide enough to hold them without landing on the copy.
//
// Each one is placed on an edge of the card or over the chart, never over the
// report's own writing: a chip that covers a line of the report is worth less
// than the line it covers.
const HERO_CHIPS = [
  {
    label: "Hook",
    value: "71% held",
    tone: "bg-signal-teal",
    position: "top-[38%] -left-5",
    delay: 1500,
    float: "0.5rem",
    duration: "6s",
  },
  {
    label: "Fixes ready",
    value: "3 for the next edit",
    tone: "bg-iris-violet",
    position: "-top-6 right-8",
    delay: 1650,
    float: "0.65rem",
    duration: "7.5s",
  },
  {
    label: "Deep dive",
    value: "Frame level",
    tone: "bg-pulse-green",
    position: "-bottom-5 left-16",
    delay: 1800,
    float: "0.45rem",
    duration: "6.8s",
  },
] as const

export function HeroChips() {
  return (
    <div aria-hidden="true" className="pointer-events-none">
      {HERO_CHIPS.map((chip) => (
        <span
          key={chip.label}
          style={delayStyle(chip.delay)}
          className={cn(
            "landing-pop absolute z-10 hidden lg:block",
            chip.position
          )}
        >
          {/* The bob lives on the inside, so it never has to share the
              transform with the entrance on the wrapper. */}
          <span
            className="landing-float flex items-center gap-2.5 rounded-[6px] border border-graphite bg-obsidian/90 px-3 py-2 backdrop-blur-md"
            style={
              {
                "--landing-float": chip.float,
                "--landing-float-duration": chip.duration,
              } as React.CSSProperties
            }
          >
            <span className={cn("size-1.5 rounded-full", chip.tone)} />
            <span className="text-left">
              <span className="block text-[11px] leading-none text-fog">
                {chip.label}
              </span>
              <span className="mt-1.5 block text-[13px] leading-none font-w510 tracking-ui text-paper">
                {chip.value}
              </span>
            </span>
          </span>
        </span>
      ))}
    </div>
  )
}

function Marker({
  className,
  tone,
  delay = 0,
}: {
  className?: string
  tone: Tone
  delay?: number
}) {
  return (
    <span
      style={delayStyle(delay)}
      className={cn(
        "landing-pop absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 transition-[box-shadow,scale] duration-500 group-hover:scale-125",
        tone === "bad"
          ? "bg-coral-red ring-coral-red/15 group-hover:ring-coral-red/30"
          : "bg-pulse-green ring-pulse-green/15 group-hover:ring-pulse-green/30",
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
    <div className="rounded-[6px] border border-graphite bg-white/[0.02] px-2.5 py-1.5 text-center transition-colors duration-500 group-hover:border-smoke">
      <p className="text-[11px] leading-none text-fog">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[13px] leading-none font-w510 tracking-ui",
          tone === "bad" && "text-coral-red",
          tone === "good" && "text-pulse-green",
          tone === "warn" && "text-mist"
        )}
      >
        {value}
      </p>
    </div>
  )
}

// The signal types a deep dive tags a moment with, in the order they land under
// the chart once the report has drawn itself.
const SIGNAL_BADGES = [
  { label: "Scene cut", tone: "bg-white/5 text-fog" },
  { label: "Topic shift", tone: "bg-iris-violet/15 text-iris-violet" },
  { label: "Pacing change", tone: "bg-white/5 text-fog" },
  { label: "On screen text", tone: "bg-signal-teal/15 text-signal-teal" },
]

function Badge({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      style={style}
      className={cn(
        "landing-rise rounded-[4px] px-1.5 py-0.5 text-[12px] leading-[1.5] whitespace-nowrap",
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
      tone: "bg-white/5 text-mist",
      note: "71% still watching at 10s, 6 points under your channel median.",
      tip: true,
    },
    {
      time: "2:41",
      kind: "Drop-off",
      tone: "bg-coral-red/15 text-coral-red",
      note: "Loses 14% in 9 seconds. Static frame, recap, music out.",
      tip: true,
    },
    {
      time: "4:02 - 4:35",
      kind: "Hold",
      tone: "bg-iris-violet/15 text-iris-violet",
      note: "Retention barely moves. The demo carries the middle of the video.",
      tip: false,
    },
    {
      time: "6:12",
      kind: "Gain",
      tone: "bg-pulse-green/15 text-pulse-green",
      note: "Rises 4%. Viewers scrubbing back to the result you teased.",
      tip: false,
    },
  ]

  return (
    <figure className={cn(CARD_FRAME, "p-5 sm:p-6", className)}>
      <div className="flex flex-wrap gap-1.5 border-b border-graphite pb-4">
        {["Hook", "Drop-offs", "Gains", "Holds", "Pacing"].map((tab, index) => (
          <span
            key={tab}
            style={delayStyle(index * 60)}
            className={cn(
              "landing-rise rounded-full px-3 py-1 text-[12px] leading-[1.4]",
              index === 0
                ? "bg-white/10 text-paper"
                : "bg-white/[0.03] text-fog"
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {events.map((event, index) => (
          <li
            key={event.time}
            style={delayStyle(220 + index * 110)}
            className="landing-rise rounded-[6px] border border-graphite bg-white/[0.02] p-3 transition-colors duration-300 hover:border-smoke hover:bg-white/[0.04]"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-[4px] px-1.5 py-0.5 text-[12px] leading-[1.5]",
                  event.tone
                )}
              >
                {event.kind}
              </span>
              <span className="font-mono text-[12px] tracking-[-0.013em] text-fog">
                {event.time}
              </span>
              {event.tip && (
                <span className="ml-auto rounded-[4px] bg-white/5 px-1.5 py-0.5 text-[11px] leading-[1.5] text-fog">
                  Fix suggested
                </span>
              )}
            </div>
            <p className="mt-2 text-[13px] leading-[1.5] text-fog">
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
      tone: "text-fog",
      subject: "bottom-2 left-1/2 size-4 -translate-x-1/2",
    },
    {
      time: "2:41",
      label: "Cut to desk",
      tone: "text-paper",
      subject: "bottom-1.5 left-[38%] size-7 -translate-x-1/2",
    },
    {
      time: "2:44",
      label: "Recap begins",
      tone: "text-fog",
      subject: "bottom-1.5 left-1/2 size-7 -translate-x-1/2",
    },
    {
      time: "2:47",
      label: "Music drops out",
      tone: "text-fog",
      subject: "bottom-1.5 left-[58%] size-6 -translate-x-1/2",
    },
  ]

  return (
    <figure className={cn(CARD_FRAME, "p-5 sm:p-6", className)}>
      <div className="grid grid-cols-4 gap-2">
        {frames.map((frame, index) => (
          <div
            key={frame.time}
            style={delayStyle(index * 120)}
            className="landing-rise space-y-2"
          >
            {/* The frame the event actually happened on is the one picked out,
                and it is picked out with a brighter edge rather than a colour
                wash. */}
            <div
              className={cn(
                "relative aspect-video overflow-hidden rounded-[6px] border transition-colors duration-500",
                index === 1
                  ? "border-mist bg-obsidian"
                  : "border-graphite bg-white/[0.02] group-hover:border-smoke"
              )}
            >
              {/* A suggestion of a frame: a horizon line and a subject. */}
              <span className="absolute inset-x-0 bottom-1/4 h-px bg-white/10" />
              <span
                className={cn("absolute rounded-full bg-white/15", frame.subject)}
              />
              <span className="absolute top-1.5 left-1.5 rounded-[2px] bg-void/70 px-1 font-mono text-[10px] tracking-[-0.013em] text-fog">
                {frame.time}
              </span>
            </div>
            <p className={cn("truncate text-[12px] leading-[1.4]", frame.tone)}>
              {frame.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 rounded-[6px] border border-graphite bg-white/[0.02] p-3 transition-colors duration-500 group-hover:border-smoke">
        <EvidenceRow
          label="Transcript"
          value={"“So, quick recap of what we just did...”"}
          delay={520}
        />
        <EvidenceRow
          label="Visuals"
          value="Static frame held for 9s, no cuts"
          delay={640}
        />
        <EvidenceRow
          label="Audio"
          value="Bed music ends, room tone only"
          delay={760}
        />
      </div>
    </figure>
  )
}

function EvidenceRow({
  label,
  value,
  delay = 0,
}: {
  label: string
  value: string
  delay?: number
}) {
  return (
    <div
      className="landing-rise flex gap-3 text-[13px] leading-[1.5]"
      style={delayStyle(delay)}
    >
      <span className="w-20 shrink-0 text-fog">{label}</span>
      <span className="min-w-0 flex-1 truncate text-mist">{value}</span>
    </div>
  )
}

/**
 * The comparator feature image: two retention curves on one chart, plus the
 * packaging read that explains the gap between them.
 */
export function ComparisonVisual({ className }: { className?: string }) {
  return (
    <figure className={cn(CARD_FRAME, "p-5 sm:p-6", className)}>
      <div className="flex items-center gap-4 text-[13px]">
        <span className="flex items-center gap-2 text-mist">
          <span className="size-2 rounded-full bg-iris-violet" />
          Video A
        </span>
        <span className="flex items-center gap-2 text-fog">
          <span className="size-2 rounded-full bg-signal-teal" />
          Video B
        </span>
        <span
          className="landing-pop ml-auto rounded-[4px] bg-pulse-green/15 px-1.5 py-0.5 text-[12px] leading-[1.5] text-pulse-green"
          style={delayStyle(1300)}
        >
          A holds 12% longer
        </span>
      </div>

      <div className="mt-4 h-36 sm:h-40">
        <ChartFrame>
          <Gridlines />
          {/* The weaker curve is drawn first and slightly ahead, so the pair
              read as a race the reader watches rather than a static chart. */}
          <path
            d={CURVE_B}
            pathLength="1"
            fill="none"
            stroke="var(--color-signal-teal)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="landing-fade"
            style={delayStyle(500)}
          />
          <path
            d={CURVE}
            pathLength="1"
            fill="none"
            stroke={CURVE_COLOR}
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="landing-draw"
            style={delayStyle(150)}
          />
        </ChartFrame>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <CompareRow
          label="Hook promise"
          a="Explicit"
          b="Implied"
          winner="a"
          delay={900}
        />
        <CompareRow
          label="Title match"
          a="Strong"
          b="Partial"
          winner="a"
          delay={1000}
        />
        <CompareRow
          label="Pace, first 30s"
          a="4 cuts"
          b="1 cut"
          winner="a"
          delay={1100}
        />
        <CompareRow
          label="Payoff timing"
          a="6:12"
          b="2:40"
          winner="b"
          delay={1200}
        />
      </div>
    </figure>
  )
}

function CompareRow({
  label,
  a,
  b,
  winner,
  delay = 0,
}: {
  label: string
  a: string
  b: string
  winner: "a" | "b"
  delay?: number
}) {
  return (
    <div
      style={delayStyle(delay)}
      className="landing-rise rounded-[6px] border border-graphite bg-white/[0.02] px-3 py-2 transition-colors duration-300 hover:border-smoke"
    >
      <p className="text-[12px] leading-[1.4] text-fog">{label}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[13px]">
        <span className={winner === "a" ? "text-paper" : "text-fog"}>{a}</span>
        <span className="font-mono text-[11px] tracking-[-0.013em] text-fog">
          vs
        </span>
        <span className={winner === "b" ? "text-paper" : "text-fog"}>{b}</span>
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
    <figure className={cn(CARD_FRAME, "p-5 sm:p-6", className)}>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] leading-[1.4] text-mist">
          Patterns across your library
        </p>
        <p className="font-mono text-[12px] tracking-[-0.013em] text-fog">
          18 videos
        </p>
      </div>

      <div className="mt-4 space-y-4">
        {trends.map((trend, index) => (
          <div
            key={trend.label}
            className="landing-rise"
            style={delayStyle(index * 120)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[13px] leading-[1.4] text-mist">
                {trend.label}
              </p>
              <p className="shrink-0 font-mono text-[12px] tracking-[-0.013em] text-fog">
                {trend.note}
              </p>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
              {/* The bar is sized in the markup and grown with a scale, so the
                  animation never reflows the row it sits in. */}
              <div
                className={cn(
                  "landing-bar h-full rounded-full",
                  trend.weak ? "bg-smoke" : "bg-iris-violet"
                )}
                style={{
                  width: `${trend.value}%`,
                  ...delayStyle(240 + index * 120),
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <p
        className="landing-rise mt-5 border-l border-graphite py-1 pl-4 text-[13px] leading-[1.5] text-fog transition-colors duration-500 group-hover:border-smoke"
        style={delayStyle(760)}
      >
        Videos that open cold hold <span className="text-paper">9% more</span> of
        their audience through the first minute than the ones with an intro.
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
    <figure className={cn(CARD_FRAME, "p-5 sm:p-6", className)}>
      <p className="text-[13px] leading-[1.4] text-mist">
        Checklist for the next upload
      </p>
      <ul className="mt-4 space-y-2">
        {tips.map((tip, index) => (
          <li
            key={tip.text}
            style={delayStyle(index * 130)}
            className="landing-rise flex items-start gap-3 rounded-[6px] border border-graphite bg-white/[0.02] px-3 py-2.5 transition-colors duration-300 hover:border-smoke hover:bg-white/[0.04]"
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[2px] border transition-colors duration-300",
                tip.done
                  ? "border-mist bg-mist text-void"
                  : "border-smoke"
              )}
            >
              {tip.done && (
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                  {/* The tick draws itself in as the row arrives. */}
                  <path
                    d="M2.5 6.2 4.8 8.5 9.5 3.8"
                    pathLength="1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="landing-draw"
                    style={delayStyle(300 + index * 130, 450)}
                  />
                </svg>
              )}
            </span>
            <span
              className={cn(
                "text-[13px] leading-[1.5] text-mist",
                tip.done && "text-fog line-through"
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
 * The ground under the hero: a faint grid the headline sits on, and the pale
 * wash the product screenshot stands in. The wash is the only gradient on the
 * page, and it is doing a specific job rather than decorating - it puts a
 * horizon behind the report so the card reads as an object standing on
 * something instead of a rectangle floating on black.
 */
export function HeroFloor({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
    >
      {/* The grid rides the scroll a little faster than the page does, so
          passing the hero reads as moving through it rather than sliding it
          along. The clip stays on the wrapper above: a moving clip edge would
          drag a hard line across the wash. */}
      <div
        className="landing-parallax absolute inset-0"
        style={{ "--landing-parallax": "10%" } as React.CSSProperties}
      >
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--color-graphite) 1px, transparent 1px), linear-gradient(to bottom, var(--color-graphite) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse 80% 55% at 50% 0%, black 20%, transparent 72%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 55% at 50% 0%, black 20%, transparent 72%)",
          }}
        />
      </div>

      {/* The floor itself, held still while the grid moves over it. */}
      <div className="linear-hero-floor absolute inset-x-0 bottom-0 h-[62%]" />
    </div>
  )
}

/**
 * The ground a banded section sits on: a faint dot field, masked away at the
 * edges. There is no colour in it. A band on this page is a change of surface
 * of about one percent in lightness, and the texture is what stops that reading
 * as a flat panel rather than as a ground the cards are standing on.
 */
export function SectionTexture({
  className,
  intensity = "default",
}: {
  className?: string
  /**
   * How far the dot field carries. `subtle` is for a band sitting directly
   * under the hero, where the ground should barely register at all.
   */
  intensity?: "default" | "subtle"
}) {
  const subtle = intensity === "subtle"

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
    >
      {/* Same trick as the hero: the ground moves at its own pace behind the
          cards standing on it, and the clip above it holds still. */}
      <div
        className="landing-parallax absolute inset-0"
        style={{ "--landing-parallax": "8%" } as React.CSSProperties}
      >
        <div
          className={cn("absolute inset-0", subtle ? "opacity-30" : "opacity-50")}
          style={{
            backgroundImage:
              "radial-gradient(var(--color-graphite) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage:
              "radial-gradient(ellipse 70% 70% at 50% 50%, black 10%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 70% 70% at 50% 50%, black 10%, transparent 80%)",
          }}
        />
      </div>
    </div>
  )
}
