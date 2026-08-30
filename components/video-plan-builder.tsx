"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  FileVideoIcon,
  ImageIcon,
  Loader2Icon,
  PlusIcon,
  TypeIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useNavigationGuard } from "@/hooks/use-navigation-guard"
import {
  ACCEPTED_EXTENSIONS,
  isAcceptedExtension,
} from "@/lib/source-files/config"
import type { SerialisedSourceFile } from "@/lib/source-files/serialise"
import {
  formatBytes,
  formatDuration,
  readVideoDuration,
  uploadFileMultipart,
  uploadToSignedUrl,
  type CompletedPart,
  type UploadInitResponse,
} from "@/lib/uploads/browser-upload"
import {
  ACCEPTED_THUMBNAIL_EXTENSIONS,
  ACCEPTED_THUMBNAIL_TYPES,
} from "@/lib/video-plans/config"
import { MAX_TITLES, TITLE_MAX_LENGTH } from "@/lib/video-plans/titles"

const VIDEO_ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")
const THUMBNAIL_ACCEPT = ACCEPTED_THUMBNAIL_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",")

// What the button is doing, so the creator can see which of the four steps a
// plan is on. The upload is the only slow one, so it carries a percentage;
// everything else is a single round trip.
type SubmitPhase =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "uploading"; progress: number }
  | { phase: "finishing" }

