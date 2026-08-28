"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckIcon } from "lucide-react"

import { Reveal } from "@/components/landing/landing-reveal"
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
// LOOK: three cards on one row of carbon, separated from the canvas by their
// hairlines rather than by any shadow. Exactly one button in the row is filled
// with the accent, on the featured plan, and the other two are outlined: a row
// of three lime buttons would be three of the page's single loudest element
// side by side, and none of them would mean anything.
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
        {PLANS.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            period={period}
            isAuthenticated={isAuthenticated}
            delay={index * 110}
          />
        ))}
      </div>

      <p className="text-center text-[13px] leading-[1.4] text-fog">
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
        className="inline-flex items-center gap-1 rounded-full border border-graphite bg-carbon p-1"
      >
        {(["monthly", "annual"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={period === option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px] tracking-ui transition-colors",
              // The selected side is a neutral fill, not the accent one. This
              // is a filter, not the thing the section is asking for.
              period === option
                ? "bg-white/10 text-paper"
                : "text-fog hover:text-paper"
            )}
          >
            {option === "monthly" ? "Monthly" : "Annual"}
            {option === "annual" && saving > 0 && (
              <span
                className={cn(
                  "ml-2 rounded-[4px] px-1.5 py-0.5 text-[12px] leading-[1.5]",
                  period === "annual"
                    ? "bg-white/10 text-mist"
                    : "bg-pulse-green/15 text-pulse-green"
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
  delay,
}: {
  plan: Plan
  period: BillingPeriod
  isAuthenticated: boolean
  delay: number
}) {
  const pence = monthlyEquivalentPence(plan, period)
  const isFree = plan.id === "free"
  const hasCredits = plan.features.some((feature) => feature.credits)
  // A visitor with no account starts at sign-up whichever card they press; a
  // signed-in reader goes straight to the in-app plan picker where the
  // checkout lives.
  const href = isAuthenticated ? "/pricing" : "/signup"

  return (
    <Reveal
      delay={delay}
      className={cn(
        // The featured card is picked out by a near-white edge, which is the
        // brightest an edge gets in this system, rather than by a shadow or a
        // tint. Everything else is a graphite hairline that warms on hover.
        "group relative flex flex-col rounded-[12px] border bg-carbon p-6 transition-colors duration-300",
        plan.featured
          ? "border-mist/60 hover:border-mist"
          : "border-graphite hover:border-smoke"
      )}
    >
      {plan.featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-paper px-3 py-1 text-[12px] leading-[1.4] font-w510 tracking-ui text-void">
          Most popular
        </span>
      )}

      <h3 className="text-[17px] leading-[1.4] font-w590 tracking-copy text-paper">
        {plan.name}
      </h3>
      <p className="mt-1.5 text-[13px] leading-[1.4] text-fog">{plan.tagline}</p>

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-[32px] leading-[1.13] font-w510 tracking-display text-paper">
          {pence == null || pence === 0 ? "Free" : formatGbp(pence)}
        </span>
        {pence != null && pence > 0 && (
          <span className="text-[13px] text-fog">/ month</span>
        )}
      </div>
      <p className="mt-1.5 h-4 text-[12px] leading-[1.4] text-fog">
        {!isFree &&
          period === "annual" &&
          plan.priceAnnualPence != null &&
          `${formatGbp(plan.priceAnnualPence)} billed yearly`}
        {!isFree && period === "monthly" && "Billed monthly"}
        {isFree && "No card required"}
      </p>

      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((feature) => (
          <li
            key={feature.label}
            className="flex items-start gap-2.5 text-[15px]"
          >
            <CheckIcon
              className={cn(
                "mt-[3px] size-3.5 shrink-0",
                plan.featured ? "text-mist" : "text-fog"
              )}
            />
            <span className="leading-[1.6] tracking-ui text-mist">
              {feature.label}
            </span>
          </li>
        ))}
      </ul>

      {hasCredits && (
        <p className="mt-4 text-[12px] leading-[1.5] text-fog">
          {CREDITS_TOOLTIP}
        </p>
      )}

      <Link
        href={href}
        className={cn(
          "mt-6 inline-flex h-10 items-center justify-center rounded-[6px] text-sm font-w510 tracking-ui transition-colors duration-200",
          plan.featured
            ? "linear-action-shadow bg-acid-lime text-void hover:bg-[#eefa4a]"
            : "border border-graphite text-mist hover:border-smoke hover:bg-white/[0.03] hover:text-paper"
        )}
      >
        {isFree ? "Start for free" : `Choose ${plan.name}`}
      </Link>
    </Reveal>
  )
}
