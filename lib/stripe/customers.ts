import type Stripe from "stripe"

import { createAdminClient } from "@/lib/supabase/admin"
import { getStripe } from "@/lib/stripe/stripe"

// The default card we cache for a user, as rendered on the billing settings
// page. Null fields mean "no card on file yet".
export type BillingCard = {
  brand: string
  last4: string
  expMonth: number | null
  expYear: number | null
}

type BillingCustomerRow = {
  stripe_customer_id: string
  card_brand: string | null
  card_last4: string | null
  card_exp_month: number | null
  card_exp_year: number | null
}

async function loadBillingCustomer(
  userId: string,
): Promise<BillingCustomerRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("billing_customers")
    .select(
      "stripe_customer_id, card_brand, card_last4, card_exp_month, card_exp_year",
    )
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load billing customer: ${error.message}`)
  }

  return (data as BillingCustomerRow | null) ?? null
}

// Returns the existing Stripe Customer id for a user without creating one.
// Useful for read-only views such as invoice history.
export async function getStripeCustomerIdForUser(
  userId: string,
): Promise<string | null> {
  const existing = await loadBillingCustomer(userId)
  return existing?.stripe_customer_id ?? null
}

// Returns the Stripe Customer id for a user, creating the Customer (and the
// mapping row) on first use. `email` is attached so the customer is
// recognisable in the Stripe dashboard. Concurrent first-time calls are made
// safe by upserting on the unique user_id and re-reading the winner's id.
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string | null,
): Promise<string> {
  const existing = await loadBillingCustomer(userId)
  if (existing) return existing.stripe_customer_id

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    // Lets us trace a Stripe customer back to the app user (e.g. from the
    // dashboard, or when reconciling a webhook that lacks our row yet).
    metadata: { app_user_id: userId },
  })

  const admin = createAdminClient()
  const { error } = await admin
    .from("billing_customers")
    .insert({ user_id: userId, stripe_customer_id: customer.id })

  if (error) {
    // A concurrent request won the insert. Clean up the customer we just made
    // (the other one is now canonical) and return the stored id.
    const row = await loadBillingCustomer(userId)
    if (row) {
      await stripe.customers.del(customer.id).catch(() => {})
      return row.stripe_customer_id
    }
    throw new Error(`Failed to save billing customer: ${error.message}`)
  }

  return customer.id
}

// Reads the cached default card for the settings page. Returns null when the
// user has no billing customer yet or no card on file.
export async function getBillingCard(userId: string): Promise<BillingCard | null> {
  const row = await loadBillingCustomer(userId)
  if (!row?.card_brand || !row.card_last4) return null

  return {
    brand: row.card_brand,
    last4: row.card_last4,
    expMonth: row.card_exp_month,
    expYear: row.card_exp_year,
  }
}

// Upserts the cached default card for a Stripe customer, keyed by the Stripe
// customer id (that's what the webhook payload gives us). Called from the
// webhook when a payment method is attached or the default changes; pass null
// to clear the cache when the card is removed.
export async function updateCachedCard(
  stripeCustomerId: string,
  card: Stripe.PaymentMethod.Card | null,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from("billing_customers")
    .update({
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      card_exp_month: card?.exp_month ?? null,
      card_exp_year: card?.exp_year ?? null,
    })
    .eq("stripe_customer_id", stripeCustomerId)

  if (error) {
    throw new Error(`Failed to update cached card: ${error.message}`)
  }
}
