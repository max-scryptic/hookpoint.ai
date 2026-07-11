import type Stripe from "stripe"

import { createAdminClient } from "@/lib/supabase/admin"
import { getStripe } from "@/lib/stripe/stripe"
import { resolvePlanFromPriceId } from "@/lib/stripe/config"
import type { BillingPeriod } from "@/lib/plans"

// The projection of a user's Stripe subscription we persist. Stripe is the
// source of truth; this is the read-model the app resolves entitlements from
// without a live Stripe call on every request.
export type SubscriptionRecord = {
  userId: string
  stripeSubscriptionId: string
  stripeCustomerId: string
  planId: "starter" | "pro"
  billingPeriod: BillingPeriod
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
}

type SubscriptionRow = {
  user_id: string
  stripe_subscription_id: string
  stripe_customer_id: string
  plan_id: "starter" | "pro"
  billing_period: BillingPeriod
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
}

function mapRow(row: SubscriptionRow): SubscriptionRecord {
  return {
    userId: row.user_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    planId: row.plan_id,
    billingPeriod: row.billing_period,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  }
}

const COLUMNS =
  "user_id, stripe_subscription_id, stripe_customer_id, plan_id, billing_period, status, current_period_start, current_period_end, cancel_at_period_end"

// Loads a user's stored subscription, or null when they have none (Free plan).
export async function getSubscriptionForUser(
  userId: string,
): Promise<SubscriptionRecord | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("billing_subscriptions")
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load subscription: ${error.message}`)
  }
  return data ? mapRow(data as SubscriptionRow) : null
}

// Maps a Stripe customer id back to our app user via the billing_customers
// mapping written when the customer was created. Returns null if we've never
// seen that customer (e.g. a subscription created directly in the dashboard).
async function findUserIdForCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to resolve customer: ${error.message}`)
  }
  return (data as { user_id: string } | null)?.user_id ?? null
}

// Stripe moved the billing period onto subscription items in recent API
// versions, but older shapes keep it on the subscription. Read whichever is
// present so this survives an API-version bump either way.
function readPeriod(subscription: Stripe.Subscription): {
  start: number
  end: number
} | null {
  const item = subscription.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined
  const legacy = subscription as unknown as {
    current_period_start?: number
    current_period_end?: number
  }
  const start = item?.current_period_start ?? legacy.current_period_start
  const end = item?.current_period_end ?? legacy.current_period_end
  if (typeof start !== "number" || typeof end !== "number") return null
  return { start, end }
}

// Resolve which plan + period a subscription is for. Prefer the price id (the
// authoritative mapping), then fall back to the metadata we stamp at checkout so
// a subscription still resolves if its price isn't in our env map.
function resolvePlan(subscription: Stripe.Subscription): {
  planId: "starter" | "pro"
  period: BillingPeriod
} | null {
  const priceId = subscription.items?.data?.[0]?.price?.id
  if (priceId) {
    const fromPrice = resolvePlanFromPriceId(priceId)
    if (fromPrice) return fromPrice
  }

  const metaPlan = subscription.metadata?.plan_id
  const metaPeriod = subscription.metadata?.period
  if (
    (metaPlan === "starter" || metaPlan === "pro") &&
    (metaPeriod === "monthly" || metaPeriod === "annual")
  ) {
    return { planId: metaPlan, period: metaPeriod }
  }
  return null
}

// Statuses that keep the paid plan alive. Anything else (canceled, unpaid,
// incomplete_expired) means the user should fall back to Free, so we delete the
// projection rather than store a plan they no longer have.
const ACTIVE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
])

// Upserts the local projection of a Stripe subscription. Called by the webhook
// on create/update/checkout-complete and by the checkout success redirect.
// Retrieves a fresh copy from Stripe (the event payload can be partial), maps it
// to a user, and either stores the current window or, for an ended subscription,
// removes the row so the user reverts to Free.
export async function syncSubscriptionFromStripe(
  subscriptionId: string,
): Promise<void> {
  const stripe = getStripe()
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id

  const userId =
    subscription.metadata?.app_user_id ??
    (await findUserIdForCustomer(customerId))
  if (!userId) {
    console.error(
      `No app user for Stripe subscription ${subscriptionId} (customer ${customerId})`,
    )
    return
  }

  const admin = createAdminClient()

  // Subscription no longer grants access → drop the projection so entitlement
  // resolution falls back to Free.
  if (
    subscription.status === "canceled" ||
    subscription.status === "incomplete_expired" ||
    subscription.status === "unpaid" ||
    !ACTIVE_STATUSES.has(subscription.status)
  ) {
    const { error } = await admin
      .from("billing_subscriptions")
      .delete()
      .eq("user_id", userId)
    if (error) {
      throw new Error(`Failed to remove subscription: ${error.message}`)
    }
    return
  }

  const plan = resolvePlan(subscription)
  const period = readPeriod(subscription)
  if (!plan || !period) {
    console.error(
      `Could not resolve plan/period for subscription ${subscriptionId}`,
    )
    return
  }

  const { error } = await admin.from("billing_subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId,
      plan_id: plan.planId,
      billing_period: plan.period,
      status: subscription.status,
      current_period_start: new Date(period.start * 1000).toISOString(),
      current_period_end: new Date(period.end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    },
    { onConflict: "user_id" },
  )
  if (error) {
    throw new Error(`Failed to upsert subscription: ${error.message}`)
  }
}
