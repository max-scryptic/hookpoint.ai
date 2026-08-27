"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 w-72 origin-(--transform-origin) rounded-lg bg-popover p-4 text-popover-foreground duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            // Elevation. A popover opens over whatever the page had there, and
            // that is usually a card of its own colour: white on white in light
            // mode, and until --popover was lifted, the same navy twice in dark.
            // So the popup says it floats three ways at once rather than
            // leaning on any single one.
            //
            // Light mode: a close contact shadow for the edge and a wide, soft
            // cast shadow underneath, which is the whole of what separates two
            // white surfaces.
            "shadow-[0_2px_6px_-2px_rgb(0_0_0/0.12),0_18px_44px_-14px_rgb(0_0_0/0.3)]",
            "ring-1 ring-foreground/10",
            // Dark mode: the cast shadow is deepened well past its light-mode
            // opacity, since it has to darken a surface that is already dark,
            // and it is joined by a brighter hairline and a lit top edge. The
            // inset highlight is the cheapest honest cue for elevation in a
            // dark UI: a raised surface catches the light along its top edge.
            "dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_2px_8px_-2px_rgb(0_0_0/0.5),0_26px_60px_-16px_rgb(0_0_0/0.72)]",
            "dark:ring-white/15",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
