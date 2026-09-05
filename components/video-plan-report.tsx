"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  AreaChartIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ImageOffIcon,
  ImageIcon,
  Loader2Icon,
  PackageIcon,
  QuoteIcon,
  RefreshCwIcon,
  TypeIcon,
} from "lucide-react"

import { HookIcon } from "@/components/hook-icon"
import { TryCallout } from "@/components/try-callout"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cleanCopy } from "@/lib/copy-guardrails"
import type { SerialisedVideoPlan } from "@/lib/video-plans/serialise"
import type {
  VideoPlanPackaging,
  VideoPlanSurfaceRead,
  VideoPlanThumbnailRead,
  VideoPlanTitleRead,
} from "@/lib/video-plans/packaging-plan"

// How often the page asks whether the read has finished. The work is one
// transcription plus one model call, so it usually lands within a few of these.
const POLL_INTERVAL_MS = 4000

// The section a saved tip records itself under. All three carry "packaging", so
// they land in the checklist's packaging group (lib/tips.ts) alongside the tips
// a published report gives, while still saying they came from a plan.
function planSection(surface: string): string {
  return `Video plan packaging: ${surface}`
}

export function VideoPlanReport({
  initialPlan,
}: {
  initialPlan: SerialisedVideoPlan
}) {
  const [plan, setPlan] = useState(initialPlan)
  const [retrying, setRetrying] = useState(false)

  // Kicks the read and takes back whatever state the server reports. The route
  // is both the kick and the poll: it is claim-guarded, so calling it on a
  // timer is safe and recovers a read whose invocation was killed.
  const poll = useCallback(async (planId: string) => {
    const response = await fetch(`/api/video-plans/${planId}/process`, {
      method: "POST",
    })
    if (!response.ok) return
    const data = (await response.json().catch(() => null)) as {
      plan?: SerialisedVideoPlan
    } | null
    if (data?.plan) setPlan(data.plan)
  }, [])

  // Poll while there is no read yet. A failed plan stops on its own: retrying
  // is the creator's call, not something to do every four seconds against a
  // model call that costs money.
  const settled = plan.packagingPlan != null || plan.status === "failed"
  const planId = plan.id

  useEffect(() => {
    if (settled) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      void poll(planId)
    }
    tick()
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [planId, poll, settled])

  async function retry() {
    setRetrying(true)
    await poll(plan.id)
    setRetrying(false)
  }

  if (plan.packagingPlan) {
    return (
      <PlanReportLayout plan={plan}>
        <PackagingReport
          planId={plan.id}
          packaging={plan.packagingPlan}
          hookTranscript={plan.hookTranscript}
        />
      </PlanReportLayout>
    )
  }

  if (plan.status === "failed") {
    return (
      <PlanReportLayout plan={plan}>
        <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 text-amber-500" />
            <div>
              <p className="text-sm font-medium">
                We couldn&apos;t read your packaging
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {plan.failureReason ??
                  "Something went wrong while reading this plan."}
              </p>
            </div>
          </div>
          <Button onClick={retry} disabled={retrying}>
            {retrying ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Try again
          </Button>
        </div>
      </PlanReportLayout>
    )
  }

  return (
    <PlanReportLayout plan={plan}>
      <div className="flex items-start gap-3 rounded-xl border bg-card p-6">
        <Loader2Icon className="mt-0.5 size-4 animate-spin text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Reading your packaging…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;re listening to your opening and weighing your titles against
            your thumbnail. This runs in the background, so you can leave this
            page and come back.
          </p>
        </div>
      </div>
    </PlanReportLayout>
  )
}

function PlanReportLayout({
  plan,
  children,
}: {
  plan: SerialisedVideoPlan
  children: ReactNode
}) {
  const title = plan.titles[0] ?? "Untitled video"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        <PlanThumbnail plan={plan} title={title} />
        <div className="flex flex-1 flex-col">
          <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How your title, thumbnail and hook line up, before you publish.
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <PackageIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Packaging</h2>
        </div>
        {children}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <AreaChartIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Retention</h2>
        </div>
      </section>
    </div>
  )
}

