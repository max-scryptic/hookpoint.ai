import { CreditCardIcon, FileTextIcon } from "lucide-react"

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

// Renders the "Billing & Usage" tab: the current plan / usage summary, plus the
// payment method and invoice history. Usage reflects the user's real analysed
// video count; plan and payment details are placeholders until billing is live.
export function SettingsBillingUsage({
  videosAnalysed,
}: {
  videosAnalysed: number
}) {
  const invoices: Invoice[] = []

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
              You&rsquo;re on the Free plan.
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
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Plan</div>
              <div className="mt-1 font-heading text-lg font-semibold">
                Free
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                Videos analysed
              </div>
              <div className="mt-1 font-heading text-lg font-semibold tabular-nums">
                {videosAnalysed.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Renews</div>
              <div className="mt-1 font-heading text-lg font-semibold">
                &mdash;
              </div>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection
        title="Payments & Invoices"
        description="Manage your payment method and review past invoices."
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCardIcon className="size-4" />
              Payment method
            </CardTitle>
            <CardDescription>
              No payment method on file.
            </CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" disabled>
                Add payment method
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              Add a card to upgrade your plan and unlock paid features.
            </div>
          </CardContent>
        </Card>

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
