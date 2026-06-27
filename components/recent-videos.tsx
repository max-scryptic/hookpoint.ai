import Image from "next/image"
import { PlayIcon } from "lucide-react"
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

export function RecentVideos({ videos }: { videos: RecentVideo[] }) {
  if (videos.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        No videos found on your YouTube channel yet.
      </div>
    )
  }

  return (
    <div className="grid auto-rows-min gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <a
          key={video.id}
          href={`https://www.youtube.com/watch?v=${video.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/20"
        >
          <div className="relative aspect-video w-full overflow-hidden bg-muted">
            {video.thumbnailUrl ? (
              <Image
                src={video.thumbnailUrl}
                alt={video.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <PlayIcon className="size-8" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 p-3">
            <span className="line-clamp-2 text-sm font-medium">
              {video.title}
            </span>
            {video.publishedAt && (
              <span className="text-xs text-muted-foreground">
                {formatPublishedAt(video.publishedAt)}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  )
}
