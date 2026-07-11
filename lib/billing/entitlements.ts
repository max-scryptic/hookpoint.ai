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
  type Plan,
  type PlanId,
} from "@/lib/plans"
import type { BillingPeriod } from "@/lib/plans"
import { getSubscriptionForUser } from "@/lib/billing/subscriptions"

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
  // The active billing window. Usage counters are keyed on periodStart, so a new
  // window automatically starts every tally at zero.
  periodStart: Date
  periodEnd: Date
  // "paid" when a Stripe subscription is driving the window, "free" when it is
  // anchored to the account creation date.
  source: "paid" | "free"
  billingPeriod: BillingPeriod | null
  cancelAtPeriodEnd: boolean
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
export function computeFreePeriodWindow(
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

// Resolves the user's effective plan and billing window. A live, entitling
// subscription drives the plan and window from Stripe's period; otherwise the
// user is Free with a window anchored to their account creation date.
export async function getEntitlement(
  userId: string,
  now: Date = new Date(),
): Promise<Entitlement> {
  const subscription = await getSubscriptionForUser(userId)

  if (subscription && subscriptionGrantsPaidAccess(subscription, now)) {
    return {
      planId: subscription.planId,
      plan: getPlan(subscription.planId),
      periodStart: new Date(subscription.currentPeriodStart),
      periodEnd: new Date(subscription.currentPeriodEnd),
      source: "paid",
      billingPeriod: subscription.billingPeriod,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    }
  }

  const anchor = await getAccountCreatedAt(userId)
  const { start, end } = computeFreePeriodWindow(anchor, now)
  return {
    planId: "free",
    plan: getPlan("free"),
    periodStart: start,
    periodEnd: end,
    source: "free",
    billingPeriod: null,
    cancelAtPeriodEnd: false,
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
      message: `Source-file uploads aren't included on the ${plan.name} plan. Upgrade to Starter or Pro to analyse your footage frame-by-frame.`,
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
      return {
        allowed: false,
        reason: "insufficient_credits",
        message: `This ${Math.ceil(input.durationSeconds / 60)}-minute video needs ${cost} deep-dive credits but you only have ${Math.max(0, remaining)} left this period.`,
        entitlement,
      }
    }
  }

  return { allowed: true, entitlement }
}
