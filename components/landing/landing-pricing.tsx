"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckIcon } from "lucide-react"

import {
  annualSavingPercent,
  CREDITS_TOOLTIP,
  formatGbp,
  monthlyEquivalentPence,
  PLANS,
  type BillingPeriod,
  type Plan,
} from "@/lib/plans"
import { cn } from "@/lib/utils"

// The pricing section of the landing page. It reads the same PLANS table the
// in-app pricing page and the billing code read, so a price or a limit is
// changed in one place and every surface follows. The only thing that differs
// here is the button: nobody on this page has an account yet, so each card
// points at sign-up rather than at a checkout session.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export function LandingPricing({
  isAuthenticated,
}: {
  isAuthenticated: boolean
}) {
  const [period, setPeriod] = useState<BillingPeriod>("annual")

  return (
    <div className="space-y-8">
      <BillingToggle period={period} onChange={setPeriod} />

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            period={period}
            isAuthenticated={isAuthenticated}
          />
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Prices in GBP. Cancel or change plan at any time from your settings.
      </p>
    </div>
  )
}

function BillingToggle({
  period,
  onChange,
}: {
  period: BillingPeriod
  onChange: (period: BillingPeriod) => void
}) {
  const saving = Math.max(...PLANS.map(annualSavingPercent))

  return (
    <div className="flex justify-center">
      <div
        role="radiogroup"
        aria-label="Billing period"
        className="inline-flex items-center gap-1 rounded-xl border bg-card p-1"
      >
        {(["monthly", "annual"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={period === option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              period === option
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option === "monthly" ? "Monthly" : "Annual"}
            {option === "annual" && saving > 0 && (
              <span
                className={cn(
                  "ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  period === "annual"
                    ? "bg-primary-foreground/20"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                )}
              >
                Save {saving}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  period,
  isAuthenticated,
}: {
  plan: Plan
  period: BillingPeriod
  isAuthenticated: boolean
}) {
  const pence = monthlyEquivalentPence(plan, period)
  const isFree = plan.id === "free"
  const hasCredits = plan.features.some((feature) => feature.credits)
  // A visitor with no account starts at sign-up whichever card they press; a
  // signed-in reader goes straight to the in-app plan picker where the
  // checkout lives.
  const href = isAuthenticated ? "/pricing" : "/signup"

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card p-6 transition-shadow",
        plan.featured
          ? "border-primary/40 shadow-xl shadow-primary/10 ring-1 ring-primary/20"
          : "hover:shadow-lg"
      )}
    >
      {plan.featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">
          Most popular
        </span>
      )}

      <h3 className="font-heading text-lg font-semibold">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="font-heading text-4xl font-semibold tracking-tight">
          {pence == null || pence === 0 ? "Free" : formatGbp(pence)}
        </span>
        {pence != null && pence > 0 && (
          <span className="text-sm text-muted-foreground">/ month</span>
        )}
      </div>
      <p className="mt-1 h-4 text-xs text-muted-foreground">
        {!isFree &&
          period === "annual" &&
          plan.priceAnnualPence != null &&
          `${formatGbp(plan.priceAnnualPence)} billed yearly`}
        {!isFree && period === "monthly" && "Billed monthly"}
        {isFree && "No card required"}
      </p>

      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature.label} className="flex items-start gap-2.5 text-sm">
            <CheckIcon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                plan.featured ? "text-primary" : "text-muted-foreground"
              )}
            />
            <span className="text-foreground/85">{feature.label}</span>
          </li>
        ))}
      </ul>

      {hasCredits && (
        <p className="mt-4 text-xs text-muted-foreground">{CREDITS_TOOLTIP}</p>
      )}

      <Link
        href={href}
        className={cn(
          "mt-6 inline-flex h-10 items-center justify-center rounded-lg text-sm font-medium transition-colors",
          plan.featured
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border bg-background hover:bg-muted"
        )}
      >
        {isFree ? "Start for free" : `Choose ${plan.name}`}
      </Link>
    </div>
  )
}