function PlanThumbnail({
  plan,
  title,
}: {
  plan: SerialisedVideoPlan
  title: string
}) {
  const [failed, setFailed] = useState(false)
  const src = plan.hasThumbnail
    ? `/api/video-plans/${plan.id}/thumbnail?slot=0`
    : null

  return (
    <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-[var(--radius-thumbnail)] bg-muted sm:w-64">
      {src && !failed ? (
        // Signed per request by the thumbnail route, so there is no stable URL
        // for next/image to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={title}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-muted-foreground"
          role="img"
          aria-label={`${title} (no thumbnail available)`}
        >
          <ImageOffIcon className="size-6" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

// The finished read: the verdict, then the titles weighed against each other,
// then the two surfaces there is only one of. The three surfaces sit behind the
// same glyphs and in the same order as the published report's packaging tabs
// (components/analysed-video-detail.tsx), so a creator meets the same objects
// whichever page they are on.
function PackagingReport({
  planId,
  packaging,
  hookTranscript,
}: {
  planId: string
  packaging: VideoPlanPackaging
  hookTranscript: string | null
}) {
  const thumbnailReads =
    packaging.thumbnails && packaging.thumbnails.length > 0
      ? packaging.thumbnails
      : [{ index: 0, ...packaging.thumbnail }]
  const hasTitleTest = packaging.titles.length > 1
  const hasThumbnailTest = thumbnailReads.length > 1

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Summary</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {cleanCopy(packaging.overall)}
        </p>
      </div>

      <Tabs defaultValue="titles" className="w-full">
        <TabsList>
          <TabsTrigger value="titles">
            <TypeIcon className="text-muted-foreground" />
            {packaging.titles.length > 1 ? "Titles" : "Title"}
          </TabsTrigger>
          <TabsTrigger value="thumbnail">
            <ImageIcon className="text-muted-foreground" />
            {thumbnailReads.length > 1 ? "Thumbnails" : "Thumbnail"}
          </TabsTrigger>
          <TabsTrigger value="hook">
            <HookIcon className="text-muted-foreground" />
            Hook
          </TabsTrigger>
        </TabsList>

        <TabsContent value="titles" className="w-full">
          <div className="flex flex-col gap-3">
            {packaging.titles.map((title, index) => (
              <TitleCard
                key={index}
                read={title}
                recommended={
                  hasTitleTest && index === packaging.recommendedTitleIndex
                }
                reason={
                  hasTitleTest && index === packaging.recommendedTitleIndex
                    ? packaging.recommendedTitleReason
                    : null
                }
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="thumbnail" className="w-full">
          <div className="flex flex-col gap-3">
            {thumbnailReads.map((thumbnail) => (
              <ThumbnailCard
                key={thumbnail.index}
                planId={planId}
                read={thumbnail}
                recommended={
                  hasThumbnailTest &&
                  thumbnail.index ===
                    (packaging.recommendedThumbnailIndex ?? 0)
                }
                reason={
                  hasThumbnailTest &&
                  thumbnail.index ===
                    (packaging.recommendedThumbnailIndex ?? 0)
                    ? (packaging.recommendedThumbnailReason ?? null)
                    : null
                }
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="hook" className="w-full">
          <SurfaceCard
            label="Hook"
            read={packaging.hook}
            quote={hookTranscript?.trim() ? `“${hookTranscript.trim()}”` : null}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ThumbnailCard({
  planId,
  read,
  recommended,
  reason,
}: {
  planId: string
  read: VideoPlanThumbnailRead
  recommended: boolean
  reason: string | null
}) {
  const label = `Thumbnail ${read.index + 1}`
  return (
    <SurfaceCard
      label={label}
      read={read}
      recommended={recommended}
      reason={reason}
      preview={
        <div className="shrink-0">
          {/* Signed per request by the thumbnail route, so there is no stable
              URL for next/image to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/video-plans/${planId}/thumbnail?slot=${read.index}`}
            alt={label}
            className="aspect-video w-48 rounded-[var(--radius-thumbnail)] border object-cover"
          />
        </div>
      }
    />
  )
}

function TitleCard({
  read,
  recommended,
  reason,
}: {
  read: VideoPlanTitleRead
  recommended: boolean
  reason: string | null
}) {
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="font-medium">{read.title}</p>
            {recommended && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2Icon className="size-3" />
                Recommended
              </span>
            )}
          </div>
          {read.summary && (
            <p className="mt-1 text-sm text-muted-foreground">
              {cleanCopy(read.summary)}
            </p>
          )}
        </div>
        <AlignmentScore score={read.alignmentScore} />
      </div>

      {reason && (
        <p className="text-sm text-muted-foreground">{cleanCopy(reason)}</p>
      )}

      <SurfaceBody
        section={planSection("Title")}
        whatWorks={read.whatWorks}
        whatToChange={read.whatToChange}
        examples={read.examples}
      />
    </div>
  )
}

// How tightly this title agrees with the thumbnail and hook, printed 0-10 to
// one decimal - the same scale the published report's alignment card uses, so a
// 7.8 means the same thing on both pages.
function AlignmentScore({ score }: { score: number }) {
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="text-xs text-muted-foreground">Alignment</span>
      <span className="text-lg font-semibold tabular-nums">
        {score.toFixed(1)}
        <span className="text-sm font-normal text-muted-foreground">/10</span>
      </span>
    </div>
  )
}

function SurfaceCard({
  label,
  read,
  preview,
  quote,
  recommended = false,
  reason,
}: {
  label: string
  read: VideoPlanSurfaceRead
  preview?: React.ReactNode
  // The spoken opening, for the Hook card. Shown inline rather than behind a
  // hover: on a plan it is the one thing the creator has not seen written down,
  // because we transcribed it from their own footage.
  quote?: string | null
  recommended?: boolean
  reason?: string | null
}) {
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start gap-4">
        {preview}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-fit rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-sm font-semibold text-blue-700 dark:border-blue-400/40 dark:bg-blue-400/10 dark:text-blue-300">
              {label}
            </span>
            {recommended && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2Icon className="size-3" />
                Recommended
              </span>
            )}
            {read.summary && (
              <span className="text-sm text-muted-foreground">
                {cleanCopy(read.summary)}
              </span>
            )}
          </div>

          {reason && (
            <p className="mt-3 text-sm text-muted-foreground">
              {cleanCopy(reason)}
            </p>
          )}

          {quote && (
            <p className="mt-3 flex gap-2 text-sm italic text-muted-foreground">
              <QuoteIcon className="mt-1 size-3.5 shrink-0" />
              <span>{quote}</span>
            </p>
          )}

          <div className="mt-4">
            <SurfaceBody
              section={planSection(label)}
              whatWorks={read.whatWorks}
              whatToChange={read.whatToChange}
              examples={read.examples}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// The strength, then the change, in the same shape the published report gives
// them: plain prose followed by the borderless blue "Try:" callout, which is
// what lets a plan's advice be saved to the same checklist.
function SurfaceBody({
  section,
  whatWorks,
  whatToChange,
  examples,
}: {
  section: string
  whatWorks: string
  whatToChange: string
  examples: VideoPlanSurfaceRead["examples"]
}) {
  if (!whatWorks && !whatToChange) {
    return <p className="text-sm text-muted-foreground">Nothing to flag.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {whatWorks && <p className="text-sm">{cleanCopy(whatWorks)}</p>}
      {whatToChange && (
        <TryCallout section={section} examples={examples}>
          {whatToChange}
        </TryCallout>
      )}
    </div>
  )
}
