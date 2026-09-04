import { CreditCardIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// Small brand marks for the payment-method card. Stripe delivers brands
// lowercased (e.g. "visa", "mastercard", "amex"); we normalize and fall back to
// a generic credit-card glyph for anything we don't have a mark for.
//
// Each mark is drawn inside a 32×20 rounded rectangle so brands line up on a
// consistent baseline regardless of their wordmark's shape.

function VisaLogo() {
  return (
    <svg viewBox="0 0 32 20" className="size-full" aria-hidden="true">
      <rect width="32" height="20" rx="3" fill="#1434CB" />
      <path
        fill="#fff"
        d="M13.9 6.6 12 13.4h-1.6L12.3 6.6h1.6Zm6.7 4.4.9-2.4.5 2.4h-1.4Zm1.8 2.4h1.5L22.6 6.6h-1.4c-.3 0-.6.2-.7.5l-2.4 6.3h1.6l.3-.9h2l.2.9Zm-4-2.2c0-1.6-2.1-1.7-2.1-2.4 0-.2.2-.4.7-.5.2 0 .8-.1 1.5.3l.3-1.3c-.4-.1-.9-.3-1.5-.3-1.5 0-2.6.8-2.6 2 0 .9.8 1.3 1.4 1.6.6.3.8.5.8.7 0 .4-.5.6-.9.6-.7 0-1.2-.2-1.5-.4l-.3 1.3c.4.2 1 .3 1.7.3 1.6 0 2.7-.8 2.7-2.1Zm-6.5-4.6-2.5 6.8H7.7L6.5 8c-.1-.3-.1-.4-.3-.5-.4-.2-1-.4-1.5-.5v-.2h2.6c.3 0 .6.2.7.6l.6 3.4 1.6-4h1.7Z"
      />
    </svg>
  )
}

function MastercardLogo() {
  return (
    <svg viewBox="0 0 32 20" className="size-full" aria-hidden="true">
      <rect width="32" height="20" rx="3" fill="#F4F4F4" />
      <circle cx="13" cy="10" r="6" fill="#EB001B" />
      <circle cx="19" cy="10" r="6" fill="#F79E1B" />
      <path
        fill="#FF5F00"
        d="M16 5.3a6 6 0 0 1 0 9.4 6 6 0 0 1 0-9.4Z"
      />
    </svg>
  )
}

function AmexLogo() {
  return (
    <svg viewBox="0 0 32 20" className="size-full" aria-hidden="true">
      <rect width="32" height="20" rx="3" fill="#1F72CD" />
      <text
        x="16"
        y="13"
        textAnchor="middle"
        fontSize="6"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontWeight="bold"
        fill="#fff"
      >
        AMEX
      </text>
    </svg>
  )
}

function DiscoverLogo() {
  return (
    <svg viewBox="0 0 32 20" className="size-full" aria-hidden="true">
      <rect width="32" height="20" rx="3" fill="#F4F4F4" />
      <path fill="#F58220" d="M32 20V11c-6 4-15 6-24 6H0v3h32Z" />
      <text
        x="5"
        y="9"
        fontSize="4"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontWeight="bold"
        fill="#1A1A1A"
        letterSpacing="0.2"
      >
        DISC
      </text>
      <circle cx="19.5" cy="7.6" r="2" fill="#F58220" />
      <text
        x="22"
        y="9"
        fontSize="4"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontWeight="bold"
        fill="#1A1A1A"
        letterSpacing="0.2"
      >
        VER
      </text>
    </svg>
  )
}

const LOGOS: Record<string, () => React.JSX.Element> = {
  visa: VisaLogo,
  mastercard: MastercardLogo,
  amex: AmexLogo,
  "american express": AmexLogo,
  discover: DiscoverLogo,
}

export function CardBrandLogo({
  brand,
  className,
}: {
  brand: string
  className?: string
}) {
  const Logo = LOGOS[brand.trim().toLowerCase()]

  return (
    <span
      className={cn(
        "inline-flex h-5 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[3px]",
        !Logo && "bg-muted text-muted-foreground ring-1 ring-foreground/10",
        className
      )}
    >
      {Logo ? <Logo /> : <CreditCardIcon className="size-3.5" />}
    </span>
  )
}
