import { NextResponse, type NextRequest } from "next/server"
import type Stripe from "stripe"

import { getStripeWebhookSecret, isStripeEnabled } from "@/lib/stripe/config"
import { getStripe } from "@/lib/stripe/stripe"
import { updateCachedCard } from "@/lib/stripe/customers"

// Stripe needs the raw, unparsed request body to verify the event signature, so
// this route reads request.text() directly and must not run on a runtime that
// would buffer/transform it.
export const runtime = "nodejs"

// Re-reads the customer's current default card from Stripe and writes it to our
// cache. Clearing (no default) is expressed by passing null, which the settings
// page renders as "no payment method on file".
async function syncDefaultCard(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  })

  if (customer.deleted) return

  const defaultPm = customer.invoice_settings?.default_payment_method
  const card =
    defaultPm && typeof defaultPm !== "string" && defaultPm.type === "card"
      ? (defaultPm.card ?? null)
      : null

  await updateCachedCard(customerId, card)
}

// POST /api/stripe/webhook
// Verifies the Stripe signature, then keeps our cached default card in sync with
// Stripe. We always ACK 2xx once the signature is valid — throwing a 500 would
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
      case "checkout.session.completed": {
        // A "setup mode" Checkout finished: the card is saved to the customer
        // but not yet their default. Promote it, then cache it.
        const session = event.data.object
        if (session.mode !== "setup" || !session.setup_intent) break

        const setupIntentId =
          typeof session.setup_intent === "string"
            ? session.setup_intent
            : session.setup_intent.id
        const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)

        const customerId =
          typeof setupIntent.customer === "string"
            ? setupIntent.customer
            : (setupIntent.customer?.id ?? null)
        const paymentMethodId =
          typeof setupIntent.payment_method === "string"
            ? setupIntent.payment_method
            : (setupIntent.payment_method?.id ?? null)

        if (!customerId || !paymentMethodId) break

        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        })
        await syncDefaultCard(stripe, customerId)
        break
      }

      // The default payment method may have changed in the Customer Portal.
      case "customer.updated": {
        await syncDefaultCard(stripe, event.data.object.id)
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
