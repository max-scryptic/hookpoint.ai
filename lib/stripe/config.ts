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
