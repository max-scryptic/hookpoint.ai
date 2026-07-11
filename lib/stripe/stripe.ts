import Stripe from "stripe"

import { getStripeSecretKey } from "@/lib/stripe/config"

// Server-only Stripe client. The secret key must never reach the browser, so
// this module is only imported from route handlers / server code. Throws if
// Stripe isn't configured; callers should gate on `isStripeEnabled()` first.
let cached: Stripe | null = null

export function getStripe(): Stripe {
  if (cached) return cached

  const secretKey = getStripeSecretKey()
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY env var")
  }

  // Pin the API version so Stripe dashboard upgrades can't silently change the
  // shape of the objects this code reads. Bump deliberately alongside the SDK.
  cached = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" })
  return cached
}
