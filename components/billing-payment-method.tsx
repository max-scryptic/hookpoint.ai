"use client"

import { useState } from "react"
import { CreditCardIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CardBrandLogo } from "@/components/ui/card-brand-logo"
import type { BillingCard } from "@/lib/stripe/customers"

// Formats "visa" → "Visa" for display; brands arrive from Stripe lowercased.
function formatBrand(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

// The "Payment method" card, always rendered so the "Payments & Invoices"
// heading has both of its cards beneath it on every plan. Cards are never added
// here: a card arrives with the subscription itself, entered during the Stripe
// Checkout that pays for the plan. All this offers is the Stripe Customer
// Portal, where a subscriber can replace the card that future renewals will be
// charged to - so on Free the card is an empty state with no action. The card
// shown is our webhook-synced cache.
export function BillingPaymentMethod({
  card,
  enabled,
  isSubscriber,
}: {
  card: BillingCard | null
  enabled: boolean
  isSubscriber: boolean
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openPortal() {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" })
      const data = (await response.json()) as { url?: string; error?: string }
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "Something went wrong.")
      }
      // On success the browser leaves for Stripe, so we don't reset loading.
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setIsLoading(false)
    }
  }

  const expiry =
    card?.expMonth && card.expYear
      ? `Expires ${String(card.expMonth).padStart(2, "0")}/${card.expYear}`
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCardIcon className="size-4" />
          Payment method
        </CardTitle>
        {/* Offered to subscribers, and to anyone with a card still on file (a
            cancelled plan leaves one behind) so it can be removed. With neither
            there is nothing to manage: the portal would open on a customer with
            no card and no renewal to change. */}
        {isSubscriber || card ? (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={!enabled || isLoading}
              onClick={openPortal}
            >
              {isLoading ? "Redirecting…" : "Manage payment method"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {card ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <CardBrandLogo brand={card.brand} className="h-6 w-9" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span>{formatBrand(card.brand)}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  •••• {card.last4}
                </span>
                <span className="sr-only">ending in {card.last4}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {expiry ?? "On file"}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            {!enabled
              ? "Card payments aren’t enabled yet."
              : isSubscriber
                ? "We couldn’t load the card on your subscription. Open the billing portal to review it."
                : "No payment method on file. You’ll add a card when you upgrade to a paid plan."}
          </div>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
