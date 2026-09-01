import { useId } from "react"

import { cn } from "@/lib/utils"

/*
 * The Viewlio mark, drawn inline rather than loaded as an image.
 *
 * A single V: two arms hanging off one flat top edge, meeting in a rounded
 * bowl. The left arm dims just above the bowl so the right one reads as
 * passing in front of it. That fold is the only thing separating the two
 * strokes, and it is a mask rather than a second colour, so the mark stays a
 * single ink - currentColor throughout - and the fold reveals whatever sits
 * behind it. Paint it a second colour and it stops working on a dark tile.
 *
 * Two reasons it is SVG in a component rather than a file in public/:
 *   1. It takes its colours from the theme tokens, so the mark follows the app
 *      into dark mode and through any future re-theme without a second asset.
 *   2. The logo is still being iterated on. One file to edit, ten call sites
 *      that never change.
 *
 * The tile is --primary with a white knockout, which is the pairing the mark
 * was designed against. Keep the mark at roughly 70% of the tile so the clear
 * space around it survives at size-8, the smallest place this is used.
 */

type BrandLogoProps = {
  className?: string
}

export function BrandLogo({ className }: BrandLogoProps) {
  // Several of these render on a single page. Duplicate ids would silently
  // bind every instance to the first one's mask, so they have to be per-render.
  const id = useId()
  const foldId = `${id}-fold`
  const maskId = `${id}-mask`
  const clipId = `${id}-clip`

  return (
    <div
      className={cn(
        "flex aspect-square shrink-0 items-center justify-center rounded-lg bg-primary",
        className
      )}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        className="size-[70%] text-primary-foreground"
        aria-hidden="true"
      >
        <defs>
          {/*
           * A luminance mask, so these greys are opacities rather than
           * colours - white keeps the arm, #757575 drops it to ~46%. They are
           * deliberately not theme tokens: the mask governs how much of the
           * mark survives, and the tile behind it supplies the colour.
           */}
          <linearGradient
            id={foldId}
            x1="8.4"
            y1="7"
            x2="24.5"
            y2="36.5"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0.76" stopColor="#FFFFFF" />
            <stop offset="0.91" stopColor="#757575" />
            <stop offset="1" stopColor="#FFFFFF" />
          </linearGradient>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="48"
            height="48"
          >
            <rect width="48" height="48" fill="#FFFFFF" />
            {/* The left arm's footprint - the only place the fold applies. */}
            <path
              d="M2.5 7 L14.3 7 L30.17 36.5 L18.37 36.5 Z"
              fill={`url(#${foldId})`}
            />
          </mask>
          {/*
           * The arms are drawn with round caps that start above the artboard,
           * then clipped flat. That is what gives the top edge its horizontal
           * cut and rounded shoulders in one stroke.
           */}
          <clipPath id={clipId}>
            <rect x="0" y="7" width="48" height="41" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`} mask={`url(#${maskId})`}>
          <path
            d="M5.08 0.84 L24 36 L42.92 0.84"
            stroke="currentColor"
            strokeWidth="10.39"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  )
}
