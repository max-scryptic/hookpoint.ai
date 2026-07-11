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
}

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
      { label: "Retention curve & drop-off detection" },
      { label: "Basic hookpoint analysis" },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Triage your catalogue, then dig into what matters.",
    priceMonthlyPence: 1500,
    priceAnnualPence: 12000,
    videoAnalysesPerMonth: 30,
    deepCreditsPerMonth: 140,
    maxUploadGb: 10,
    features: [
      { label: "30 video analyses / month" },
      { label: "140 deep-dive credits / month", credits: true },
      { label: "Upload source files up to 10 GB" },
      { label: "Complete hookpoint analysis" },
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
      { label: "Priority processing" },
    ],
  },
]

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
