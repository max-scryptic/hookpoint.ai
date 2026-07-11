// Env-driven configuration for the Stripe billing integration. The whole
// feature is gated by `isStripeEnabled()`: with no secret key configured the
// billing UI shows its "billing isn't available yet" state and the API routes
// return 503, so this can ship dark and be switched on by setting env vars.

export function getStripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY || null
}

// Signing secret for the webhook endpoint (Stripe Dashboard → Developers →
// Webhooks → your endpoint → "Signing secret", or `stripe listen` locally).
// Used to verify that webhook events genuinely came from Stripe.
export function getStripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null
}

// True when Stripe is configured enough to create Checkout/Portal sessions.
// The webhook secret is only needed by the webhook route, so it's checked
// there rather than gating the whole feature.
export function isStripeEnabled(): boolean {
  return getStripeSecretKey() != null && getAppBaseUrl() != null
}

// Public base URL of this app, used to build the success/cancel/return URLs
// Stripe redirects back to. Mirrors the resolver in
// lib/source-files/normalisation-config.ts (APP_BASE_URL, then Vercel's
// deployment URL) so both features agree on where "this app" lives.
export function getAppBaseUrl(): string | null {
  const explicit = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`
  return null
}

// The settings page users are sent back to after adding/managing a card. Stripe
// requires absolute URLs for redirects, so build them from the base URL.
export function getBillingReturnUrl(status?: "added" | "cancelled"): string {
  const base = getAppBaseUrl() ?? ""
  const url = new URL("/settings", base || "http://localhost:3000")
  if (status) url.searchParams.set("billing", status)
  return url.toString()
}

// Where Stripe returns the user after a subscription Checkout. Success first
// lands on a route that syncs the subscription, then redirects to the dashboard
// with a flag the UI uses to show a confirmation. Cancel comes back to pricing.
export function getSubscriptionReturnUrl(status: "success" | "cancelled"): string {
  const base = getAppBaseUrl() ?? ""
  const url = new URL(
    status === "success" ? "/api/billing/checkout/success" : "/pricing",
    base || "http://localhost:3000",
  )
  url.searchParams.set("checkout", status)
  if (status === "success") {
    url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}")
  }
  return url.toString()
}

// --- Plan ↔ Stripe Price mapping -------------------------------------------
// Stripe Prices are created in the Stripe Dashboard (one per plan × billing
// period) and their ids supplied via env, so nothing here is hard-coded to a
// particular Stripe account. The Free plan has no price. A missing env var means
// that plan/period simply can't be purchased yet (the checkout route 400s).

import type { BillingPeriod, PlanId } from "@/lib/plans"

type PaidPlanId = "starter" | "pro"

const PRICE_ENV_VARS: Record<PaidPlanId, Record<BillingPeriod, string>> = {
  starter: {
    monthly: "STRIPE_PRICE_STARTER_MONTHLY",
    annual: "STRIPE_PRICE_STARTER_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    annual: "STRIPE_PRICE_PRO_ANNUAL",
  },
}

// The configured Stripe Price id for a paid plan + period, or null when that
// combination hasn't been wired up in the environment.
export function getStripePriceId(
  planId: PaidPlanId,
  period: BillingPeriod,
): string | null {
  return process.env[PRICE_ENV_VARS[planId][period]] || null
}

// The reverse lookup used by the webhook: given a Stripe Price id from an
// incoming subscription, which plan + period does it represent? Returns null for
// an unrecognised price so the webhook can fall back to the subscription's
// checkout metadata.
export function resolvePlanFromPriceId(
  priceId: string,
): { planId: PaidPlanId; period: BillingPeriod } | null {
  for (const planId of ["starter", "pro"] as PaidPlanId[]) {
    for (const period of ["monthly", "annual"] as BillingPeriod[]) {
      if (getStripePriceId(planId, period) === priceId) {
        return { planId, period }
      }
    }
  }
  return null
}

// True when a plan id refers to a purchasable paid tier.
export function isPurchasablePlan(planId: PlanId): planId is PaidPlanId {
  return planId === "starter" || planId === "pro"
}
