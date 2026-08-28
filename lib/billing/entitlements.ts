// The single place that answers "what is this user allowed to do right now?".
// It resolves the user's effective plan and current billing window, reads their
// usage for that window, and exposes the allow-checks the enforcement points
// (video analysis, source-file upload) call. All reads go through the
// service-role admin client because the billing/usage tables are locked down to
// server-side access only.

import { createAdminClient } from "@/lib/supabase/admin"
import {
  creditsForDurationSeconds,
  getPlan,
  maxUploadBytesForPlan,
  planRanksAtLeast,
  type Plan,
  type PlanId,
} from "@/lib/plans"
import type { BillingPeriod } from "@/lib/plans"
import { getSubscriptionForUser } from "@/lib/billing/subscriptions"
import {
  getPlanGrantForUser,
  planGrantIsActive,
  type PlanGrant,
} from "@/lib/billing/plan-grants"

// Subscription statuses that grant the paid plan (past_due keeps access during
// Stripe's dunning grace period; the subscription is only truly gone once it
// cancels, at which point the projection row is deleted).
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due"])

export function subscriptionGrantsPaidAccess(
  subscription: { status: string; currentPeriodEnd: string | Date },
  now: Date,
): boolean {
  if (!ENTITLING_STATUSES.has(subscription.status)) return false
  return new Date(subscription.currentPeriodEnd).getTime() > now.getTime()
}

export type Entitlement = {
  planId: PlanId
  plan: Plan
  // The active usage window. Usage counters are keyed on periodStart, so a new
  // window automatically starts every tally at zero.
  periodStart: Date
  periodEnd: Date
  // The Stripe subscription period for paid users, or the grant's window for a
  // complimentary plan. Annual plans use this for paid-through/cancellation
  // display while usage still rolls monthly.
  subscriptionPeriodStart: Date | null
  subscriptionPeriodEnd: Date | null
  // "paid" when a Stripe subscription is driving the window, "granted" when an
  // admin gifted the plan, "free" when it is anchored to the account creation
  // date.
  source: "paid" | "granted" | "free"
  billingPeriod: BillingPeriod | null
  cancelAtPeriodEnd: boolean
  // The complimentary plan on the account, when it has one. Present whether or
  // not it is the thing currently entitling them (a grant that has lapsed, or
  // that a better paid subscription outranks, still shows up here), so the
  // admin surface can report exactly what was given.
  grant: PlanGrant | null
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function addUtcMonths(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const targetDay = Math.min(
    date.getUTCDate(),
    daysInUtcMonth(targetYear, normalizedMonth),
  )

  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      targetDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  )
}

function differenceInUtcMonths(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  )
}

// Computes the current monthly window for a Free user, anchored to the day their
// account was created. Pure and total: for any `now >= anchor` it returns the
// window [start, end) that contains `now`, with start/end landing on the same
// day-of-month as the anchor (clamped in short months, e.g. a 31st anchor falls
// to the 30th/28th). Exported for direct unit testing.
export function computeMonthlyUsageWindow(
  anchor: Date,
  now: Date,
): { start: Date; end: Date } {
  // The database stores UTC timestamps, so do the month math in UTC. Local-time
  // month helpers can shift billing windows by an hour across DST boundaries.
  let months = Math.max(0, differenceInUtcMonths(anchor, now))
  let start = addUtcMonths(anchor, months)
  while (start.getTime() > now.getTime() && months > 0) {
    months -= 1
    start = addUtcMonths(anchor, months)
  }
  let end = addUtcMonths(anchor, months + 1)
  while (end.getTime() <= now.getTime()) {
    months += 1
    start = addUtcMonths(anchor, months)
    end = addUtcMonths(anchor, months + 1)
  }
  return { start, end }
}

// Backwards-compatible test/export name for the Free plan's monthly cycle.
export const computeFreePeriodWindow = computeMonthlyUsageWindow

// Annual subscriptions are paid yearly in Stripe, but the product allowance is
// still monthly. The final usage month is capped at Stripe's paid-through date
// so a cancellation/renewal boundary cannot leak into the next annual period.
export function computeAnnualUsageWindow(
  subscriptionStart: Date,
  subscriptionEnd: Date,
  now: Date,
): { start: Date; end: Date } {
  const window = computeMonthlyUsageWindow(subscriptionStart, now)
  return {
    start: window.start,
    end:
      window.end.getTime() > subscriptionEnd.getTime()
        ? subscriptionEnd
        : window.end,
  }
}

