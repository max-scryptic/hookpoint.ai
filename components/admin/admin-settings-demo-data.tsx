"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  DatabaseIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface DemoDataUserOption {
  id: string
  label: string
}

interface SeedResult {
  videos: number
  deepAnalysedVideos: number
  retentionWindows: number
  events: number
  comparisons: number
  savedTips: number
  notifications: number
  costLogs: number
  planGranted: boolean
  warnings: string[]
}

interface ClearResult {
  videos: number
  comparisons: number
  savedTips: number
  notifications: number
  planRemoved: boolean
}

// The choices offered rather than a free number field: the interesting counts
// are the ones a library-gated feature opens at, so the menu names them instead
// of leaving an admin to discover them. Both gates count DEEPLY analysed videos
// and the seed only deep-analyses part of the library it writes (see
// DEEP_ANALYSED_SHARE in lib/admin/demo-data/seed.ts), so each label names the
// deep count a size actually lands on: 9 videos is what opens Channel Trends
// (6 deep) and 14 is what opens the Video Planner (10 deep).
const VIDEO_COUNTS = [
  { value: 3, label: "3 videos (2 deep, both gates shut)" },
  { value: 6, label: "6 videos (4 deep, both gates shut)" },
  { value: 9, label: "9 videos (6 deep, Channel Trends open)" },
  { value: 14, label: "14 videos (10 deep, Video Planner open)" },
  { value: 18, label: "18 videos (everything)" },
] as const

// The admin "Demo data" tab: fills an account with a synthetic library so the
// whole product can be looked at without anyone uploading a video first. Writes
// go to /api/admin/demo-data, which re-checks that the caller is an admin.
export function AdminSettingsDemoData({
  users,
  currentAdminId,
}: {
  users: DemoDataUserOption[]
  currentAdminId: string
}) {
  const [userId, setUserId] = React.useState(currentAdminId)
  const [videoCount, setVideoCount] = React.useState<number>(9)
  const [grantPaidPlan, setGrantPaidPlan] = React.useState(true)
  const [busy, setBusy] = React.useState<"seed" | "clear" | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [warnings, setWarnings] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const selectedUser =
    users.find((user) => user.id === userId)?.label ?? "Choose an account"
  const selectedCount =
    VIDEO_COUNTS.find((option) => option.value === videoCount)?.label ??
    `${videoCount} videos`

  async function run(action: "seed" | "clear") {
    setBusy(action)
    setMessage(null)
    setWarnings([])
    setError(null)
    try {
      const response = await fetch("/api/admin/demo-data", {
        method: action === "seed" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "seed"
            ? { userId, videoCount, grantPaidPlan }
            : { userId },
        ),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        result?: SeedResult | ClearResult
        error?: string
      }
      if (!response.ok || !payload.result) {
        setError(payload.error ?? "Something went wrong.")
        return
      }
      if (action === "seed") {
        const result = payload.result as SeedResult
        setMessage(
          `Seeded ${result.videos} videos (${result.deepAnalysedVideos} deep-analysed), ` +
            `${result.retentionWindows} retention windows, ${result.events} events, ` +
            `${result.comparisons} comparisons, ${result.savedTips} checklist lines and ` +
            `${result.costLogs} cost logs.` +
            (result.planGranted ? " Pro plan granted." : ""),
        )
        setWarnings(result.warnings ?? [])
      } else {
        const result = payload.result as ClearResult
        setMessage(
          `Removed ${result.videos} demo videos, ${result.comparisons} comparisons, ` +
            `${result.savedTips} checklist lines and ${result.notifications} notifications.` +
            (result.planRemoved ? " Demo plan removed." : ""),
        )
      }
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Request failed.",
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Demo data</CardTitle>
          <CardDescription>
            Fills an account with a synthetic channel so every page has
            something on it: analysed videos with retention curves, deep
            analysis events, packaging and script reads, comparison reports, a
            checklist and Channel Trends. Nothing here calls YouTube or any
            model, so it costs nothing and takes a few seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    {selectedUser}
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={userId}
                  onValueChange={(value) => setUserId(value as string)}
                >
                  {users.map((user) => (
                    <DropdownMenuRadioItem key={user.id} value={user.id}>
                      {user.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    {selectedCount}
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={String(videoCount)}
                  onValueChange={(value) => setVideoCount(Number(value))}
                >
                  {VIDEO_COUNTS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={String(option.value)}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    {grantPaidPlan ? "With Pro plan" : "No plan change"}
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                <DropdownMenuCheckboxItem
                  checked={grantPaidPlan}
                  onCheckedChange={(checked) => setGrantPaidPlan(Boolean(checked))}
                >
                  Grant a Pro plan
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy != null}
              onClick={() => run("seed")}
            >
              {busy === "seed" ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <DatabaseIcon data-icon="inline-start" />
              )}
              {busy === "seed" ? "Generating..." : "Generate demo data"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy != null}
              onClick={() => run("clear")}
            >
              {busy === "clear" ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              {busy === "clear" ? "Removing..." : "Remove demo data"}
            </Button>
          </div>

          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
          {warnings.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                The library was seeded, but these parts were skipped:
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            <p>
              Generating replaces any demo library the account already has, so
              clicking twice leaves one library rather than two. Removing takes
              out every row that was seeded, apart from the daily-activity
              history, which is indistinguishable from real activity once
              written.
            </p>
            <p>
              Demo videos carry no thumbnail: the app only loads images from
              YouTube&rsquo;s own hosts, and there is no real video behind a
              seeded row, so every thumbnail slot shows its placeholder.
            </p>
            <p>
              The Pro plan written here is a projection row, not a Stripe
              subscription. It unlocks Channel Trends and the deep-analysis
              surfaces; the billing screen&rsquo;s cancel and change-plan
              actions will fail against it.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
