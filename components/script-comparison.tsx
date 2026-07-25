import {
  ArrowRightIcon,
  FileTextIcon,
  MinusIcon,
  RouteIcon,
} from "lucide-react"

import { Card } from "@/components/ui/card"
import { stripEmDashes } from "@/lib/copy-guardrails"
import {
  SCRIPT_SURFACE_LABEL,
  type CategoricalComparisonRow,
  type FlagComparisonRow,
  type MetricComparisonRow,
  type OrdinalComparisonRow,
  type ScriptComparison,
  type ScriptHighlight,
  type ScriptSurface,
  type Side,
  type SpanComparisonRow,
} from "@/lib/script-comparison"
import type { ScriptSegment } from "@/lib/script-taxonomy"

// The script head-to-head body: how two uploads differ in what they SAY and how
// they feel, read straight from each video's stored script taxonomy with no
// model call at view time. A ranked "biggest differences" list tells the story,
// a topic-map strip lays the two scripts out beat for beat, then each surface
// (structure, substance, emotion, humour, rhetoric) shows its field-by-field
// diff. Purely presentational; all the maths live in lib/script-comparison.ts.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "A", bar: "bg-[var(--chart-1)]" },
  b: { dot: "var(--chart-2)", name: "B", bar: "bg-[var(--chart-2)]" },
} as const

const SURFACE_ORDER: ScriptSurface[] = [
  "structure",
  "substance",
  "emotion",
  "humor",
  "rhetoric",
  "overall",
]

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

function clean(text: string): string {
  return stripEmDashes(text)
}

function SideDot({ side }: { side: Side }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: SIDE_META[side].dot }}
    />
  )
}