export function VideoPlanBuilder() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)
  // One empty title to start: the second and third appear only when asked for,
  // so a creator with a single idea is never looking at two blank boxes.
  const [titles, setTitles] = useState<string[]>([""])
  const [thumbnail, setThumbnail] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [submit, setSubmit] = useState<SubmitPhase>({ phase: "idle" })
  const [error, setError] = useState<string | null>(null)

  const videoInputRef = useRef<HTMLInputElement>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  const busy = submit.phase !== "idle"
  const filledTitles = titles.map((title) => title.trim()).filter(Boolean)
  const canStart =
    !busy && file != null && thumbnail != null && filledTitles.length > 0

  // The upload runs in this page, so leaving mid-flight would abort the
  // transfer and strand a half-built plan. Only guards while something is
  // actually in progress.
  useNavigationGuard(
    busy,
    "Your plan is still being created. Leaving this page will cancel the upload. Are you sure you want to leave?",
  )

  async function onPickVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    // Reset so picking the same file again re-triggers onChange.
    event.target.value = ""
    if (!picked) return

    if (!isAcceptedExtension(picked.name)) {
      setError(
        `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      )
      return
    }

    setError(null)
    setFile(picked)
    // Read the duration now, while the browser still holds the file: it goes to
    // the completion endpoint, and showing it back is how a creator confirms
    // they picked the cut they meant to.
    setDurationSeconds(await readVideoDuration(picked))
  }

  function onPickThumbnail(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    event.target.value = ""
    if (!picked) return

    if (!Object.values(ACCEPTED_THUMBNAIL_TYPES).includes(picked.type)) {
      setError(
        `Unsupported image type. Accepted: ${ACCEPTED_THUMBNAIL_EXTENSIONS.join(", ")}.`,
      )
      return
    }

    setError(null)
    setThumbnail(picked)
    setThumbnailPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous)
      return URL.createObjectURL(picked)
    })
  }

  function setTitleAt(index: number, value: string) {
    setTitles((previous) =>
      previous.map((title, i) => (i === index ? value : title)),
    )
  }

  function addTitle() {
    setTitles((previous) =>
      previous.length >= MAX_TITLES ? previous : [...previous, ""],
    )
  }

  function removeTitleAt(index: number) {
    setTitles((previous) =>
      previous.length <= 1 ? previous : previous.filter((_, i) => i !== index),
    )
  }

  // Reads the { error, message } a route answers a refusal with, falling back
  // to `fallback` for anything that isn't one (an HTML error page, a proxy
  // timeout). Never throws: this runs on the failure path.
  async function messageFrom(
    response: Response,
    fallback: string,
  ): Promise<string> {
    const data = (await response.json().catch(() => null)) as {
      message?: string
    } | null
    return data?.message ?? fallback
  }

  async function start() {
    if (!file || !thumbnail || filledTitles.length === 0) return
    setError(null)
    setSubmit({ phase: "creating" })

    try {
      // 1. The plan row, which everything else is keyed on.
      const planRes = await fetch("/api/video-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles: filledTitles }),
      })
      if (!planRes.ok) {
        setError(await messageFrom(planRes, "Could not start the plan."))
        setSubmit({ phase: "idle" })
        return
      }
      const { plan } = (await planRes.json()) as { plan: { id: string } }

      // 2. The thumbnail, which is small enough to go through our own server.
      const thumbnailForm = new FormData()
      thumbnailForm.append("file", thumbnail)
      const thumbnailRes = await fetch(
        `/api/video-plans/${plan.id}/thumbnail`,
        { method: "POST", body: thumbnailForm },
      )
      if (!thumbnailRes.ok) {
        setError(
          await messageFrom(thumbnailRes, "Could not upload the thumbnail."),
        )
        setSubmit({ phase: "idle" })
        return
      }

      // 3. The footage, direct to storage.
      const uploaded = await uploadFootage(plan.id, file)
      if (!uploaded) return

      // 4. Ask for the read. Deliberately not awaited for its result: the work
      // happens behind the response, and the plan page picks it up from there.
      setSubmit({ phase: "finishing" })
      await fetch(`/api/video-plans/${plan.id}/process`, { method: "POST" })

      router.push(`/video-planner/${plan.id}`)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong while starting your plan.",
      )
      setSubmit({ phase: "idle" })
    }
  }

  // Mints an upload target, transfers the bytes and confirms them. Returns true
  // when the footage landed; on a refusal it reports the message and hands back
  // false, leaving the caller nothing to do but stop.
  async function uploadFootage(planId: string, video: File): Promise<boolean> {
    const initRes = await fetch(
      `/api/video-plans/${planId}/source-file/initiate-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: video.name,
          mimeType: video.type || null,
          fileSizeBytes: video.size,
        }),
      },
    )

    const initData = (await initRes.json().catch(() => null)) as
      | UploadInitResponse<SerialisedSourceFile>
      | { message?: string }
      | null

    const target =
      initData && ("upload" in initData || "multipartUpload" in initData)
        ? (initData as UploadInitResponse<SerialisedSourceFile>)
        : null

    if (!initRes.ok || !target) {
      setError(
        (initData as { message?: string } | null)?.message ??
          "Could not start the upload.",
      )
      setSubmit({ phase: "idle" })
      return false
    }

    setSubmit({ phase: "uploading", progress: 0 })
    const onProgress = (progress: number) =>
      setSubmit({ phase: "uploading", progress })

    let parts: CompletedPart[] | undefined
    if (target.multipartUpload) {
      const multipart = target.multipartUpload
      try {
        parts = await uploadFileMultipart(video, multipart, onProgress)
      } catch (caught) {
        // Best-effort: tell the server to discard the orphaned parts rather
        // than leaving them for the bucket's lifecycle rule to reap.
        void fetch(`/api/source-files/${target.sourceFile.id}/abort-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: multipart.uploadId }),
        }).catch(() => {})
        throw caught
      }
    } else if (target.upload?.signedUrl) {
      await uploadToSignedUrl(target.upload.signedUrl, video, onProgress)
    } else {
      setError("No upload URL was provided.")
      setSubmit({ phase: "idle" })
      return false
    }

    setSubmit({ phase: "finishing" })
    const completeRes = await fetch(
      `/api/source-files/${target.sourceFile.id}/complete-upload`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target.multipartUpload
            ? {
                durationSeconds,
                uploadId: target.multipartUpload.uploadId,
                parts,
              }
            : { durationSeconds },
        ),
      },
    )
    if (!completeRes.ok) {
      setError(await messageFrom(completeRes, "The upload could not be saved."))
      setSubmit({ phase: "idle" })
      return false
    }

    return true
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={videoInputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        onChange={onPickVideo}
      />
      <input
        ref={thumbnailInputRef}
        type="file"
        accept={THUMBNAIL_ACCEPT}
        className="hidden"
        onChange={onPickThumbnail}
      />

      <BuilderStep
        icon={<FileVideoIcon className="size-4 text-muted-foreground" />}
        title="Your footage"
        description="The cut you are about to publish. Nothing is made public; we read its opening to hear the hook your titles and thumbnail have to match."
      >
        {file ? (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatBytes(file.size)} · {formatDuration(durationSeconds)}
              </p>
            </div>
            <Button
              variant="outline"
              className="sm:ml-auto"
              disabled={busy}
              onClick={() => videoInputRef.current?.click()}
            >
              <UploadIcon className="size-4" />
              Choose another
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Button
              disabled={busy}
              onClick={() => videoInputRef.current?.click()}
            >
              <UploadIcon className="size-4" />
              Choose video file
            </Button>
            <p className="text-xs text-muted-foreground">
              Accepted formats: {ACCEPTED_EXTENSIONS.join(", ")}.
            </p>
          </div>
        )}
      </BuilderStep>

      <BuilderStep
        icon={<TypeIcon className="size-4 text-muted-foreground" />}
        title="Your titles"
        description={`Start with the title you have in mind. Add up to ${MAX_TITLES} if you are torn between ideas, and we will tell you which one fits your thumbnail and hook best.`}
      >
        <div className="flex flex-col gap-3">
          {titles.map((title, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <Label htmlFor={`plan-title-${index}`} className="text-xs">
                {index === 0 ? "Title" : `Alternative ${index}`}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`plan-title-${index}`}
                  value={title}
                  maxLength={TITLE_MAX_LENGTH}
                  disabled={busy}
                  placeholder={
                    index === 0
                      ? "The title you would publish with"
                      : "Another idea worth weighing"
                  }
                  onChange={(event) => setTitleAt(index, event.target.value)}
                />
                {titles.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove alternative ${index}`}
                    disabled={busy}
                    onClick={() => removeTitleAt(index)}
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            </div>
          ))}

          {titles.length < MAX_TITLES && (
            <Button
              variant="outline"
              className="w-fit"
              disabled={busy}
              onClick={addTitle}
            >
              <PlusIcon className="size-4" />
              Add another title idea
            </Button>
          )}
        </div>
      </BuilderStep>

      <BuilderStep
        icon={<ImageIcon className="size-4 text-muted-foreground" />}
        title="Your thumbnail"
        description="The image you intend to upload with it."
      >
        <div className="flex flex-wrap items-center gap-4">
          {thumbnailPreview && (
            // Object URL for a file the browser already holds, so next/image
            // has nothing to optimise and no domain to be configured for.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailPreview}
              alt="Your thumbnail"
              className="aspect-video w-48 rounded-lg border object-cover"
            />
          )}
          <div className="flex flex-col items-start gap-2">
            <Button
              variant={thumbnail ? "outline" : "default"}
              disabled={busy}
              onClick={() => thumbnailInputRef.current?.click()}
            >
              <UploadIcon className="size-4" />
              {thumbnail ? "Choose another" : "Choose thumbnail"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {thumbnail
                ? `${thumbnail.name} · ${formatBytes(thumbnail.size)}`
                : `Accepted formats: ${ACCEPTED_THUMBNAIL_EXTENSIONS.join(", ")}.`}
            </p>
          </div>
        </div>
      </BuilderStep>

      <div className="flex flex-col items-start gap-3">
        <Button disabled={!canStart} onClick={start}>
          {busy ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <FileVideoIcon className="size-4" />
          )}
          {submitLabel(submit)}
        </Button>

        {submit.phase === "uploading" && (
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${Math.round(submit.progress * 100)}%` }}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {busy && (
          <p className="text-sm text-muted-foreground">
            Keep this page open until the upload finishes. The read that follows
            runs in the background.
          </p>
        )}
      </div>
    </div>
  )
}

function submitLabel(submit: SubmitPhase): string {
  switch (submit.phase) {
    case "creating":
      return "Starting your plan…"
    case "uploading":
      return `Uploading ${Math.round(submit.progress * 100)}%`
    case "finishing":
      return "Finishing up…"
    default:
      return "Start video plan"
  }
}

function BuilderStep({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="gap-4 p-6">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{icon}</span>
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  )
}
