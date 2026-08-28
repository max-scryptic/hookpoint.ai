import { describe, expect, it } from "vitest"

import { planGrantIsActive } from "@/lib/billing/plan-grants"
import {
  computeGrantUsageWindow,
  resolveEntitlementSource,
} from "@/lib/billing/entitlements"

// A complimentary plan is what an admin hands a test account, so these three
// pure pieces decide whether that account actually gets the paid features:
// whether the grant is live, which window it is metered against, and whether it
// beats whatever the account is already on.

describe("planGrantIsActive", () => {
  const now = new Date("2026-08-28T12:00:00Z")

  it("entitles an open-ended grant that has started", () => {
    expect(
      planGrantIsActive(
        { startsAt: "2026-08-01T00:00:00Z", expiresAt: null },
        now,
      ),
    ).toBe(true)
  })

  it("entitles a dated grant until the moment it lapses", () => {
    expect(
      planGrantIsActive(
        { startsAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-28T12:00:01Z" },
        now,
      ),
    ).toBe(true)
    expect(
      planGrantIsActive(
        { startsAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-28T12:00:00Z" },
        now,
      ),
    ).toBe(false)
  })

  it("does not entitle a grant that has not started yet", () => {
    expect(
      planGrantIsActive(
        { startsAt: "2026-09-01T00:00:00Z", expiresAt: null },
        now,
      ),
    ).toBe(false)
  })
})

describe("computeGrantUsageWindow", () => {
  it("rolls monthly from the day the grant was issued", () => {
    const { start, end } = computeGrantUsageWindow(
      new Date("2026-06-10T09:00:00Z"),
      null,
      new Date("2026-08-28T12:00:00Z"),
    )
    expect(start.toISOString()).toBe("2026-08-10T09:00:00.000Z")
    expect(end.toISOString()).toBe("2026-09-10T09:00:00.000Z")
  })

  // A month of allowance must never run past the day the gift ends, or a
  // lapsing grant hands out a final window the account is no longer entitled to.
  it("caps the final month at the grant's expiry", () => {
    const { start, end } = computeGrantUsageWindow(
      new Date("2026-06-10T09:00:00Z"),
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-08-28T12:00:00Z"),
    )
    expect(start.toISOString()).toBe("2026-08-10T09:00:00.000Z")
    expect(end.toISOString()).toBe("2026-09-01T00:00:00.000Z")
  })
})

describe("resolveEntitlementSource", () => {
  const now = new Date("2026-08-28T12:00:00Z")
  const liveGrant = {
    planId: "pro" as const,
    startsAt: "2026-08-01T00:00:00Z",
    expiresAt: null,
  }
  const paidStarter = {
    planId: "starter" as const,
    status: "active",
    currentPeriodEnd: "2026-09-15T00:00:00Z",
  }

  it("falls back to Free with neither a subscription nor a grant", () => {
    expect(resolveEntitlementSource(null, null, now)).toBe("free")
  })

  it("gives an account with only a grant its gifted plan", () => {
    expect(resolveEntitlementSource(null, liveGrant, now)).toBe("granted")
  })

  it("ignores a grant that has lapsed", () => {
    expect(
      resolveEntitlementSource(
        null,
        { ...liveGrant, expiresAt: "2026-08-01T00:00:00Z" },
        now,
      ),
    ).toBe("free")
    expect(
      resolveEntitlementSource(
        paidStarter,
        { ...liveGrant, expiresAt: "2026-08-01T00:00:00Z" },
        now,
      ),
    ).toBe("paid")
  })

  // The rule that keeps gifting safe on a real account: handing someone a
  // Starter gift must never take away the Pro plan they are paying for.
  it("never downgrades a subscriber to a lesser gifted plan", () => {
    expect(
      resolveEntitlementSource(
        {
          planId: "pro",
          status: "active",
          currentPeriodEnd: "2026-09-15T00:00:00Z",
        },
        { ...liveGrant, planId: "starter" },
        now,
      ),
    ).toBe("paid")
  })

  it("upgrades a subscriber when the gift is the better plan", () => {
    expect(resolveEntitlementSource(paidStarter, liveGrant, now)).toBe("granted")
  })

  // An expired subscription entitles nothing, so the gift is all that is left.
  it("uses the gift when the subscription no longer grants access", () => {
    expect(
      resolveEntitlementSource(
        { ...paidStarter, currentPeriodEnd: "2026-08-01T00:00:00Z" },
        liveGrant,
        now,
      ),
    ).toBe("granted")
  })
})
