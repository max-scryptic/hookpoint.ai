"use client"

import * as React from "react"
import { addMonths, format, subMonths } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { type DateRange, type Matcher } from "react-day-picker"

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
  placeholder = "Pick a date range",
  maxRangeMonths,
}: {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  className?: string
  placeholder?: string
  // When set, the calendar caps the selectable span to this many months around
  // the first-picked day: once a start is chosen (but no end yet), days more
  // than `maxRangeMonths` before or after it are disabled, so the completed
  // range can never exceed the cap in either direction.
  maxRangeMonths?: number
}) {
  // Always block future days; while a range is mid-selection (a start picked
  // but no end), also block days outside the allowed span from that start.
  const disabled: Matcher[] = [{ after: new Date() }]
  if (maxRangeMonths != null && value?.from && !value?.to) {
    disabled.push({ before: subMonths(value.from, maxRangeMonths) })
    disabled.push({ after: addMonths(value.from, maxRangeMonths) })
  }

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
          <span>{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={value?.from}
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
