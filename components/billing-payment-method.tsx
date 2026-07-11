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

// The "Payment method" card. When Stripe is configured, the button starts a
// Stripe-hosted flow: a Checkout "setup" session to add a first card, or the
// Customer Portal to manage/remove an existing one. Both redirect to Stripe and
// back to /settings; the card shown here is our webhook-synced cache.
export function BillingPaymentMethod({
  card,
  enabled,
}: {
  card: BillingCard | null
  enabled: boolean
}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go(endpoint: "setup-session" | "portal") {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/billing/${endpoint}`, {
        method: "POST",
      })
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

  const actionLabel = card ? "Manage payment method" : "Add payment method"
  const endpoint = card ? "portal" : "setup-session"

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
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled || isLoading}
            onClick={() => go(endpoint)}
          >
            {isLoading ? "Redirecting…" : actionLabel}
          </Button>
        </CardAction>
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
              : "Add a card to upgrade your plan and unlock paid features."}
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
