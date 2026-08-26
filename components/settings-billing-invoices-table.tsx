"use client"

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
import {
  TablePagination,
  usePagination,
} from "@/components/ui/table-pagination"
import type { BillingInvoice } from "@/lib/stripe/invoices"

// The user-facing invoices table on the billing settings page. Split out from
// the (server-rendered) settings page so it can paginate client-side at the
// shared app-wide page size. Callers guarantee a non-empty list - the empty
// state lives in the settings page alongside its illustration.
export function SettingsBillingInvoicesTable({
  invoices,
}: {
  invoices: BillingInvoice[]
}) {
  const { pageRows, currentPage, pageCount, setPageNumber } =
    usePagination(invoices)

  return (
    <div className="space-y-4">
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
          {pageRows.map((invoice) => (
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
      <TablePagination
        currentPage={currentPage}
        pageCount={pageCount}
        onPageChange={setPageNumber}
      />
    </div>
  )
}
