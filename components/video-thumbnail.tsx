"use client"

import Image from "next/image"
import { useState } from "react"
import { ImageOffIcon } from "lucide-react"

// YouTube's Data API returns thumbnail URLs for every upload we can see,
// including private and scheduled ones - but i.ytimg.com only *serves* those
// images once the video is publicly visible. For a private or scheduled upload
// the URL is well-formed and 404s, and there is no authenticated way to read the
// bytes back (thumbnails.set is upload-only, and the API exposes no download
// endpoint), so a custom thumbnail the creator has already attached in YouTube
// Studio is simply not fetchable until the video goes public.
//
// Left alone, next/image renders that dead URL as an <img> and the browser
// paints its own broken-image glyph. This component treats a failed load as
// equivalent to no thumbnail at all and shows the same placeholder, so the
// listing degrades to a deliberate empty state instead of a broken image.
//
// Renders into whatever positioned, aspect-ratio'd container the caller
// provides (the image is `fill`), which is why it returns bare content rather
// than its own wrapper.
export function VideoThumbnail({
  src,
  alt,
  sizes,
  className = "object-cover",
  iconClassName = "size-6",
}: {
  src: string | null
  // Empty for decorative thumbnails whose title is already read out alongside
  // them; the placeholder stays silent to screen readers in that case too.
  alt: string
  // Passed straight to next/image; callers size their own container.
  sizes: string
  // Extra image styling (e.g. the listing's hover zoom). Replaces the default,
  // so pass `object-cover` through when overriding.
  className?: string
  // Lets small cells (comparison rows) use a smaller glyph than large ones.
  iconClassName?: string
}) {
  // The URL that failed, rather than a bare boolean: a component reused for
  // another video (list pagination, comparison swaps) then gets a fresh chance
  // to load instead of staying stuck on the placeholder after one failure.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-muted-foreground"
        {...(alt
          ? { role: "img", "aria-label": `${alt} (no thumbnail available)` }
          : { "aria-hidden": true })}
      >
        <ImageOffIcon className={iconClassName} aria-hidden="true" />
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  )
}
