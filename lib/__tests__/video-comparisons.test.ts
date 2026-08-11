import { describe, expect, it } from "vitest"

import {
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  RETENTION_COMPARISON_REPORT_SCHEMA_VERSION,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
} from "@/lib/comparison-report-versions"
import type { PackagingComparisonReport } from "@/lib/packaging-comparison-report"
import type { RetentionComparisonReport } from "@/lib/retention-comparison-report"
import type { ScriptComparisonReport } from "@/lib/script-comparison-report"
import {
  ABANDONED_COMPARISON_GRACE_MS,
  comparisonWriteState,
  isPackagingReportCurrent,
  isRetentionReportCurrent,
  isSamePair,
  isScriptReportCurrent,
} from "@/lib/video-comparisons"

describe("isSamePair", () => {
  it("matches an identical ordered pair", () => {
    expect(isSamePair({ a: "x", b: "y" }, { a: "x", b: "y" })).toBe(true)
  })

  it("matches a swapped pair - a comparison is unordered", () => {
    expect(isSamePair({ a: "x", b: "y" }, { a: "y", b: "x" })).toBe(true)
  })

  it("does not match a different pair", () => {
    expect(isSamePair({ a: "x", b: "y" }, { a: "x", b: "z" })).toBe(false)
    expect(isSamePair({ a: "x", b: "y" }, { a: "p", b: "q" })).toBe(false)
  })
})

function packagingReport(schemaVersion: number): PackagingComparisonReport {
  return { schemaVersion } as PackagingComparisonReport
}

function scriptReport(schemaVersion: number): ScriptComparisonReport {
  return { schemaVersion } as ScriptComparisonReport
}

function retentionReport(schemaVersion: number): RetentionComparisonReport {
  return { schemaVersion } as RetentionComparisonReport
}

describe("isPackagingReportCurrent", () => {
  it("is true for a report at the current shape", () => {
    expect(
      isPackagingReportCurrent(
        packagingReport(PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION),
      ),
    ).toBe(true)
  })

  it("is false for a report written against an older shape", () => {
    // Version 1 has no tips at all, so its tabs render without the "Try:" line
    // every surface is meant to close on. Pressing generate on the pair again
    // rewrites it for free.
    expect(isPackagingReportCurrent(packagingReport(1))).toBe(false)
  })

  it("is false when no report is stored", () => {
    expect(isPackagingReportCurrent(null)).toBe(false)
  })

  it("leaves a report from a newer deploy alone", () => {
    expect(
      isPackagingReportCurrent(
        packagingReport(PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION + 1),
      ),
    ).toBe(true)
  })
})

describe("isScriptReportCurrent", () => {
  it("is true for a report at the current shape", () => {
    expect(
      isScriptReportCurrent(
        scriptReport(SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION),
      ),
    ).toBe(true)
  })

  it("is false when no report is stored", () => {
    expect(isScriptReportCurrent(null)).toBe(false)
  })
})

describe("isRetentionReportCurrent", () => {
  it("is true for a report at the current shape", () => {
    expect(
      isRetentionReportCurrent(
        retentionReport(RETENTION_COMPARISON_REPORT_SCHEMA_VERSION),
      ),
    ).toBe(true)
  })

  it("is false when no report is stored", () => {
    // Every pair generated before the written retention read existed lands
    // here, so pressing the button on one of them writes it for free.
    expect(isRetentionReportCurrent(null)).toBe(false)
  })

  it("leaves a report from a newer deploy alone", () => {
    expect(
      isRetentionReportCurrent(
        retentionReport(RETENTION_COMPARISON_REPORT_SCHEMA_VERSION + 1),
      ),
    ).toBe(true)
  })
})

// The rule that decides whether the history shows a pair as rewritten. It
// matters because a re-finish is otherwise invisible: it costs nothing, adds no
// row, and leaves "compared on" exactly where it was, so a creator who finishes
// a stale report and comes back to an unchanged list concludes the report they
// just watched being written has gone missing.

const CREATED_AT = "2026-08-11 19:46:38.470061+00"
const CREATED_MS = new Date(CREATED_AT).getTime()

function at(offsetMs: number): string {
  return new Date(CREATED_MS + offsetMs).toISOString()
}

function comparisonRow(overrides: {
  created_at?: string
  script_written?: string | null
  packaging_written?: string | null
  retention_written?: string | null
}) {
  return {
    created_at: CREATED_AT,
    script_written: null,
    packaging_written: null,
    retention_written: null,
    ...overrides,
  }
}

describe("comparisonWriteState", () => {
  it("falls back to the creation time when no report has been written", () => {
    const state = comparisonWriteState(comparisonRow({}))

    expect(state.lastWrittenAt).toBe(new Date(CREATED_AT).toISOString())
    expect(state.rewritten).toBe(false)
  })

  it("normalises both timestamp formats so they sort against each other", () => {
    // created_at comes back in Postgres's own format and a stored generatedAt
    // in ISO, which do not compare as strings: a space sorts before a T, so the
    // raw values would order a later write ahead of an earlier one.
    expect(comparisonWriteState(comparisonRow({})).lastWrittenAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    )
  })

  it("takes the newest of the three written reports", () => {
    const state = comparisonWriteState(
      comparisonRow({
        retention_written: at(14_000),
        script_written: at(22_000),
        packaging_written: at(16_000),
      }),
    )

    expect(state.lastWrittenAt).toBe(at(22_000))
  })

  it("does not call the run that created the pair a rewrite", () => {
    // All three reports are written by that run, within its own lifetime.
    const state = comparisonWriteState(
      comparisonRow({
        retention_written: at(14_000),
        script_written: at(22_000),
        packaging_written: at(24_000),
      }),
    )

    expect(state.rewritten).toBe(false)
  })

  it("calls a report written past the grace window a rewrite", () => {
    // Nothing that started with the pair can still be running by here, so the
    // only thing that can have written this is a later press of the button.
    const written = at(ABANDONED_COMPARISON_GRACE_MS + 60_000)
    const state = comparisonWriteState(
      comparisonRow({ script_written: written }),
    )

    expect(state.rewritten).toBe(true)
    expect(state.lastWrittenAt).toBe(written)
  })

  it("holds the line exactly at the grace window", () => {
    expect(
      comparisonWriteState(
        comparisonRow({ script_written: at(ABANDONED_COMPARISON_GRACE_MS) }),
      ).rewritten,
    ).toBe(false)
    expect(
      comparisonWriteState(
        comparisonRow({
          script_written: at(ABANDONED_COMPARISON_GRACE_MS + 1),
        }),
      ).rewritten,
    ).toBe(true)
  })

  it("ignores a report stamped before the pair existed", () => {
    // A clock that disagrees with the database's must not read as a rewrite,
    // and must not drag the sort key back past the row's own creation.
    const state = comparisonWriteState(
      comparisonRow({ script_written: at(-60_000) }),
    )

    expect(state.lastWrittenAt).toBe(new Date(CREATED_AT).toISOString())
    expect(state.rewritten).toBe(false)
  })

  it("ignores an unparseable stamp rather than dropping the row", () => {
    const state = comparisonWriteState(
      comparisonRow({
        script_written: "not a date",
        packaging_written: at(20_000),
      }),
    )

    expect(state.lastWrittenAt).toBe(at(20_000))
    expect(state.rewritten).toBe(false)
  })
})
