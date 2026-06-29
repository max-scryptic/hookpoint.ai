import { ExternalLinkIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { YouTubeChannelDetails } from "@/lib/youtube/youtube"

function YouTubeLogo() {
  return (
    <svg
      aria-label="YouTube"
      className="size-5 shrink-0"
      viewBox="0 0 28 20"
      role="img"
    >
      <path
        fill="#FF0000"
        d="M27.4 3.1A3.5 3.5 0 0 0 25 0.6C22.8 0 19.5 0 14 0S5.2 0 3 0.6A3.5 3.5 0 0 0 0.6 3.1C0 5.2 0 7.6 0 10s0 4.8 0.6 6.9A3.5 3.5 0 0 0 3 19.4c2.2 0.6 5.5 0.6 11 0.6s8.8 0 11-0.6a3.5 3.5 0 0 0 2.4-2.5c0.6-2.1 0.6-4.5 0.6-6.9s0-4.8-0.6-6.9Z"
      />
      <path fill="#fff" d="m11.2 14.3 7.3-4.3-7.3-4.3v8.6Z" />
    </svg>
  )
}

function formatCount(value: number | null): string {
  return value == null ? "Hidden" : value.toLocaleString()
}

export function ConnectedYouTubeAccountCard({
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
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <YouTubeLogo />
          Connected Account
        </CardTitle>
        <CardDescription>Your linked YouTube channel</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
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
      </CardContent>
    </Card>
  )
}