// Reads the timestamp a user's account was created, the anchor for the Free
// plan's monthly cycle. Falls back to "now" if the row is somehow missing, which
// simply starts a fresh cycle rather than failing the request.
async function getAccountCreatedAt(userId: string): Promise<Date> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("created_at")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load account creation date: ${error.message}`)
  }
  const created = (data as { created_at: string } | null)?.created_at
  return created ? new Date(created) : new Date()
}

// A complimentary plan is metered exactly like a paid one: a monthly allowance,
// anchored to the day the grant was issued, with the final month capped at the
// grant's expiry so a time-boxed gift cannot hand out an allowance past the day
// it lapses. An open-ended grant simply rolls monthly forever.
export function computeGrantUsageWindow(
  grantStart: Date,
  grantEnd: Date | null,
  now: Date,
): { start: Date; end: Date } {
  const window = computeMonthlyUsageWindow(grantStart, now)
  if (!grantEnd) return window
  return {
    start: window.start,
    end:
      window.end.getTime() > grantEnd.getTime() ? grantEnd : window.end,
  }
}

// Which of the two things that can entitle an account wins, given both.
//
// A gift never downgrades anyone: an admin granting Starter to a creator who is
// paying for Pro leaves the Pro subscription in charge. Otherwise the grant
// wins, because that is the whole point of issuing one, and it carries its own
// usage window so a gifted account is not metered against a Stripe period it
// has nothing to do with.
export function resolveEntitlementSource(
  subscription: { status: string; currentPeriodEnd: string | Date; planId: PlanId } | null,
  grant: { planId: PlanId; startsAt: string | Date; expiresAt: string | Date | null } | null,
  now: Date,
): "paid" | "granted" | "free" {
  const paidActive = Boolean(
    subscription && subscriptionGrantsPaidAccess(subscription, now),
  )
  const grantActive = Boolean(grant && planGrantIsActive(grant, now))

  if (grantActive && grant) {
    if (!paidActive || !subscription) return "granted"
    return planRanksAtLeast(grant.planId, subscription.planId)
      ? "granted"
      : "paid"
  }
  return paidActive ? "paid" : "free"
}

// Resolves the user's effective plan and usage window. A complimentary plan an
// admin granted comes first (unless the account is paying for a better one).
// Otherwise: monthly paid subscriptions use Stripe's monthly period directly;
// annual paid subscriptions derive a monthly usage window inside Stripe's
// yearly paid-through period; and a user with neither is Free, with a window
// anchored to their account creation date.
export async function getEntitlement(
  userId: string,
  now: Date = new Date(),
): Promise<Entitlement> {
  const [subscription, grant] = await Promise.all([
    getSubscriptionForUser(userId),
    // A grant is an admin-issued extra, so a lookup failure must not take down
    // an otherwise resolvable entitlement (in particular before the migration
    // that creates the table has been applied). Falling back to null resolves
    // the plan the user pays for, or Free.
    getPlanGrantForUser(userId).catch((error) => {
      console.error("Failed to load plan grant", error)
      return null
    }),
  ])

  const source = resolveEntitlementSource(subscription, grant, now)

  if (source === "granted" && grant) {
    const grantStart = new Date(grant.startsAt)
    const grantEnd = grant.expiresAt ? new Date(grant.expiresAt) : null
    const usageWindow = computeGrantUsageWindow(grantStart, grantEnd, now)

    return {
      planId: grant.planId,
      plan: getPlan(grant.planId),
      periodStart: usageWindow.start,
      periodEnd: usageWindow.end,
      subscriptionPeriodStart: grantStart,
      subscriptionPeriodEnd: grantEnd,
      source: "granted",
      // No money is changing hands, so there is no billing interval to name.
      billingPeriod: null,
      cancelAtPeriodEnd: false,
      grant,
    }
  }

  if (source === "paid" && subscription) {
    const subscriptionStart = new Date(subscription.currentPeriodStart)
    const subscriptionEnd = new Date(subscription.currentPeriodEnd)
    const usageWindow =
      subscription.billingPeriod === "annual"
        ? computeAnnualUsageWindow(subscriptionStart, subscriptionEnd, now)
        : { start: subscriptionStart, end: subscriptionEnd }

    return {
      planId: subscription.planId,
      plan: getPlan(subscription.planId),
      periodStart: usageWindow.start,
      periodEnd: usageWindow.end,
      subscriptionPeriodStart: subscriptionStart,
      subscriptionPeriodEnd: subscriptionEnd,
      source: "paid",
      billingPeriod: subscription.billingPeriod,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      grant,
    }
  }

  const anchor = await getAccountCreatedAt(userId)
  const { start, end } = computeMonthlyUsageWindow(anchor, now)
  return {
    planId: "free",
    plan: getPlan("free"),
    periodStart: start,
    periodEnd: end,
    subscriptionPeriodStart: null,
    subscriptionPeriodEnd: null,
    source: "free",
    billingPeriod: null,
    cancelAtPeriodEnd: false,
    grant,
  }
}

export type Usage = {
  videoAnalysesUsed: number
  deepCreditsUsed: number
}

// Reads the usage tally for a specific window. A missing row means nothing has
// been consumed in this window yet, i.e. zero.
export async function getUsageForWindow(
  userId: string,
  periodStart: Date,
): Promise<Usage> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("usage_counters")
    .select("video_analyses_used, deep_credits_used")
    .eq("user_id", userId)
    .eq("period_start", periodStart.toISOString())
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load usage: ${error.message}`)
  }
  const row = data as
    | { video_analyses_used: number; deep_credits_used: number }
    | null
  return {
    videoAnalysesUsed: row?.video_analyses_used ?? 0,
    deepCreditsUsed: row?.deep_credits_used ?? 0,
  }
}

