import Link from "next/link"
import { LockIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

// The wall a whole page shows when the account's plan does not include the
// feature that page is for. Every paid feature uses this same card so the
// offer reads the same wherever a creator meets it: the lock, one line naming
// the feature and the tiers that carry it, one paragraph on what the feature
// actually does, and the route to the plans.
//
// It is the page-level offer. The prompt for a paid slot inside an otherwise
// free page lives in `unlock-full-report-cta.tsx` instead.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.
export function PaidFeatureCard({
  feature,
  children,
}: {
  // The feature named in the first line, as it reads at the head of a
  // sentence: "Video comparison is a paid feature, ...".
  feature: string
  // What the feature buys, as one paragraph of prose.
  children: React.ReactNode
}) {
  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <LockIcon className="size-5 text-muted-foreground" />
      <div className="w-full">
        <p className="text-sm text-muted-foreground">
          {feature} is a paid feature, available to{" "}
          <span className="font-semibold text-foreground">Starter</span> and{" "}
          <span className="font-semibold text-foreground">Pro</span> users.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{children}</p>
      </div>
      <Link href="/pricing" className={buttonVariants()}>
        See plans
      </Link>
    </Card>
  )
}
