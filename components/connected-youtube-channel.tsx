import { ExternalLinkIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import type { YouTubeChannelDetails } from "@/lib/youtube/youtube"

function formatCount(value: number | null): string {
  return value == null ? "Hidden" : value.toLocaleString()
}

// The channel avatar, title, description and stats, rendered bare so it can be
// embedded inside whichever card wants it (today, the account settings card).
export function ConnectedYouTubeChannel({
  channel,
}: {
  channel: YouTubeChannelDetails
}) {
  const initial = channel.title.trim().charAt(0).toUpperCase() || "Y"
  const stats = [
    { label: "Subscribers", value: formatCount(channel.subscriberCount) },
    { label: "Total views", value: formatCount(channel.viewCount) },
    { label: "Videos", value: formatCount(channel.videoCount) },
  ]

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-start gap-4">
          <Avatar
            className="size-16"
            aria-label={`${channel.title} profile photo`}
          >
            {channel.thumbnailUrl && (
              <AvatarImage src={channel.thumbnailUrl} alt="" />
            )}
            <AvatarFallback className="text-lg">{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 pt-0.5">
            <a
              className="group inline-flex max-w-full items-center gap-1.5 font-heading text-lg font-semibold hover:underline"
              href={`https://www.youtube.com/channel/${channel.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="truncate">{channel.title}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
            <p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {channel.description || "No channel description yet."}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30">
          {stats.map(({ label, value }) => (
            <div
              className="flex min-w-0 flex-col px-2 py-3 text-center sm:px-4"
              key={label}
            >
              <dt className="order-2 mt-0.5 text-xs text-muted-foreground">
                {label}
              </dt>
              <dd className="order-1 truncate font-heading text-lg font-semibold tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
    </div>
  )
}
