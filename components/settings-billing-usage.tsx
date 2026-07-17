import { DownloadIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react"

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
import type { BillingInvoice } from "@/lib/stripe/invoices"
import { cn } from "@/lib/utils"

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
  invoices,
  billingEnabled,
}: {
  snapshot: BillingSnapshot | null
  paymentCard: BillingCard | null
  invoices: BillingInvoice[]
  billingEnabled: boolean
}) {
  const planName = snapshot?.plan.name ?? "Free"
  const isFree = (snapshot?.planId ?? "free") === "free"
  const isCancelling = Boolean(snapshot?.cancelAtPeriodEnd && !isFree)
  const includesDeepDives = (snapshot?.plan.deepCreditsPerMonth ?? 0) > 0
  const renewsLabel = snapshot ? formatDate(snapshot.periodEnd.toISOString()) : "N/A"
  const renewsCaption = snapshot?.cancelAtPeriodEnd
    ? "Access ends"
    : isFree || snapshot?.billingPeriod === "annual"
      ? "Usage resets"
      : "Renews"
  const planDescription = isCancelling ? (
    <>
      Your {planName} plan has been{" "}
      <span className="underline">cancelled</span>. You keep access until{" "}
      {renewsLabel}, then your account moves to Free.
    </>
  ) : isFree ? (
    "You’re on the Free plan."
  ) : (
    `You’re on the ${planName} plan${
      snapshot?.billingPeriod === "annual" ? ", billed annually." : "."
    }`
  )
  const planStats = [
    {
      label: "Plan",
      value: planName,
      tabular: false,
    },
    {
      label: "Video analyses",
      value: snapshot ? formatMeter(snapshot.videoAnalyses) : "N/A",
      tabular: true,
    },
    ...(includesDeepDives
      ? [
          {
            label: "Deep-dive credits",
            value: snapshot ? formatMeter(snapshot.deepCredits) : "N/A",
            tabular: true,
          },
        ]
      : []),
    {
      label: renewsCaption,
      value: renewsLabel,
      tabular: false,
    },
  ]

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Billing"
        description="Your current plan and usage this period."
      >
        <Card>
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>{planDescription}</CardDescription>
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
          <CardContent
            className={cn(
              "grid gap-3 sm:grid-cols-2",
              includesDeepDives ? "lg:grid-cols-4" : "lg:grid-cols-3",
            )}
          >
            {planStats.map((stat) => (
              <div key={stat.label} className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">{stat.label}</div>
                <div
                  className={cn(
                    "mt-1 font-heading text-lg font-semibold",
                    stat.tabular && "tabular-nums",
                  )}
                >
                  {stat.value}
                </div>
              </div>
            ))}
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
                    <TableHead className="text-right">Invoice</TableHead>
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
                      <TableCell className="text-right">
                        {invoice.url ? (
                          <Button
                            variant="outline"
                            size="sm"
                            render={
                              <a
                                href={invoice.url}
                                target="_blank"
                                rel="noreferrer"
                              />
                            }
                          >
                            {invoice.actionLabel === "Download" ? (
                              <DownloadIcon data-icon="inline-start" />
                            ) : (
                              <ExternalLinkIcon data-icon="inline-start" />
                            )}
                            {invoice.actionLabel}
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Unavailable
                          </span>
                        )}
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
