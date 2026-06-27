"use client"

import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

type PasswordRule = {
  label: string
  test: (password: string) => boolean
}

const PASSWORD_RULES: PasswordRule[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "One number", test: (p) => /\d/.test(p) },
]

export function isPasswordValid(password: string) {
  return PASSWORD_RULES.every((rule) => rule.test(password))
}

export function PasswordValidator({
  password,
  className,
}: {
  password: string
  className?: string
}) {
  return (
    <ul className={cn("flex flex-col gap-1", className)} aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const passed = rule.test(password)
        return (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              passed ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            )}
          >
            {passed ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="size-3.5 shrink-0" aria-hidden />
            )}
            <span>{rule.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