// The two videos, with the higher-viewed one badged so every "favours A"
// downstream has an anchor.
function IdentityRow({ comparison }: { comparison: ScriptComparison }) {
  const sides: Side[] = ["a", "b"]
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {sides.map((side) => {
        const s = comparison[side]
        const isTop = comparison.higherViewsSide === side
        return (
          <div
            key={side}
            className="flex flex-col gap-1 rounded-lg border bg-card p-3"
          >
            <div className="flex items-center gap-1.5">
              <SideDot side={side} />
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Video {SIDE_META[side].name}
              </span>
              {isTop && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-500">
                  most views
                </span>
              )}
            </div>
            <span className="truncate text-sm font-medium">
              {s.title ? clean(s.title) : "Untitled video"}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {s.views == null
                ? "views unknown"
                : `${formatCompactNumber(s.views)} views`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// The ranked story. Each row states the difference in plain numbers and, when
// the script leans toward the higher-viewed video, says so.
function Highlights({
  highlights,
  higherViewsSide,
}: {
  highlights: ScriptHighlight[]
  higherViewsSide: Side | null
}) {
  if (highlights.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">Biggest script differences</h4>
      <div className="flex flex-col divide-y rounded-lg border">
        {highlights.map((highlight) => {
          const leansTop =
            higherViewsSide != null && highlight.favours === higherViewsSide
          return (
            <div
              key={highlight.key}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {SCRIPT_SURFACE_LABEL[highlight.surface]}
              </span>
              <span>{clean(highlight.detail)}</span>
              {highlight.favours !== "neither" && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <SideDot side={highlight.favours} />
                  favours {SIDE_META[highlight.favours].name}
                  {leansTop && (
                    <span className="text-emerald-600 dark:text-emerald-500">
                      {" "}
                      (the higher-viewed one)
                    </span>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The two topic maps stacked, so the reader can see where each script spends its
// beats and how differently the two are shaped.
function TopicMap({
  segments,
}: {
  segments: { a: ScriptSegment[]; b: ScriptSegment[] }
}) {
  if (segments.a.length === 0 && segments.b.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <RouteIcon className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Topic map</h4>
      </div>
      <div className="flex flex-col gap-2">
        {(["a", "b"] as Side[]).map((side) => {
          const beats = segments[side]
          return (
            <div
              key={side}
              className="flex flex-col gap-1.5 rounded-lg border bg-card p-3"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <SideDot side={side} />
                Video {SIDE_META[side].name}
              </span>
              {beats.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Too short or single-topic to map.
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {beats.map((beat, index) => (
                    <span
                      key={`${beat.approxStartSeconds}-${index}`}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]"
                    >
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatTimestamp(beat.approxStartSeconds)}
                      </span>
                      <span>{clean(beat.label)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// A 0-10 dual bar: A grows left-to-right, B mirrored, so the longer bar reads as
// the stronger score at a glance.
function OrdinalBars({ a, b }: { a: number | null; b: number | null }) {
  const width = (value: number | null) =>
    value == null ? 0 : Math.min(100, (value / 10) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2.5 flex-1 justify-end overflow-hidden rounded-l-sm bg-muted">
        <div className={SIDE_META.a.bar} style={{ width: `${width(a)}%` }} />
      </div>
      <div className="flex h-2.5 flex-1 justify-start overflow-hidden rounded-r-sm bg-muted">
        <div className={SIDE_META.b.bar} style={{ width: `${width(b)}%` }} />
      </div>
    </div>
  )
}

function OrdinalRow({ row }: { row: OrdinalComparisonRow }) {
  return (
    <div className="grid grid-cols-[1fr_minmax(8rem,14rem)_1fr] items-center gap-x-3 py-1.5 text-xs">
      <span className="text-right tabular-nums">
        {row.a == null ? "-" : row.a}
      </span>
      <div className="flex flex-col gap-0.5">
        <OrdinalBars a={row.a} b={row.b} />
        <span className="text-center text-[11px] text-muted-foreground">
          {clean(row.label)}
          {row.direction === "neutral" && (
            <span className="text-muted-foreground/70"> (descriptive)</span>
          )}
        </span>
      </div>
      <span className="tabular-nums">{row.b == null ? "-" : row.b}</span>
    </div>
  )
}

function MetricRow({ row }: { row: MetricComparisonRow }) {
  const format = (value: number | null) =>
    value == null ? "-" : new Intl.NumberFormat("en").format(value)
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-1.5 text-xs">
      <span>{clean(row.label)}</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <SideDot side="a" />
        {format(row.a)}
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <SideDot side="b" />
        {format(row.b)}
      </span>
    </div>
  )
}

function TokenChips({
  tokens,
  tone,
}: {
  tokens: string[]
  tone: "shared" | "a" | "b"
}) {
  const toneClass =
    tone === "shared"
      ? "border bg-muted text-muted-foreground"
      : tone === "a"
        ? "border-[var(--chart-1)]/40 bg-[var(--chart-1)]/10"
        : "border-[var(--chart-2)]/40 bg-[var(--chart-2)]/10"
  return (
    <>
      {tokens.map((token) => (
        <span
          key={`${tone}:${token}`}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
        >
          {clean(token)}
        </span>
      ))}
    </>
  )
}

function CategoricalRow({ row }: { row: CategoricalComparisonRow }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">{clean(row.label)}</span>
        {row.match && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <MinusIcon className="size-3" />
            same
          </span>
        )}
      </div>
      {!row.match && (
        <div className="flex flex-wrap items-center gap-1">
          {row.onlyA.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <SideDot side="a" />
              <TokenChips tokens={row.onlyA} tone="a" />
            </span>
          )}
          {row.onlyB.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <SideDot side="b" />
              <TokenChips tokens={row.onlyB} tone="b" />
            </span>
          )}
          {row.shared.length > 0 && (
            <TokenChips tokens={row.shared} tone="shared" />
          )}
        </div>
      )}
      {row.match && row.a && (
        <div className="flex flex-wrap gap-1">
          <TokenChips tokens={row.a} tone="shared" />
        </div>
      )}
    </div>
  )
}

function flagText(value: boolean | null): string {
  if (value == null) return "-"
  return value ? "yes" : "no"
}

function FlagRow({ row }: { row: FlagComparisonRow }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 py-1.5 text-xs">
      <span>{clean(row.label)}</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <SideDot side="a" />
        {flagText(row.a)}
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <SideDot side="b" />
        {flagText(row.b)}
      </span>
    </div>
  )
}

function SpanRow({ row }: { row: SpanComparisonRow }) {
  return (
    <div className="flex flex-col gap-1 py-1.5 text-xs">
      <span className="font-medium">{clean(row.label)}</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["a", "b"] as Side[]).map((side) => {
          const text = side === "a" ? row.a : row.b
          return (
            <div
              key={side}
              className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5"
            >
              <span className="mt-0.5">
                <SideDot side={side} />
              </span>
              <span className="text-muted-foreground">
                {text.length > 0 ? clean(text) : "not stated"}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SurfaceSection({
  surface,
  ordinals,
  metrics,
  categoricals,
  flags,
  spans,
}: {
  surface: ScriptSurface
  ordinals: OrdinalComparisonRow[]
  metrics: MetricComparisonRow[]
  categoricals: CategoricalComparisonRow[]
  flags: FlagComparisonRow[]
  spans: SpanComparisonRow[]
}) {
  const empty =
    ordinals.length === 0 &&
    metrics.length === 0 &&
    categoricals.length === 0 &&
    flags.length === 0 &&
    spans.length === 0
  if (empty) return null
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border p-3">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {SCRIPT_SURFACE_LABEL[surface]}
      </h4>
      {ordinals.length > 0 && (
        <div className="flex flex-col divide-y">
          {ordinals.map((row) => (
            <OrdinalRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {metrics.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {metrics.map((row) => (
            <MetricRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {categoricals.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {categoricals.map((row) => (
            <CategoricalRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {flags.map((row) => (
            <FlagRow key={row.key} row={row} />
          ))}
        </div>
      )}
      {spans.length > 0 && (
        <div className="flex flex-col divide-y border-t pt-1">
          {spans.map((row) => (
            <SpanRow key={row.key} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}

export function ScriptComparison({ data }: { data: ScriptComparison }) {
  const bySurface = (surface: ScriptSurface) => ({
    ordinals: data.ordinals.filter((row) => row.surface === surface),
    metrics: data.metrics.filter((row) => row.surface === surface),
    categoricals: data.categoricals.filter((row) => row.surface === surface),
    flags: data.flags.filter((row) => row.surface === surface),
    spans: data.spans.filter((row) => row.surface === surface),
  })

  const hasBody =
    data.ordinals.length > 0 ||
    data.metrics.length > 0 ||
    data.categoricals.length > 0 ||
    data.flags.length > 0 ||
    data.spans.length > 0

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <div className="flex items-center gap-1.5">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Script head-to-head</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          How the two scripts differ in what they say and how they feel, read
          from each video&apos;s stored script analysis. Every score was measured
          on that video alone at analysis time, so this comparison is instant and
          needs no fresh analysis. Scores are correlation, not proof.
        </p>
      </div>

      <IdentityRow comparison={data} />

      {!hasBody ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {data.a.hasTaxonomy || data.b.hasTaxonomy
            ? "Only one of these videos has a script read so far. Open the other video's analysis to generate it, then this fills in."
            : "Neither video has a script read yet."}
        </p>
      ) : (
        <>
          <Highlights
            highlights={data.highlights}
            higherViewsSide={data.higherViewsSide}
          />

          <TopicMap segments={data.segments} />

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <SideDot side="a" />
              Video A
            </span>
            <ArrowRightIcon className="size-3" />
            <span className="inline-flex items-center gap-1">
              <SideDot side="b" />
              Video B
            </span>
            <span className="ml-auto">Bars and scores run 0 to 10.</span>
          </div>

          <div className="flex flex-col gap-2">
            {SURFACE_ORDER.map((surface) => {
              const rows = bySurface(surface)
              return (
                <SurfaceSection
                  key={surface}
                  surface={surface}
                  ordinals={rows.ordinals}
                  metrics={rows.metrics}
                  categoricals={rows.categoricals}
                  flags={rows.flags}
                  spans={rows.spans}
                />
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}
