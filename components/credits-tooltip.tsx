"use client"

import { InfoIcon } from "lucide-react"

import { CREDITS_TOOLTIP } from "@/lib/plans"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Wraps a label with a small info affordance whose tooltip carries the given
// explanatory copy — the shared treatment for any plan-feature term that needs
// a definition. Pass the visible label as children.
export function InfoTooltip({
  content,
  children,
  className,
}: {
  content: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1 underline decoration-dotted decoration-muted-foreground/50 underline-offset-4",
              className,
            )}
          />
        }
      >
        {children}
        <InfoIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}

// The credits-specific instance, used everywhere credits are surfaced so the
// explanation (1 credit = 1 minute of raw source video analysed) stays
// consistent — pass the visible label as children, e.g.
// <CreditsTooltip>140 credits / month</…>.
export function CreditsTooltip({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <InfoTooltip content={CREDITS_TOOLTIP} className={className}>
      {children}
    </InfoTooltip>
  )
}
