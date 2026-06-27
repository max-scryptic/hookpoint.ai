"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function DatePickerWithRange({
  value,
  onChange,
  className,
}: {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            id="date-picker-range"
            className={cn(
              "h-9 justify-start px-2.5 font-normal",
              !value?.from && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon className="size-4" />
        {value?.from ? (
          value.to ? (
            <>
              {format(value.from, "LLL dd, y")} -{" "}
              {format(value.to, "LLL dd, y")}
            </>
          ) : (
            format(value.from, "LLL dd, y")
          )
        ) : (
          <span>Pick a date range</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={value?.from}
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
        />
      </PopoverContent>
    </Popover>
  )
}
