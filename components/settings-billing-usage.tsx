import { FileTextIcon } from "lucide-react"

import { BillingPaymentMethod } from "@/components/billing-payment-method"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BillingCard } from "@/lib/stripe/customers"
import type { BillingSnapshot, MeterStatus } from "@/lib/billing/entitlements"

// A single invoice row. There is no billing backend wired up yet, so the list
// is empty for now and the table renders its empty state.
type Invoice = {
  id: string
  date: string
  description: string
  amount: string
  status: string
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

// Formats a meter as "used / limit" (or "used / ∞" for unlimited tiers).
function formatMeter(meter: MeterStatus): string {
  const used = meter.used.toLocaleString()
  if (meter.unlimited) return `${used} / ∞`
  return `${used} / ${(meter.limit as number).toLocaleString()}`
}

// Formats the billing-window end date for display, e.g. "11 Aug 2026".
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

// Renders the "Billing & Usage" tab: the current plan / usage summary, plus the
// payment method and invoice history. The plan, usage meters and renewal date
// all come from the live billing snapshot; a null snapshot degrades to the Free
// defaults so the page still renders if the lookup failed.
export function SettingsBillingUsage({
  snapshot,
  paymentCard,
  billingEnabled,
}: {
  snapshot: BillingSnapshot | null
  paymentCard: BillingCard | null
  billingEnabled: boolean
}) {
  const invoices: Invoice[] = []

  const planName = snapshot?.plan.name ?? "Free"
  const isFree = (snapshot?.planId ?? "free") === "free"
  const renewsLabel = snapshot ? formatDate(snapshot.periodEnd.toISOString()) : "—"
  const renewsCaption = snapshot?.cancelAtPeriodEnd
    ? "Cancels on"
    : isFree
      ? "Resets"
      : "Renews"

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Billing"
        description="Your current plan and usage this period."
      >
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>
              {isFree
                ? "You’re on the Free plan."
                : `You’re on the ${planName} plan${
                    snapshot?.billingPeriod === "annual"
                      ? ", billed annually."
                      : "."
                  }`}
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                render={<a href="/pricing" />}
              >
                Manage plan
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Plan</div>
              <div className="mt-1 font-heading text-lg font-semibold">
                {planName}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                Video analyses
              </div>
              <div className="mt-1 font-heading text-lg font-semibold tabular-nums">
                {snapshot ? formatMeter(snapshot.videoAnalyses) : "—"}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                Deep-dive credits
              </div>
              <div className="mt-1 font-heading text-lg font-semibold tabular-nums">
                {snapshot ? formatMeter(snapshot.deepCredits) : "—"}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">{renewsCaption}</div>
              <div className="mt-1 font-heading text-lg font-semibold">
                {renewsLabel}
              </div>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection
        title="Payments & Invoices"
        description="Manage your payment method and review past invoices."
      >
        <BillingPaymentMethod card={paymentCard} enabled={billingEnabled} />

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              A record of your past payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center">
                <FileTextIcon className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No invoices yet</p>
                <p className="text-sm text-muted-foreground">
                  Invoices will appear here once you&rsquo;re on a paid plan.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>{invoice.date}</TableCell>
                      <TableCell>{invoice.description}</TableCell>
                      <TableCell>{invoice.status}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {invoice.amount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
    </div>
  )
}
