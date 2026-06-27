"use client"

import Image from "next/image"
import Link from "next/link"
import {
  EyeIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MoreVerticalIcon,
  PlayIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { RecentVideo, VideoPrivacyStatus } from "@/lib/youtube/youtube"

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

function formatCount(value: number | null): string {
  if (value == null) return "—"
  return value.toLocaleString()
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const VISIBILITY_META: Record<
  VideoPrivacyStatus,
  { label: string; icon: typeof GlobeIcon }
> = {
  public: { label: "Public", icon: GlobeIcon },
  unlisted: { label: "Unlisted", icon: LinkIcon },
  private: { label: "Private", icon: LockIcon },
}

function VisibilityCell({ status }: { status: VideoPrivacyStatus }) {
  const { label, icon: Icon } = VISIBILITY_META[status]
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-4" />
      {label}
    </span>
  )
}

function Thumbnail({ video }: { video: RecentVideo }) {
  const duration = formatDuration(video.durationSeconds)
  return (
    <a
      href={`https://www.youtube.com/watch?v=${video.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-muted sm:w-40"
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
      {duration && (
        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-xs font-medium text-white">
          {duration}
        </span>
      )}
    </a>
  )
}

function VideoActions({ video }: { video: RecentVideo }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Actions for ${video.title}`}
          />
        }
      >
        <MoreVerticalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={<Link href={`/dashboard/analyse-video/${video.id}`} />}
        >
          <EyeIcon className="size-4" />
          Analyse video
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b text-xs font-medium text-muted-foreground">
            <th className="px-4 py-3 font-medium">Video</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">
              Visibility
            </th>
            <th className="hidden px-4 py-3 font-medium lg:table-cell">Date</th>
            <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
              Views
            </th>
            <th className="hidden px-4 py-3 text-right font-medium lg:table-cell">
              Comments
            </th>
            <th className="w-12 px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {videos.map((video) => (
            <tr key={video.id} className="align-top hover:bg-muted/40">
              <td className="px-4 py-3">
                <div className="flex gap-3 sm:gap-4">
                  <Thumbnail video={video} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">
                      {video.title}
                    </p>
                    {video.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {video.description}
                      </p>
                    )}
                    {/* Compact metadata shown only when columns are hidden. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:hidden">
                      <VisibilityCell status={video.privacyStatus} />
                      {video.publishedAt && (
                        <span>{formatPublishedAt(video.publishedAt)}</span>
                      )}
                      <span className="sm:hidden">
                        {formatCount(video.viewCount)} views
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <VisibilityCell status={video.privacyStatus} />
              </td>
              <td className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
                {formatPublishedAt(video.publishedAt)}
              </td>
              <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-muted-foreground sm:table-cell">
                {formatCount(video.viewCount)}
              </td>
              <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-muted-foreground lg:table-cell">
                {formatCount(video.commentCount)}
              </td>
              <td className="px-4 py-3 text-right">
                <VideoActions video={video} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
