import {
  ArrowRightIcon,
  LayersIcon,
  MinusIcon,
  TrophyIcon,
} from "lucide-react"

import { Card } from "@/components/ui/card"
import { stripEmDashes } from "@/lib/copy-guardrails"
import {
  SURFACE_LABEL,
  type CategoricalComparisonRow,
  type ComparisonSurface,
  type FlagComparisonRow,
  type OrdinalComparisonRow,
  type PackagingComparison,
  type PackagingHighlight,
  type Side,
  type SpanComparisonRow,
} from "@/lib/packaging-comparison"

// The packaging head-to-head body: which of two uploads the packaging favours
// and why, read straight from the stored per-video taxonomies with no model
// call at view time. A ranked "biggest differences" list tells the story, then
// each surface (title, thumbnail, hook, cross-surface, drivers) shows its
// field-by-field diff, and the verbatim spans put the real titles, thumbnail
// text and opening lines side by side. Purely presentational; all the maths
// live in lib/packaging-comparison.ts.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

const SIDE_META = {
  a: { dot: "var(--chart-1)", name: "A", bar: "bg-[var(--chart-1)]" },
  b: { dot: "var(--chart-2)", name: "B", bar: "bg-[var(--chart-2)]" },
} as const

const SURFACE_ORDER: ComparisonSurface[] = [
  "title",
  "thumbnail",
  "hook",
  "cross",
  "drivers",
  "overall",
]

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
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
function IdentityRow({ comparison }: { comparison: PackagingComparison }) {
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
                  <TrophyIcon className="size-3" />
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
// the packaging leans toward the higher-viewed video, says so.
function Highlights({
  highlights,
  higherViewsSide,
}: {
  highlights: PackagingHighlight[]
  higherViewsSide: Side | null
}) {
  if (highlights.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">Biggest packaging differences</h4>
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
                {SURFACE_LABEL[highlight.surface]}
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

// A 0-10 dual bar: A grows left-to-right, B mirrored, so the longer bar reads
// as the stronger score at a glance.
function OrdinalBars({ a, b }: { a: number | null; b: number | null }) {
  const width = (value: number | null) =>
    value == null ? 0 : Math.min(100, (value / 10) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2.5 flex-1 justify-end overflow-hidden rounded-l-sm bg-muted">
        <div
          className={SIDE_META.a.bar}
          style={{ width: `${width(a)}%` }}
        />
      </div>
      <div className="flex h-2.5 flex-1 justify-start overflow-hidden rounded-r-sm bg-muted">
        <div
          className={SIDE_META.b.bar}
          style={{ width: `${width(b)}%` }}
        />
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
  categoricals,
  flags,
  spans,
}: {
  surface: ComparisonSurface
  ordinals: OrdinalComparisonRow[]
  categoricals: CategoricalComparisonRow[]
  flags: FlagComparisonRow[]
  spans: SpanComparisonRow[]
}) {
  const empty =
    ordinals.length === 0 &&
    categoricals.length === 0 &&
    flags.length === 0 &&
    spans.length === 0
  if (empty) return null
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border p-3">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {SURFACE_LABEL[surface]}
      </h4>
      {ordinals.length > 0 && (
        <div className="flex flex-col divide-y">
          {ordinals.map((row) => (
            <OrdinalRow key={row.key} row={row} />
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

export function PackagingComparison({ data }: { data: PackagingComparison }) {
  const bySurface = (surface: ComparisonSurface) => ({
    ordinals: data.ordinals.filter((row) => row.surface === surface),
    categoricals: data.categoricals.filter((row) => row.surface === surface),
    flags: data.flags.filter((row) => row.surface === surface),
    spans: data.spans.filter((row) => row.surface === surface),
  })

  const hasBody =
    data.ordinals.length > 0 ||
    data.categoricals.length > 0 ||
    data.flags.length > 0 ||
    data.spans.length > 0

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <div className="flex items-center gap-1.5">
          <LayersIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Packaging head-to-head</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Why one of these earned the click and the other did not, read from
          each video&apos;s stored packaging analysis. Every score was measured
          on that video alone at analysis time, so this comparison is instant
          and needs no fresh analysis. Scores are correlation, not proof.
        </p>
      </div>

      <IdentityRow comparison={data} />

      {!hasBody ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {data.a.hasTaxonomy || data.b.hasTaxonomy
            ? "Only one of these videos has a packaging read so far. Open the other video's analysis to generate it, then this fills in."
            : "Neither video has a packaging read yet."}
        </p>
      ) : (
        <>
          <Highlights
            highlights={data.highlights}
            higherViewsSide={data.higherViewsSide}
          />

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
                  categoricals={rows.categoricals}
                  flags={rows.flags}
                  spans={rows.spans}
                />
              )
            })}
          </div>

          {data.detailCoverage !== "both" && (
            <p className="text-xs text-muted-foreground">
              One of these videos predates the detailed packaging read, so only
              the shared fields are compared. It upgrades automatically the next
              time you open its analysis.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
