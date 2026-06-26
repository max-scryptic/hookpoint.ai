"use client"

import { LaptopIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const themeOptions = [
  {
    value: "light",
    label: "Light",
    icon: SunIcon,
  },
  {
    value: "dark",
    label: "Dark",
    icon: MoonIcon,
  },
  {
    value: "system",
    label: "System",
    icon: LaptopIcon,
  },
] as const

export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div
      className="inline-grid grid-cols-3 rounded-lg border bg-background p-1"
      role="radiogroup"
      aria-label="Color theme"
    >
      {themeOptions.map((option) => {
        const Icon = option.icon
        const isSelected = theme === option.value

        return (
          <Tooltip key={option.value}>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 rounded-md",
                    isSelected && "bg-muted text-foreground shadow-xs"
                  )}
                  aria-label={`${option.label} theme`}
                  aria-checked={isSelected}
                  role="radio"
                  onClick={() => setTheme(option.value)}
                />
              }
            >
              <Icon />
            </TooltipTrigger>
            <TooltipContent>{option.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
