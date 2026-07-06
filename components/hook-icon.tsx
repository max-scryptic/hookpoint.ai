import type { SVGProps } from "react"

export function HookIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <circle cx="17.5" cy="5" r="2" />
      <path d="M17.5 7v8a5 5 0 0 1-10 0v-4" />
      <path d="m4.5 14 3-3 3 3" />
    </svg>
  )
}
