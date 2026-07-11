"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2Icon, SparklesIcon } from "lucide-react"

import { ConfettiBurst } from "@/components/confetti-burst"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Plan } from "@/lib/plans"

interface DashboardUpgradeSuccessDialogProps {
  open: boolean
  plan: Plan
}

export function DashboardUpgradeSuccessDialog({
  open,
  plan,
}: DashboardUpgradeSuccessDialogProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(open)
  const [showConfetti, setShowConfetti] = useState(open)

  const unlockedFeatures = useMemo(
    () => plan.features.map((feature) => feature.label),
    [plan.features],
  )

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen)
    if (!nextOpen) {
      setShowConfetti(false)
      router.replace("/dashboard", { scroll: false })
    }
  }

  if (!open) return null

  return (
    <>
      {showConfetti ? (
        <ConfettiBurst onComplete={() => setShowConfetti(false)} />
      ) : null}
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="items-start gap-2">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SparklesIcon className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-xl">
                {plan.name} is unlocked
              </DialogTitle>
              <DialogDescription>
                Your paid features are active. Here is what you can use now.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="rounded-lg border bg-muted/30 p-4">
            <ul className="space-y-3">
              {unlockedFeatures.map((feature) => (
                <li key={feature} className="flex gap-3 text-sm">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)}>
              Start using {plan.name}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