// Atomically adds to a user's tally for a window and returns the new totals.
// Backed by the increment_usage_counters SQL function so concurrent consumers
// can't lose an increment to a read-modify-write race.
export async function incrementUsage(
  userId: string,
  periodStart: Date,
  delta: { videoAnalyses?: number; deepCredits?: number },
): Promise<Usage> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("increment_usage_counters", {
    p_user_id: userId,
    p_period_start: periodStart.toISOString(),
    p_video_analyses: delta.videoAnalyses ?? 0,
    p_deep_credits: delta.deepCredits ?? 0,
  })

  if (error) {
    throw new Error(`Failed to increment usage: ${error.message}`)
  }
  const row = (data as Usage[] | null)?.[0]
  return {
    videoAnalysesUsed: row?.videoAnalysesUsed ?? 0,
    deepCreditsUsed: row?.deepCreditsUsed ?? 0,
  }
}

// Hands back usage that was charged for work the user never received: a
// comparison report or a video analysis they abandoned part-way through, which
// is rolled back to the state it was in before they pressed the button. Backed
// by refund_usage_counters, which floors each tally at zero, so a refund that
// arrives twice (the client reporting the abandonment and the server noticing
// the disconnect can both land) never credits more than was spent.
//
// Only refund a charge whose work was actually undone. The callers all follow
// the same rule: the row the run created is deleted first, and the refund only
// follows when that delete removed something.
export async function refundUsage(
  userId: string,
  periodStart: Date,
  delta: { videoAnalyses?: number; deepCredits?: number },
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.rpc("refund_usage_counters", {
    p_user_id: userId,
    p_period_start: periodStart.toISOString(),
    p_video_analyses: delta.videoAnalyses ?? 0,
    p_deep_credits: delta.deepCredits ?? 0,
  })

  if (error) {
    throw new Error(`Failed to refund usage: ${error.message}`)
  }
}

// A resolved view of one meter: the plan's allowance, how much is used, and
// what's left. `unlimited` short-circuits every check.
export type MeterStatus = {
  limit: number | "unlimited"
  used: number
  remaining: number
  unlimited: boolean
}

function meter(limit: number | "unlimited", used: number): MeterStatus {
  if (limit === "unlimited") {
    return { limit, used, remaining: Number.POSITIVE_INFINITY, unlimited: true }
  }
  return { limit, used, remaining: Math.max(0, limit - used), unlimited: false }
}

// The full billing snapshot for a user: plan, window, and both meters. Used by
// the settings page and the pre-flight checks below.
export type BillingSnapshot = Entitlement & {
  videoAnalyses: MeterStatus
  deepCredits: MeterStatus
}

