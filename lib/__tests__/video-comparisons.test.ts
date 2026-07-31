import { describe, expect, it } from "vitest"

import {
  PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION,
  SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION,
} from "@/lib/comparison-report-versions"
import type { PackagingComparisonReport } from "@/lib/packaging-comparison-report"
import type { ScriptComparisonReport } from "@/lib/script-comparison-report"
import {
  isPackagingReportCurrent,
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
