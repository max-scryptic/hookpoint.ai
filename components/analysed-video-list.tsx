import Image from "next/image"
import Link from "next/link"
import { PlayIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import type { AnalysedVideo } from "@/lib/analysed-videos"

function formatDateAnalysed(iso: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function AnalysedVideoList({ videos }: { videos: AnalysedVideo[] }) {
  if (videos.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        You haven&apos;t analysed any videos yet. Head to{" "}
        <Link
          href="/dashboard/analyse-video"
          className="font-medium underline underline-offset-4"
        >
          Analyse Video
        </Link>{" "}
        to get started.
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {videos.map((video) => {
        const thumbnailUrl = video.videoDetails?.thumbnailUrl ?? null
        const dropOffCount = video.dropOffs?.length ?? 0

        return (
          <li
            key={video.id}
            className="flex items-center gap-4 p-3 sm:gap-5 sm:p-4"
          >
            <a
              href={`https://www.youtube.com/watch?v=${video.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-40"
            >
              {thumbnailUrl ? (
                <Image
                  src={thumbnailUrl}
                  alt={video.videoTitle}
                  fill
                  sizes="160px"
                  className="object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <PlayIcon className="size-6" />
                </div>
              )}
            </a>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {video.videoTitle}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Analysed {formatDateAnalysed(video.dateAnalysed)}
              </p>
              {dropOffCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {dropOffCount} drop-off{dropOffCount === 1 ? "" : "s"} detected
                </p>
              )}
            </div>

            <Link
              href={`/dashboard/analyse-video/${video.videoId}`}
              className={buttonVariants({ size: "sm", variant: "outline" }) + " shrink-0"}
            >
              View Analysis
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
