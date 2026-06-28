"use client"

import Image from "next/image"
import Link from "next/link"
import {
  BarChart3Icon,
  CircleCheckIcon,
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

export function formatPublishedAt(iso: string): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function formatCount(value: number | null): string {
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

export function VisibilityCell({ status }: { status: VideoPrivacyStatus }) {
  const { label, icon: Icon } = VISIBILITY_META[status]
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-4" />
      {label}
    </span>
  )
}

export function Thumbnail({ video }: { video: RecentVideo }) {
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

// A green tick shown for videos that have already been analysed.
function AnalysedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-500">
      <CircleCheckIcon className="size-4" />
      Analysed
    </span>
  )
}

function VideoActions({
  video,
  isAnalysed,
}: {
  video: RecentVideo
  isAnalysed: boolean
}) {
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
        {/* Already-analysed videos can only be viewed — re-analysing would spend
            API quota to reproduce results we've already cached. */}
        <DropdownMenuItem
          render={<Link href={`/dashboard/analysed-video/${video.id}`} />}
        >
          {isAnalysed ? (
            <>
              <BarChart3Icon className="size-4" />
              View analysis
            </>
          ) : (
            <>
              <EyeIcon className="size-4" />
              Analyse video
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function VideoList({
  videos,
  analysedIds,
}: {
  videos: RecentVideo[]
  // IDs of videos the user has already analysed.
  analysedIds?: Set<string>
}) {
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
          <tr className="border-b bg-accent text-xs font-medium text-accent-foreground">
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
            <th className="hidden px-4 py-3 font-medium sm:table-cell">
              Analysed
            </th>
            <th className="w-12 px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {videos.map((video) => {
            const isAnalysed = analysedIds?.has(video.id) ?? false
            return (
            <tr
              key={video.id}
              className={`align-top hover:bg-muted/40 ${
                isAnalysed ? "bg-muted/30" : ""
              }`}
            >
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
                      {isAnalysed && (
                        <span className="sm:hidden">
                          <AnalysedBadge />
                        </span>
                      )}
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
              <td className="hidden px-4 py-3 sm:table-cell">
                {isAnalysed ? (
                  <AnalysedBadge />
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <VideoActions video={video} isAnalysed={isAnalysed} />
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
