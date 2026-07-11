"use client"

import { useState } from "react"
import { CheckIcon, Loader2Icon } from "lucide-react"

import {
  annualSavingPercent,
  formatGbp,
  monthlyEquivalentPence,
  PLANS,
  type BillingPeriod,
  type Plan,
  type PlanId,
} from "@/lib/plans"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CreditsTooltip } from "@/components/credits-tooltip"

// The pricing comparison: three plan cards side by side with a monthly/annual
// billing toggle that reprices all three at once. Pay buttons call
// `onSelectPlan`; the payment flow is wired in separately, so by default a
// selection is a no-op placeholder.
export function PricingPlans({
  currentPlanId = "free",
  loadingPlanId = null,
  onSelectPlan,
}: {
  currentPlanId?: PlanId
  loadingPlanId?: PlanId | null
  onSelectPlan?: (planId: PlanId, period: BillingPeriod) => void
}) {
  const [period, setPeriod] = useState<BillingPeriod>("annual")
  const isLoading = loadingPlanId != null

  return (
    <div className="space-y-8">
      <BillingToggle
        period={period}
        disabled={isLoading}
        onChange={setPeriod}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            period={period}
            isCurrent={plan.id === currentPlanId}
            isLoading={loadingPlanId === plan.id}
            isDisabled={isLoading && loadingPlanId !== plan.id}
            onSelect={() => onSelectPlan?.(plan.id, period)}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Prices in GBP. Annual plans are billed once yearly and shown as the
        equivalent monthly cost. Cancel anytime.
      </p>
    </div>
  )
}

function BillingToggle({
  period,
  disabled,
  onChange,
}: {
  period: BillingPeriod
  disabled: boolean
  onChange: (period: BillingPeriod) => void
}) {
  return (
    <div className="flex justify-center">
      <div
        role="tablist"
        aria-label="Billing period"
        className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
      >
        <ToggleOption
          selected={period === "monthly"}
          disabled={disabled}
          onClick={() => onChange("monthly")}
        >
          Monthly
        </ToggleOption>
        <ToggleOption
          selected={period === "annual"}
          disabled={disabled}
          onClick={() => onChange("annual")}
        >
          Annual
          <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary">
            Save 33%
          </span>
        </ToggleOption>
      </div>
    </div>
  )
}

function ToggleOption({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-60",
        selected
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function PlanCard({
  plan,
  period,
  isCurrent,
  isLoading,
  isDisabled,
  onSelect,
}: {
  plan: Plan
  period: BillingPeriod
  isCurrent: boolean
  isLoading: boolean
  isDisabled: boolean
  onSelect: () => void
}) {
  const perMonth = monthlyEquivalentPence(plan, period)
  const isFree = perMonth === 0 || perMonth == null
  const saving = annualSavingPercent(plan)

  return (
    <Card
      className={cn(
        "relative flex flex-col gap-0 p-6",
        plan.featured && "border-primary shadow-md ring-1 ring-primary/20",
      )}
    >
      {plan.featured ? (
        <span className="absolute right-6 top-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
          Most popular
        </span>
      ) : null}

      <div className="space-y-1">
        <h3 className="font-heading text-lg font-semibold">{plan.name}</h3>
        <p className="min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
      </div>

      <div className="mt-4 flex items-end gap-1">
        <span className="font-heading text-4xl font-semibold tracking-tight tabular-nums">
          {isFree ? "£0" : formatGbp(perMonth)}
        </span>
        {!isFree ? (
          <span className="pb-1 text-sm text-muted-foreground">/ month</span>
        ) : null}
      </div>
      <p className="mt-1 min-h-5 text-xs text-muted-foreground">
        {isFree ? (
          "Free forever"
        ) : period === "annual" ? (
          <>
            Billed {formatGbp(plan.priceAnnualPence as number)}/year
            {saving > 0 ? ` · save ${saving}%` : null}
          </>
        ) : (
          "Billed monthly"
        )}
      </p>

      <Button
        className="mt-6 w-full"
        variant={plan.featured ? "default" : "outline"}
        disabled={isCurrent || isLoading || isDisabled}
        aria-busy={isLoading}
        onClick={onSelect}
      >
        {isLoading ? (
          <>
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Redirecting...
          </>
        ) : isCurrent ? (
          "Current plan"
        ) : isFree ? (
          "Downgrade to Free"
        ) : (
          `Choose ${plan.name}`
        )}
      </Button>

      <ul className="mt-6 space-y-3 text-sm">
        {plan.features.map((feature) => (
          <li key={feature.label} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            {feature.credits ? (
              <CreditsTooltip>{feature.label}</CreditsTooltip>
            ) : (
              <span>{feature.label}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