export async function getBillingSnapshot(
  userId: string,
  now: Date = new Date(),
): Promise<BillingSnapshot> {
  const entitlement = await getEntitlement(userId, now)
  const usage = await getUsageForWindow(userId, entitlement.periodStart)
  return {
    ...entitlement,
    videoAnalyses: meter(
      entitlement.plan.videoAnalysesPerMonth,
      usage.videoAnalysesUsed,
    ),
    deepCredits: meter(
      entitlement.plan.deepCreditsPerMonth,
      usage.deepCreditsUsed,
    ),
  }
}

// --- Pre-flight checks used by the enforcement points ----------------------

export type LimitCheck =
  | { allowed: true; entitlement: Entitlement }
  | { allowed: false; reason: LimitReason; message: string; entitlement: Entitlement }

export type LimitReason =
  | "video_analysis_limit_reached"
  | "uploads_not_included"
  | "file_too_large"
  | "insufficient_credits"

// Can the user start one more shallow (YouTube-API) video analysis this window?
export async function checkVideoAnalysisAllowed(
  userId: string,
  now: Date = new Date(),
): Promise<LimitCheck> {
  const entitlement = await getEntitlement(userId, now)
  const limit = entitlement.plan.videoAnalysesPerMonth
  if (limit === "unlimited") return { allowed: true, entitlement }

  const usage = await getUsageForWindow(userId, entitlement.periodStart)
  if (usage.videoAnalysesUsed >= limit) {
    return {
      allowed: false,
      reason: "video_analysis_limit_reached",
      message: `You've used all ${limit} video analyses on your ${entitlement.plan.name} plan this period. Upgrade your plan or wait until your next billing cycle.`,
      entitlement,
    }
  }
  return { allowed: true, entitlement }
}

// Formats a billing-window boundary as a friendly date ("18 August 2026") for
// user-facing copy. Uses UTC so the day matches the stored window boundary
// regardless of the server's local timezone.
function formatResetDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

// The refusal shown wherever a plan without uploads meets the upload path: the
// initiate route turning one away, and the completion route refusing an upload
// that was started on a paid plan and landed after a downgrade. Both point at
// the same fix, which is the upgrade prompt the report itself offers.
export function uploadsNotIncludedMessage(plan: Plan): string {
  return `Source-file uploads aren't included on the ${plan.name} plan. Upgrade to Starter or Pro to analyse your footage frame-by-frame.`
}

// Can the user upload a source file of `sizeBytes` for a video of
// `durationSeconds`? Enforces three things in order: the plan must include
// uploads at all, the file must fit the plan's size cap, and the user must have
// enough deep-dive credits left for the footage's runtime.
export async function checkUploadAllowed(
  userId: string,
  input: { sizeBytes: number | null; durationSeconds: number },
  now: Date = new Date(),
): Promise<LimitCheck> {
  const entitlement = await getEntitlement(userId, now)
  const plan = entitlement.plan

  const maxBytes = maxUploadBytesForPlan(plan)
  if (maxBytes == null) {
    return {
      allowed: false,
      reason: "uploads_not_included",
      message: uploadsNotIncludedMessage(plan),
      entitlement,
    }
  }

  if (input.sizeBytes != null && input.sizeBytes > maxBytes) {
    return {
      allowed: false,
      reason: "file_too_large",
      message: `That file is larger than the ${plan.maxUploadGb} GB upload limit on your ${plan.name} plan.`,
      entitlement,
    }
  }

  const cost = creditsForDurationSeconds(input.durationSeconds)
  if (cost > 0 && !plan.deepCreditsPerMonth) {
    return {
      allowed: false,
      reason: "insufficient_credits",
      message: `Your ${plan.name} plan has no deep-dive credits.`,
      entitlement,
    }
  }
  if (cost > 0) {
    const usage = await getUsageForWindow(userId, entitlement.periodStart)
    const remaining = plan.deepCreditsPerMonth - usage.deepCreditsUsed
    if (remaining < cost) {
      // Starter is the only tier that can reach this branch with somewhere to go:
      // Free never includes deep-dive credits (handled above) and Pro is the top
      // tier, so only Starter gets the "upgrade to Pro" nudge.
      const upgradeHint = plan.id === "starter" ? ", or upgrade to Pro" : ""
      return {
        allowed: false,
        reason: "insufficient_credits",
        message: `You do not have enough deep-dive credits to analyse this video. Please try again on ${formatResetDate(entitlement.periodEnd)}${upgradeHint}.`,
        entitlement,
      }
    }
  }

  return { allowed: true, entitlement }
}
