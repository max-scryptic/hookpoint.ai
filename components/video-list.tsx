import Image from "next/image"
import Link from "next/link"
import { PlayIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import type { RecentVideo } from "@/lib/youtube/youtube"

function formatPublishedAt(iso: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function VideoList({ videos }: { videos: RecentVideo[] }) {
  if (videos.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        No videos found on your YouTube channel yet.
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {videos.map((video) => (
        <li
          key={video.id}
          className="flex items-center gap-4 p-3 sm:gap-5 sm:p-4"
        >
          <a
            href={`https://www.youtube.com/watch?v=${video.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-40"
          >
            {video.thumbnailUrl ? (
              <Image
                src={video.thumbnailUrl}
                alt={video.title}
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
            <p className="truncate text-sm font-medium">{video.title}</p>
            {video.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {video.description}
              </p>
            )}
            {video.publishedAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatPublishedAt(video.publishedAt)}
              </p>
            )}
          </div>

          <Link
            href={`/dashboard/analyse-video/${video.id}`}
            className={buttonVariants({ size: "sm" }) + " shrink-0"}
          >
            Analyse Video
          </Link>
        </li>
      ))}
    </ul>
  )
}
