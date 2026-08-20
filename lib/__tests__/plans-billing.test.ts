import { describe, expect, it } from "vitest"

import {
  comparisonCreditCost,
  comparisonRefundCredits,
  creditsForDurationSeconds,
  getPlan,
  isPaidPlanId,
  maxUploadBytesForPlan,
  PLAN_BY_ID,
  planIncludesUploads,
  VIDEO_COMPARISON_CREDIT_COST,
} from "@/lib/plans"
import {
  getSubscriptionReturnUrl,
  resolvePlanFromPriceId,
} from "@/lib/stripe/config"

describe("creditsForDurationSeconds", () => {
  it("rounds any started minute up to a whole credit", () => {
    expect(creditsForDurationSeconds(0)).toBe(0)
    expect(creditsForDurationSeconds(1)).toBe(1)
    expect(creditsForDurationSeconds(60)).toBe(1)
    expect(creditsForDurationSeconds(61)).toBe(2)
    expect(creditsForDurationSeconds(600)).toBe(10)
  })

  it("treats garbage durations as zero cost", () => {
    expect(creditsForDurationSeconds(-5)).toBe(0)
    expect(creditsForDurationSeconds(Number.NaN)).toBe(0)
    expect(creditsForDurationSeconds(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe("comparisonCreditCost", () => {
  // The first head-to-head a paid creator generates is the one they cannot judge
  // from the outside, so it does not ask them to spend anything to find out.
  it("is free for a creator who has never generated one", () => {
    expect(comparisonCreditCost(0)).toBe(0)
  })

  it("costs the flat price once they have one", () => {
    expect(comparisonCreditCost(1)).toBe(VIDEO_COMPARISON_CREDIT_COST)
    expect(comparisonCreditCost(12)).toBe(VIDEO_COMPARISON_CREDIT_COST)
  })
})

describe("comparisonRefundCredits", () => {
  it("hands back exactly what the row recorded", () => {
    expect(comparisonRefundCredits(VIDEO_COMPARISON_CREDIT_COST)).toBe(
      VIDEO_COMPARISON_CREDIT_COST,
    )
  })

  // A recorded zero is the free first comparison. Undoing it must hand back
  // nothing, or the button mints credits every time it is pressed and abandoned.
  it("hands back nothing for a comparison that was free", () => {
    expect(comparisonRefundCredits(0)).toBe(0)
    expect(comparisonRefundCredits(-3)).toBe(0)
  })

  // Every pair generated before rows recorded a price was charged the flat cost.
  it("falls back to the flat cost when the row recorded no price", () => {
    expect(comparisonRefundCredits(null)).toBe(VIDEO_COMPARISON_CREDIT_COST)
  })
})

describe("maxUploadBytesForPlan", () => {
  it("is null for the Free plan (no uploads)", () => {
    expect(maxUploadBytesForPlan(PLAN_BY_ID.free)).toBeNull()
  })

  it("converts the plan's GB cap to bytes for paid plans", () => {
    expect(maxUploadBytesForPlan(PLAN_BY_ID.starter)).toBe(10 * 1024 ** 3)
    expect(maxUploadBytesForPlan(PLAN_BY_ID.pro)).toBe(20 * 1024 ** 3)
  })
})

// Every gate on the upload path reads this one predicate, including the
// completion route that refuses an upload started before a downgrade, so Free
// answering false is what keeps a finished source file off an unpaid plan.
describe("planIncludesUploads", () => {
  it("is false for the Free plan", () => {
    expect(planIncludesUploads(PLAN_BY_ID.free)).toBe(false)
  })

  it("is true for every paid plan", () => {
    expect(planIncludesUploads(PLAN_BY_ID.starter)).toBe(true)
    expect(planIncludesUploads(PLAN_BY_ID.pro)).toBe(true)
  })
})

describe("getPlan", () => {
  it("resolves known ids and defaults unknowns to Free", () => {
    expect(getPlan("pro").id).toBe("pro")
    expect(getPlan("nonsense").id).toBe("free")
    expect(getPlan(null).id).toBe("free")
  })
})

describe("isPaidPlanId", () => {
  it("only accepts starter and pro", () => {
    expect(isPaidPlanId("starter")).toBe(true)
    expect(isPaidPlanId("pro")).toBe(true)
    expect(isPaidPlanId("free")).toBe(false)
    expect(isPaidPlanId("enterprise")).toBe(false)
  })
})

describe("resolvePlanFromPriceId", () => {
  it("maps a configured price id back to its plan + period", () => {
    process.env.STRIPE_PRICE_STARTER_ANNUAL = "price_starter_annual_123"
    expect(resolvePlanFromPriceId("price_starter_annual_123")).toEqual({
      planId: "starter",
      period: "annual",
    })
    delete process.env.STRIPE_PRICE_STARTER_ANNUAL
  })

  it("returns null for an unknown price id", () => {
    expect(resolvePlanFromPriceId("price_unknown")).toBeNull()
  })
})

describe("getSubscriptionReturnUrl", () => {
  it("routes successful checkouts through sync before the dashboard", () => {
    const previousBaseUrl = process.env.APP_BASE_URL
    process.env.APP_BASE_URL = "https://hookpoint.test"

    try {
      expect(getSubscriptionReturnUrl("success")).toBe(
        "https://hookpoint.test/api/billing/checkout/success?checkout=success&session_id=%7BCHECKOUT_SESSION_ID%7D",
      )
      expect(getSubscriptionReturnUrl("cancelled")).toBe(
        "https://hookpoint.test/pricing?checkout=cancelled",
      )
    } finally {
      if (previousBaseUrl) {
        process.env.APP_BASE_URL = previousBaseUrl
      } else {
        delete process.env.APP_BASE_URL
      }
    }
  })
})
