// Single source of truth for the three subscription tiers shown on the pricing
// page (app/pricing) and referenced from settings billing. Prices are stored in
// pence to avoid floating-point drift; display formatting lives in `formatGbp`.
//
// The deep-analysis budget is metered in credits, where 1 credit = 1 minute of
// raw source video analysed (see CREDITS_TOOLTIP / components/credits-tooltip).
// Shallow (YouTube-API) analysis is metered per video instead, since its cost
// does not scale meaningfully with runtime.

export type BillingPeriod = "monthly" | "annual"

export type PlanId = "free" | "starter" | "pro"

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  // Per-month price when billed monthly, in pence. null for the free plan.
  priceMonthlyPence: number | null
  // Total price for a year when billed annually, in pence. null for free.
  priceAnnualPence: number | null
  // Monthly shallow (YouTube-API) analyses. "unlimited" removes the ceiling.
  videoAnalysesPerMonth: number | "unlimited"
  // Monthly deep-analysis credits (1 credit = 1 minute of source video).
  deepCreditsPerMonth: number
  // Max raw upload size in GB, or null when uploads aren't included.
  maxUploadGb: number | null
  // Human-readable feature bullets rendered on the pricing card.
  features: PlanFeature[]
  // Highlighted as the recommended plan.
  featured?: boolean
}

export interface PlanFeature {
  label: string
  // When true, the label is rendered with the credits tooltip attached.
  credits?: boolean
  // Explanatory copy rendered as an info tooltip on the label. Ignored when
  // `credits` is set, which uses the shared credits tooltip instead.
  tooltip?: string
}

// The explanatory copy for the "Cross-video intelligence" plan feature —
// shown as a tooltip wherever that bullet appears.
export const CROSS_VIDEO_TOOLTIP =
  "Every deep analysis adds its retention events to a private library of your content. As the library grows, your analyses draw on patterns and trends from across your whole channel, not just the video in front of them."

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Kick the tyres on your retention data.",
    priceMonthlyPence: 0,
    priceAnnualPence: 0,
    videoAnalysesPerMonth: 10,
    deepCreditsPerMonth: 0,
    maxUploadGb: null,
    features: [
      { label: "10 video analyses / month" },
      { label: "Basic hookpoint analysis" },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Triage your catalogue, then dig into what matters.",
    priceMonthlyPence: 1500,
    priceAnnualPence: 15000,
    videoAnalysesPerMonth: 30,
    deepCreditsPerMonth: 140,
    maxUploadGb: 10,
    features: [
      { label: "30 video analyses / month" },
      { label: "140 deep-dive credits / month", credits: true },
      { label: "Upload source files up to 10 GB" },
      { label: "Complete hookpoint analysis" },
      { label: "Cross-video intelligence", tooltip: CROSS_VIDEO_TOOLTIP },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Unlimited triage and a serious deep-dive budget.",
    priceMonthlyPence: 2500,
    priceAnnualPence: 20000,
    videoAnalysesPerMonth: "unlimited",
    deepCreditsPerMonth: 280,
    maxUploadGb: 20,
    featured: true,
    features: [
      { label: "Unlimited video analyses" },
      { label: "280 deep-dive credits / month", credits: true },
      { label: "Upload source files up to 20 GB" },
      { label: "Complete hookpoint analysis" },
      { label: "Cross-video intelligence", tooltip: CROSS_VIDEO_TOOLTIP },
      { label: "Priority processing" },
    ],
  },
]

// Fast lookup of a plan by id. Every PlanId is present, so callers that already
// have a valid id can treat the result as non-null.
export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((plan) => [plan.id, plan]),
) as Record<PlanId, Plan>

// The paid tiers, in the order they appear on the pricing page. Free is excluded
// because it has no Stripe price and is never "purchased".
export const PAID_PLAN_IDS: readonly PlanId[] = ["starter", "pro"] as const

export function isPaidPlanId(value: string): value is "starter" | "pro" {
  return value === "starter" || value === "pro"
}

// Returns the plan for an id, defaulting to Free for anything unrecognised so a
// stale/invalid stored plan can never grant more than the free tier.
export function getPlan(planId: string | null | undefined): Plan {
  if (planId && planId in PLAN_BY_ID) return PLAN_BY_ID[planId as PlanId]
  return PLAN_BY_ID.free
}

// Converts a source-video runtime (seconds) into the deep-dive credits its deep
// analysis costs: 1 credit = 1 minute, rounded up so any started minute counts.
// A non-positive/garbage duration costs a single credit floor of 0 so it can
// never be free-but-negative.
export function creditsForDurationSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.ceil(seconds / 60)
}

// The upload size cap for a plan, in bytes, or null when the plan includes no
// uploads at all (the Free tier). Built from the human-facing maxUploadGb.
export function maxUploadBytesForPlan(plan: Plan): number | null {
  if (plan.maxUploadGb == null) return null
  return plan.maxUploadGb * 1024 * 1024 * 1024
}

// The explanatory copy shown wherever "credits" appears in the product.
export const CREDITS_TOOLTIP =
  "1 credit = 1 minute of raw source video analysed."

// Formats a pence amount as GBP, dropping the decimals for whole-pound values
// (£15) and keeping two places otherwise (£16.67).
export function formatGbp(pence: number): string {
  const pounds = pence / 100
  const rounded = Math.round(pounds * 100) / 100
  return `£${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`
}

// The headline price to show for a plan under the selected billing period.
// Annual plans are displayed as the equivalent per-month figure so the three
// cards compare like-for-like; `formatGbp` handles the rounding.
export function monthlyEquivalentPence(
  plan: Plan,
  period: BillingPeriod,
): number | null {
  if (plan.priceMonthlyPence == null || plan.priceAnnualPence == null) {
    return null
  }
  return period === "annual"
    ? plan.priceAnnualPence / 12
    : plan.priceMonthlyPence
}

// Whole-number percentage saved by paying annually vs. twelve monthly charges.
// Returns 0 when the plan is free or has no annual saving.
export function annualSavingPercent(plan: Plan): number {
  if (!plan.priceMonthlyPence || !plan.priceAnnualPence) return 0
  const monthlyYearly = plan.priceMonthlyPence * 12
  if (monthlyYearly <= 0) return 0
  return Math.round(((monthlyYearly - plan.priceAnnualPence) / monthlyYearly) * 100)
}
