import { NextResponse, type NextRequest } from "next/server"
import type Stripe from "stripe"

import { getStripeWebhookSecret, isStripeEnabled } from "@/lib/stripe/config"
import { getStripe } from "@/lib/stripe/stripe"
import { updateCachedCard } from "@/lib/stripe/customers"
import { syncSubscriptionFromStripe } from "@/lib/billing/subscriptions"

// Stripe needs the raw, unparsed request body to verify the event signature, so
// this route reads request.text() directly and must not run on a runtime that
// would buffer/transform it.
export const runtime = "nodejs"

// The card of a payment method object, or null when it isn't a card (or wasn't
// expanded into a full object).
function cardOf(
  paymentMethod: string | Stripe.PaymentMethod | null | undefined,
): Stripe.PaymentMethod.Card | null {
  if (!paymentMethod || typeof paymentMethod === "string") return null
  return paymentMethod.type === "card" ? (paymentMethod.card ?? null) : null
}

// Re-reads the card that future invoices will be charged to and writes it to our
// cache. The customer's invoice_settings default wins; failing that we fall back
// to the payment method on their subscription, which is what subscription-mode
// Checkout sets. Without that fallback a subscriber who paid through Checkout
// can end up with no cached card at all - and since cards are only ever entered
// during Checkout or in the Customer Portal, the settings page would then show
// an empty card for a paying user. Null means "no card on file".
async function syncDefaultCard(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  })

  if (customer.deleted) return

  let card = cardOf(customer.invoice_settings?.default_payment_method)

  if (!card) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
      expand: ["data.default_payment_method"],
    })
    card = cardOf(subscriptions.data[0]?.default_payment_method)
  }

  await updateCachedCard(customerId, card)
}

// POST /api/stripe/webhook
// Verifies the Stripe signature, then keeps our cached default card in sync with
// Stripe. We always ACK 2xx once the signature is valid - throwing a 500 would
// make Stripe retry, and our handlers are idempotent re-reads of Stripe state,
// so a transient failure is fine to swallow after logging.
export async function POST(request: NextRequest) {
  const webhookSecret = getStripeWebhookSecret()
  if (!isStripeEnabled() || !webhookSecret) {
    return NextResponse.json(
      { error: "Billing is not available yet." },
      { status: 503 },
    )
  }

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  const stripe = getStripe()
  const body = await request.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
    )
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      // A "subscription mode" Checkout finished: the subscription now exists.
      // Persist our projection of it so the user's plan + billing window take
      // effect immediately, without waiting for the separate
      // customer.subscription.created event. The card the user just entered is
      // cached here too - Checkout is the only place a card is ever added, so
      // this is what fills the settings page's payment method.
      case "checkout.session.completed": {
        const session = event.data.object
        if (session.mode !== "subscription" || !session.subscription) break

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id
        await syncSubscriptionFromStripe(subscriptionId)

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : (session.customer?.id ?? null)
        if (customerId) await syncDefaultCard(stripe, customerId)
        break
      }

      // The default payment method may have changed in the Customer Portal.
      case "customer.updated": {
        await syncDefaultCard(stripe, event.data.object.id)
        break
      }

      // Subscription lifecycle: created on first purchase, updated at each
      // renewal (advancing current_period_start/end, which resets usage) and on
      // plan changes/cancellation-scheduling, deleted when it finally ends. All
      // three re-read Stripe and reconcile our projection, so they're safe to
      // process in any order and idempotent on retries.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object
        await syncSubscriptionFromStripe(subscription.id)

        // A card swapped in the Customer Portal lands on the subscription, which
        // doesn't always touch invoice_settings (and so doesn't always fire
        // customer.updated). Re-read here so the cached card follows it.
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : (subscription.customer?.id ?? null)
        if (customerId) await syncDefaultCard(stripe, customerId)
        break
      }

      // A card was removed. Re-sync so the cache reflects the new default (or
      // clears when the last card is gone).
      case "payment_method.detached": {
        const previousCustomer =
          event.data.previous_attributes &&
          "customer" in event.data.previous_attributes
            ? event.data.previous_attributes.customer
            : null
        const customerId =
          typeof previousCustomer === "string" ? previousCustomer : null
        if (customerId) await syncDefaultCard(stripe, customerId)
        break
      }

      default:
        break
    }
  } catch (error) {
    // Log and still ACK: Stripe retries on non-2xx, but our handlers just
    // re-read Stripe, so a retry storm wouldn't fix a genuine error here.
    console.error(`Failed handling Stripe event ${event.type}`, error)
  }

  return NextResponse.json({ received: true })
}
