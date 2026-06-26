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
        "flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black",
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
