"use client"

import * as React from "react"
import { format } from "date-fns"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, GiftIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { PlanGrant } from "@/lib/billing/plan-grants"

// The tiers a gift can hand over. Free is the absence of a gift, so it is not
// one of them: taking a plan away is the Revoke button, not a plan choice.
const PLAN_OPTIONS = [
  { value: "pro", label: "Pro" },
  { value: "starter", label: "Starter" },
] as const

// How long a gift runs. "No expiry" is the one a permanent test account wants;
// the dated options exist so a trial or a support make-good takes itself away
// again without anyone having to remember to.
const DURATION_OPTIONS = [
  { value: 0, label: "No expiry" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
] as const

function formatDate(iso: string): string {
  return format(new Date(iso), "d MMM yyyy")
}

// Describes the grant on the account in one line: which plan, since when, and
// whether it runs out. A grant that has already lapsed says so rather than
// looking live, since the row is kept until an admin clears it.
function describeGrant(grant: PlanGrant, now: Date): string {
  const lapsed =
    grant.expiresAt != null && new Date(grant.expiresAt).getTime() <= now.getTime()
  const planName = grant.planId === "pro" ? "Pro" : "Starter"
  const since = `granted ${formatDate(grant.startsAt)}`
  if (!grant.expiresAt) return `${planName}, ${since}. No expiry.`
  return lapsed
    ? `${planName}, ${since}. Lapsed ${formatDate(grant.expiresAt)}.`
    : `${planName}, ${since}. Ends ${formatDate(grant.expiresAt)}.`
}

// The "Complimentary plan" card on a user's admin detail page: hands an account
// a paid tier without any money changing hands, and takes it away again.
//
// Writes go to /api/admin/plan-grants, which re-checks that the caller is an
// admin. The grant is stored outside the Stripe projection, so gifting an
// account a plan neither creates a subscription nor disturbs one it already
// has; revoking drops it straight back to whatever it would have had anyway.
export function AdminPlanGrantCard({
  userId,
  grant,
  isEffective,
  effectivePlanName,
}: {
  userId: string
  grant: PlanGrant | null
  // Whether the grant is the thing actually entitling this account right now.
  // A grant the account's own paid subscription outranks is stored but inert,
  // and saying so beats an admin wondering why the plan did not change.
  isEffective: boolean
  effectivePlanName: string
}) {
  const router = useRouter()
  const [planId, setPlanId] = React.useState<string>(grant?.planId ?? "pro")
  const [durationDays, setDurationDays] = React.useState<number>(0)
  const [note, setNote] = React.useState<string>(grant?.note ?? "")
  const [busy, setBusy] = React.useState<"grant" | "revoke" | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const planLabel =
    PLAN_OPTIONS.find((option) => option.value === planId)?.label ?? "Pro"
  const durationLabel =
    DURATION_OPTIONS.find((option) => option.value === durationDays)?.label ??
    "No expiry"

  async function run(action: "grant" | "revoke") {
    setBusy(action)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/admin/plan-grants", {
        method: action === "grant" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "grant"
            ? {
                userId,
                planId,
                // 0 is the "no expiry" choice, which the API takes as null.
                durationDays: durationDays > 0 ? durationDays : null,
                note,
              }
            : { userId },
        ),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        planName?: string
        revoked?: boolean
        error?: string
      }
      if (!response.ok) {
        setError(payload.error ?? "Something went wrong.")
        return
      }
      setMessage(
        action === "grant"
          ? `${payload.planName ?? planLabel} granted.`
          : payload.revoked
            ? "Complimentary plan revoked."
            : "This account had no complimentary plan.",
      )
      // The plan tiles above this card are server-rendered from the live
      // entitlement, so re-render the page rather than patching state here.
      router.refresh()
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Request failed.",
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Complimentary plan</CardTitle>
        <CardDescription>
          Gives this account a paid tier for free, for test accounts and
          make-goods. It is not a Stripe subscription: nobody is charged, no
          invoice is raised, and revoking it drops the account straight back to
          whatever it would have had anyway.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-card p-3 text-sm dark:bg-muted/30">
          {grant ? (
            <>
              <p className="font-medium">{describeGrant(grant, new Date())}</p>
              {grant.note && (
                <p className="mt-1 text-muted-foreground">{grant.note}</p>
              )}
              {!isEffective && (
                <p className="mt-1 text-muted-foreground">
                  Not in effect: this account is on the {effectivePlanName}{" "}
                  plan, which the gift does not beat.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              No complimentary plan. This account is on the {effectivePlanName}{" "}
              plan.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm">
                  {planLabel}
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={planId}
                onValueChange={(value) => setPlanId(value as string)}
              >
                {PLAN_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm">
                  {durationLabel}
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={String(durationDays)}
                onValueChange={(value) => setDurationDays(Number(value))}
              >
                {DURATION_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={String(option.value)}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (internal, optional)"
            aria-label="Why this account is being given a complimentary plan"
            className="h-9 w-full sm:w-72"
            maxLength={500}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy != null} onClick={() => run("grant")}>
            {busy === "grant" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <GiftIcon data-icon="inline-start" />
            )}
            {busy === "grant"
              ? "Saving..."
              : grant
                ? "Update gifted plan"
                : "Gift a plan"}
          </Button>
          {grant && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy != null}
              onClick={() => run("revoke")}
            >
              {busy === "revoke" ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <XIcon data-icon="inline-start" />
              )}
              {busy === "revoke" ? "Revoking..." : "Revoke"}
            </Button>
          )}
        </div>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>
            The account keeps its own usage limits, metered monthly from the day
            the gift was issued. Saving a gift again restarts that month, so an
            account that has spent its allowance can be handed a fresh one.
          </p>
          <p>
            A gift never downgrades anyone: if this account is paying for a
            higher tier, the subscription stays in charge until the gift beats
            it. The billing screen&rsquo;s cancel and change-plan actions belong
            to Stripe, so they do nothing against a gifted plan.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
