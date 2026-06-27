import Image from "next/image"

import { cn } from "@/lib/utils"

type BrandLogoProps = {
  className?: string
  imageClassName?: string
  priority?: boolean
}

export function BrandLogo({
  className,
  imageClassName,
  priority = false,
}: BrandLogoProps) {
  return (
    <div
      className={cn(
        "flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[oklch(0.21_0.04_270)]",
        className
      )}
    >
      <Image
        src="/brand/hookpoint-app-logo.png"
        alt=""
        width={513}
        height={505}
        className={cn("size-full object-cover", imageClassName)}
        priority={priority}
      />
    </div>
  )
}
