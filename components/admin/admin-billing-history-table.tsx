import { DownloadIcon, ExternalLinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BillingInvoice } from "@/lib/stripe/invoices"

// Renders a user's Stripe billing history for the admin detail page. Data comes
// straight from Stripe (via getBillingInvoices), so Stripe stays the source of
// truth for receipts and downloadable PDFs. Styling mirrors the other admin
// tables: a bordered, horizontally scrollable frame around the shared Table.
export function AdminBillingHistoryTable({
  invoices,
}: {
  invoices: BillingInvoice[]
}) {
  if (invoices.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No payments on record for this user.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card dark:bg-transparent">
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
              <TableCell className="text-right font-medium tabular-nums">
                {invoice.amount}
              </TableCell>
              <TableCell className="text-right">
                {invoice.url ? (
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <a href={invoice.url} target="_blank" rel="noreferrer" />
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
    </div>
  )
}
