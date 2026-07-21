import type Stripe from "stripe"

import { getStripe } from "@/lib/stripe/stripe"
import { getStripeCustomerIdForUser } from "@/lib/stripe/customers"

export type BillingInvoice = {
  id: string
  date: string
  description: string
  amount: string
  status: string
  url: string | null
  actionLabel: "Download" | "View"
}

const INVOICE_LIMIT = 12

function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "-"
  return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatAmount(invoice: Stripe.Invoice): string {
  const amount = invoice.amount_paid || invoice.amount_due || invoice.total || 0
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: invoice.currency.toUpperCase(),
  }).format(amount / 100)
}

function formatStatus(status: Stripe.Invoice.Status | null): string {
  if (!status) return "Unknown"
  return status.replace(/_/g, " ").replace(/^\w/, (match) => match.toUpperCase())
}

function getDescription(invoice: Stripe.Invoice): string {
  if (invoice.description) return invoice.description
  if (invoice.number) return `Invoice ${invoice.number}`
  return "Subscription invoice"
}

function mapInvoice(invoice: Stripe.Invoice): BillingInvoice {
  const pdfUrl = invoice.invoice_pdf ?? null
  const hostedUrl = invoice.hosted_invoice_url ?? null

  return {
    id: invoice.id,
    date: formatDate(invoice.created),
    description: getDescription(invoice),
    amount: formatAmount(invoice),
    status: formatStatus(invoice.status),
    url: pdfUrl ?? hostedUrl,
    actionLabel: pdfUrl ? "Download" : "View",
  }
}

// Reads recent invoices directly from Stripe so Stripe remains the source of
// truth for receipt/payment history and downloadable PDFs.
export async function getBillingInvoices(
  userId: string,
): Promise<BillingInvoice[]> {
  const customerId = await getStripeCustomerIdForUser(userId)
  if (!customerId) return []

  const stripe = getStripe()
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: INVOICE_LIMIT,
  })

  return invoices.data.map(mapInvoice)
}

// The total amount a user has actually paid us, summed across every one of
// their invoices (not just the recent page the history table shows). Kept in
// the smallest currency unit (pence) alongside the currency code, since Stripe
// reports both and the admin view formats them together. Returns null when the
// user has no Stripe customer (never billed) so callers can render "—".
export type UserRevenue = {
  // Total paid, in the smallest currency unit (e.g. pence for GBP).
  totalMinorUnits: number
  // Lower-case ISO currency of the paid invoices (e.g. "gbp"). Null when there
  // are none. Multi-currency accounts aren't expected here; the first paid
  // invoice's currency is reported.
  currency: string | null
}

export async function getUserRevenue(userId: string): Promise<UserRevenue | null> {
  const customerId = await getStripeCustomerIdForUser(userId)
  if (!customerId) return null

  const stripe = getStripe()

  let totalMinorUnits = 0
  let currency: string | null = null

  // Page through every invoice so the total reflects the account's whole
  // history, not just the most recent page. amount_paid already excludes
  // refunds and unpaid/void invoices, so summing it gives net collected.
  for await (const invoice of stripe.invoices.list({
    customer: customerId,
    limit: 100,
  })) {
    if (invoice.amount_paid > 0) {
      totalMinorUnits += invoice.amount_paid
      currency ??= invoice.currency
    }
  }

  return { totalMinorUnits, currency }
}
