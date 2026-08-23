import { cn } from "@/lib/utils"

type BrandLogoProps = {
  className?: string
}

/*
 * The Viewlio mark, drawn inline rather than loaded as an image.
 *
 * The shape is the retention curve the product reports on: a hold, a plunge and
 * a recovery, with the marker sitting on the drop. It doubles as a V.
 *
 * Two reasons it is SVG in a component rather than a file in public/:
 *   1. It takes its colours from the theme tokens, so the mark follows the app
 *      into dark mode and through any future re-theme without a second asset.
 *   2. The logo is still being iterated on. One file to edit, ten call sites
 *      that never change.
 *
 * The tile is --primary with a white knockout, which is the pairing the mark
 * was designed against. Keep the mark at roughly 62% of the tile so the clear
 * space around it survives at size-8, the smallest place this is used.
 */
export function BrandLogo({ className }: BrandLogoProps) {
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
        className="size-[62%] text-primary-foreground"
        aria-hidden="true"
      >
        <path
          d="M4 11c6.6 0 6.4 23 16 23 6.8 0 8.4-9 12-16 2-3.9 4.9-7 12-7"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="34" r="5.5" fill="currentColor" />
      </svg>
    </div>
  )
}
