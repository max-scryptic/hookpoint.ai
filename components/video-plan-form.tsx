"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  MAX_THUMBNAILS,
} from "@/lib/video-plans/config"
import type { SerialisedVideoPlan } from "@/lib/video-plans/serialise"
import { MAX_TITLES, TITLE_MAX_LENGTH } from "@/lib/video-plans/titles"
import {
  PLAN_READINESS_MESSAGE,
  type VideoPlanPackagingMode,
} from "@/lib/video-plans/video-plans"

const VIDEO_ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")
const THUMBNAIL_ACCEPT = ACCEPTED_THUMBNAIL_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",")

// What the footage is doing. The transfer is the only slow step, so it is the
// only one that carries a percentage; everything else is a single round trip.
type FootagePhase =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number }
  | { phase: "saving" }

type AbTestMode = "title" | "thumbnail" | "title-and-thumbnail"

const AB_TEST_OPTIONS: Array<{
  value: AbTestMode
  label: string
  description: string
}> = [
  {
    value: "title",
    label: "Title only",
    description: "One thumbnail with up to three titles.",
  },
  {
    value: "thumbnail",
    label: "Thumbnail only",
    description: "One title with up to three thumbnails.",
  },
  {
    value: "title-and-thumbnail",
    label: "Title and thumbnail",
    description: "Up to three matched title and thumbnail combinations.",
  },
]

function initialAbTestMode(plan: SerialisedVideoPlan): AbTestMode | null {
  return plan.packagingMode === "single" ? null : plan.packagingMode
}

// What the page knows about the footage attached to this plan. Filled from the
// plan's source-file row on the server, then kept up to date in the browser as
// an upload lands, so a creator who reloads sees the same thing either way.
interface Footage {
  filename: string
  sizeBytes: number | null
  durationSeconds: number | null
  ready: boolean
}

function footageFrom(sourceFile: SerialisedSourceFile | null): Footage | null {
  if (!sourceFile) return null
  return {
    filename: sourceFile.originalFilename,
    sizeBytes: sourceFile.fileSizeBytes,
    durationSeconds: sourceFile.uploadedDurationSeconds,
    ready: sourceFile.uploadStatus === "ready",
  }
}

// The draft half of a plan's page: the three things a viewer meets, collected
// one at a time against a plan row that already exists.
//
// Unlike a single submit-everything form, each piece is saved to the plan as
// soon as it is given - titles on blur, both files as they are picked - so a
// draft survives a reload, a closed tab or a second sitting. The button at the
// bottom therefore starts the read; it does not upload anything.
export function VideoPlanForm({
  plan,
  sourceFile,
}: {
  plan: SerialisedVideoPlan
  sourceFile: SerialisedSourceFile | null
}) {
  const router = useRouter()
  const initialTestMode = initialAbTestMode(plan)

  // One empty title to start: the second and third appear only when asked for,
  // so a creator with a single idea is never looking at two blank boxes.
  const [titles, setTitles] = useState<string[]>(
    initialTestMode === "title" || initialTestMode === "title-and-thumbnail"
      ? Array.from(
          { length: MAX_TITLES },
          (_, index) => plan.titles[index] ?? "",
        )
      : plan.titles.length > 0
        ? plan.titles
        : [""],
  )
  const [abTestMode, setAbTestMode] = useState<AbTestMode | null>(
    initialTestMode,
  )
  const [footage, setFootage] = useState<Footage | null>(footageFrom(sourceFile))
  const [footagePhase, setFootagePhase] = useState<FootagePhase>({
    phase: "idle",
  })
  const [thumbnailSlots, setThumbnailSlots] = useState<boolean[]>(
    Array.from(
      { length: MAX_THUMBNAILS },
      (_, index) => plan.thumbnailSlots[index] ?? false,
    ),
  )
  // Object URLs for thumbnails picked in this sitting; thumbnails already on
  // the plan are fetched from the signing route instead.
  const [thumbnailPreviews, setThumbnailPreviews] = useState<
    Array<string | null>
  >(Array.from({ length: MAX_THUMBNAILS }, () => null))
  const [thumbnailBusySlot, setThumbnailBusySlot] = useState<number | null>(null)
  const [savingTitles, setSavingTitles] = useState(false)
  const [savingPackagingMode, setSavingPackagingMode] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const videoInputRef = useRef<HTMLInputElement>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)
  const pendingThumbnailSlot = useRef(0)
  // What the server already holds, so a blur that changed nothing costs no
  // round trip. Seeded with the titles this page was rendered from.
  const savedTitles = useRef(JSON.stringify(plan.titles))
  const savedPackagingMode = useRef(plan.packagingMode)
  // The duration read off the file in this sitting, which the completion
  // endpoint wants. Only meaningful between picking a file and completing it.
  const pendingDuration = useRef<number | null>(null)

  const uploading = footagePhase.phase !== "idle"
  const busy =
    uploading || thumbnailBusySlot != null || savingPackagingMode || starting
  const activeTitles =
    abTestMode === "thumbnail" ? titles.slice(0, 1) : titles
  const filledTitles = activeTitles.map((title) => title.trim()).filter(Boolean)
  const hasThumbnail = thumbnailSlots[0] === true
  const firstTwoTitlesReady = [0, 1].every((index) =>
    Boolean(activeTitles[index]?.trim()),
  )
  const firstTwoThumbnailsReady = [0, 1].every(
    (index) => thumbnailSlots[index],
  )
  const firstTwoPairsReady = [0, 1].every(
    (index) => Boolean(titles[index]?.trim()) && thumbnailSlots[index],
  )
  const optionalPairsComplete = Array.from(
    { length: Math.min(MAX_TITLES, MAX_THUMBNAILS) - 2 },
    (_, offset) => offset + 2,
  ).every((index) => Boolean(titles[index]?.trim()) === thumbnailSlots[index])
  const abTestReady =
    abTestMode == null ||
    (abTestMode === "title" && firstTwoTitlesReady) ||
    (abTestMode === "thumbnail" && firstTwoThumbnailsReady) ||
    (abTestMode === "title-and-thumbnail" &&
      firstTwoPairsReady &&
      optionalPairsComplete)
  const canStart =
    !busy &&
    footage?.ready === true &&
    hasThumbnail &&
    filledTitles.length > 0 &&
    abTestReady &&
    !savingTitles &&
    !savingPackagingMode

  // Leaving mid-transfer would abort the upload and leave the plan without its
  // footage. Only guards while bytes are actually moving: everything else here
  // is already saved.
  useNavigationGuard(
    uploading,
    "Your footage is still uploading. Leaving this page will cancel the transfer. Are you sure you want to leave?",
  )

  // Object URLs outlive the element that used them, so the last one is released
  // when this page goes away. Tracked in a ref rather than read out of state,
  // which by unmount is no longer ours to touch.
  const thumbnailPreviewRefs = useRef<Array<string | null>>(
    Array.from({ length: MAX_THUMBNAILS }, () => null),
  )
  useEffect(() => {
    const previews = thumbnailPreviewRefs.current
    return () => {
      for (const preview of previews) {
        if (preview) URL.revokeObjectURL(preview)
      }
    }
  }, [])

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

  // Saves the titles as they stand, unless the server already has exactly
  // these. Returns whether the plan is now holding them, so the caller that
  // starts the read can stop if it isn't.
  const saveTitles = useCallback(
    async (next: string[]): Promise<boolean> => {
      const payload = next.map((title) => title.trim()).filter(Boolean)
      const serialised = JSON.stringify(payload)
      if (serialised === savedTitles.current) return true

      setSavingTitles(true)
      try {
        const response = await fetch(`/api/video-plans/${plan.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titles: payload }),
        })
        if (!response.ok) {
          setError(await messageFrom(response, "Could not save your titles."))
          return false
        }
        savedTitles.current = serialised
        setError(null)
        return true
      } catch {
        setError("Could not save your titles.")
        return false
      } finally {
        setSavingTitles(false)
      }
    },
    [plan.id],
  )

  function setTitleAt(index: number, value: string) {
    setTitles((previous) =>
      previous.map((title, i) => (i === index ? value : title)),
    )
  }

  function selectAbTestMode(mode: AbTestMode) {
    setAbTestMode(mode)
    void savePackagingMode(mode)

    if (mode === "thumbnail") {
      const next = [titles[0] ?? ""]
      setTitles(next)
      void saveTitles(next)
      return
    }

    setTitles((previous) =>
      Array.from(
        { length: MAX_TITLES },
        (_, index) => previous[index] ?? "",
      ),
    )
  }

  function cancelAbTest() {
    const nextTitles = [titles[0] ?? ""]
    setAbTestMode(null)
    setTitles(nextTitles)
    void savePackagingMode("single")
    void saveTitles(nextTitles)
  }

  async function savePackagingMode(mode: VideoPlanPackagingMode) {
    if (mode === savedPackagingMode.current) return

    setSavingPackagingMode(true)
    try {
      const response = await fetch(`/api/video-plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packagingMode: mode }),
      })
      if (!response.ok) {
        setError(await messageFrom(response, "Could not save the A/B test."))
        return
      }
      savedPackagingMode.current = mode
      setError(null)
    } catch {
      setError("Could not save the A/B test.")
    } finally {
      setSavingPackagingMode(false)
    }
  }

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
    // Read the duration now, while the browser still holds the file: it goes to
    // the completion endpoint, and showing it back is how a creator confirms
    // they picked the cut they meant to.
    pendingDuration.current = await readVideoDuration(picked)
    setFootage({
      filename: picked.name,
      sizeBytes: picked.size,
      durationSeconds: pendingDuration.current,
      ready: false,
    })

    try {
      await uploadFootage(picked)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong while uploading your footage.",
      )
      setFootagePhase({ phase: "idle" })
    }
  }

  // Mints an upload target, transfers the bytes and confirms them, marking the
  // footage ready when it lands. On a refusal it reports the message and stops;
  // the plan keeps whatever footage it had before.
  async function uploadFootage(video: File) {
    const initRes = await fetch(
      `/api/video-plans/${plan.id}/source-file/initiate-upload`,
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
      setFootagePhase({ phase: "idle" })
      return
    }

    setFootagePhase({ phase: "uploading", progress: 0 })
    const onProgress = (progress: number) =>
      setFootagePhase({ phase: "uploading", progress })

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
      setFootagePhase({ phase: "idle" })
      return
    }

    setFootagePhase({ phase: "saving" })
    const durationSeconds = pendingDuration.current
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
      setFootagePhase({ phase: "idle" })
      return
    }

    const completed = (await completeRes.json().catch(() => null)) as {
      sourceFile?: SerialisedSourceFile
    } | null

    setFootage(
      footageFrom(completed?.sourceFile ?? null) ?? {
        filename: video.name,
        sizeBytes: video.size,
        durationSeconds,
        ready: true,
      },
    )
    setFootagePhase({ phase: "idle" })
  }

  async function onPickThumbnail(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    event.target.value = ""
    if (!picked) return
    const slot = pendingThumbnailSlot.current

    if (!Object.values(ACCEPTED_THUMBNAIL_TYPES).includes(picked.type)) {
      setError(
        `Unsupported image type. Accepted: ${ACCEPTED_THUMBNAIL_EXTENSIONS.join(", ")}.`,
      )
      return
    }

    setError(null)
    setThumbnailBusySlot(slot)
    // Shown straight away from the file the browser is holding, so the creator
    // sees what they picked while it is still going up.
    if (thumbnailPreviewRefs.current[slot]) {
      URL.revokeObjectURL(thumbnailPreviewRefs.current[slot])
    }
    const preview = URL.createObjectURL(picked)
    thumbnailPreviewRefs.current[slot] = preview
    setThumbnailPreviews((previous) =>
      previous.map((value, index) => (index === slot ? preview : value)),
    )

    try {
      const form = new FormData()
      form.append("file", picked)
      const response = await fetch(
        `/api/video-plans/${plan.id}/thumbnail?slot=${slot}`,
        {
          method: "POST",
          body: form,
        },
      )
      if (!response.ok) {
        setError(await messageFrom(response, "Could not upload the thumbnail."))
        return
      }
      setThumbnailSlots((previous) =>
        previous.map((value, index) => (index === slot ? true : value)),
      )
    } catch {
      setError("Could not upload the thumbnail.")
    } finally {
      setThumbnailBusySlot(null)
    }
  }

  function chooseThumbnail(slot: number) {
    pendingThumbnailSlot.current = slot
    thumbnailInputRef.current?.click()
  }

  function renderTitleField(index: number, label: string) {
    const required = abTestMode ? index < 2 : index === 0
    return (
      <div key={`title-${index}`} className="space-y-2">
        <Label htmlFor={`title-${index}`}>
          {label}
          {required ? (
            <span className="text-muted-foreground"> (required)</span>
          ) : null}
        </Label>
        <Input
          id={`title-${index}`}
          value={titles[index] ?? ""}
          maxLength={TITLE_MAX_LENGTH}
          disabled={busy}
          placeholder={
            abTestMode === "title" || abTestMode === "title-and-thumbnail"
              ? `Add title ${index + 1}`
              : "Add your title"
          }
          onChange={(event) => setTitleAt(index, event.target.value)}
          onBlur={() => void saveTitles(activeTitles)}
        />
      </div>
    )
  }

  function renderThumbnailSlot(index: number, label: string) {
    const preview = thumbnailPreviews[index]
    const uploaded = thumbnailSlots[index]
    const busySlot = thumbnailBusySlot === index
    const required = abTestMode ? index < 2 : index === 0

    return (
      <div key={`thumbnail-${index}`} className="space-y-2">
        <Label>
          {label}
          {required ? (
            <span className="text-muted-foreground"> (required)</span>
          ) : null}
        </Label>
        <div className="overflow-hidden rounded-lg border bg-muted/25">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="aspect-video w-full object-cover"
            />
          ) : uploaded ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/video-plans/${plan.id}/thumbnail?slot=${index}`}
              alt=""
              className="aspect-video w-full object-cover"
            />
          ) : (
            <button
              type="button"
              disabled={busy}
              aria-label={`Add ${label.toLowerCase()}`}
              onClick={() => chooseThumbnail(index)}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 border border-dashed border-transparent text-sm text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <ImageIcon className="size-5" />
              Add thumbnail
            </button>
          )}
        </div>
        {preview || uploaded ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Choose another ${label.toLowerCase()}`}
            onClick={() => chooseThumbnail(index)}
          >
            {busySlot ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <UploadIcon className="size-4" />
            )}
            {busySlot ? "Uploading" : "Choose another"}
          </Button>
        ) : null}
      </div>
    )
  }

  // Everything is already on the plan by this point, so starting is: save any
  // title still sitting unblurred in the box, then ask for the read. The page
  // re-renders from the server afterwards, which is what swaps this form for
  // the report.
  async function start() {
    setStarting(true)
    setError(null)

    try {
      if (!(await saveTitles(activeTitles))) {
        setStarting(false)
        return
      }

      const response = await fetch(`/api/video-plans/${plan.id}/process`, {
        method: "POST",
      })
      if (!response.ok) {
        setError(await messageFrom(response, "Could not start the video plan."))
        setStarting(false)
        return
      }

      const data = (await response.json().catch(() => null)) as {
        waitingFor?: keyof typeof PLAN_READINESS_MESSAGE
      } | null

      // The read refused because something is still missing. Say which,
      // rather than leaving the button spinning at a plan that will not run.
      if (data?.waitingFor) {
        setError(
          PLAN_READINESS_MESSAGE[data.waitingFor] ??
            "This plan is not ready to be read yet.",
        )
        setStarting(false)
        return
      }

      router.refresh()
    } catch {
      setError("Something went wrong while starting your plan.")
      setStarting(false)
    }
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

      <PlanStep
        icon={<TypeIcon className="size-4 text-muted-foreground" />}
        title="Title & thumbnail"
        description={
          abTestMode
            ? "Add the packaging options you are considering for this video."
            : "Start with the title and thumbnail you plan to publish."
        }
        action={
          abTestMode ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label="Cancel A/B test"
              title="Cancel A/B test"
              onClick={cancelAbTest}
            >
              <XIcon className="size-4" />
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-5">
          {abTestMode ? (
            <div
              role="group"
              aria-label="A/B test type"
              className="grid gap-2 sm:grid-cols-3"
            >
              {AB_TEST_OPTIONS.map((option) => {
                const selected = option.value === abTestMode
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => selectAbTestMode(option.value)}
                    className={`flex min-h-20 flex-col items-start justify-center rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${
                      selected
                        ? "border-primary bg-accent text-foreground"
                        : "bg-card hover:bg-muted/60"
                    }`}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {abTestMode === "title-and-thumbnail" ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {Array.from({ length: MAX_TITLES }, (_, index) => (
                <div
                  key={index}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/25 p-3"
                >
                  <p className="text-sm font-medium">
                    Option {String.fromCharCode(65 + index)}
                  </p>
                  {renderTitleField(index, `Title ${index + 1}`)}
                  {renderThumbnailSlot(index, `Thumbnail ${index + 1}`)}
                </div>
              ))}
            </div>
          ) : abTestMode === "title" ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,1fr)] lg:items-start">
              <div className="flex min-w-0 flex-col gap-3">
                {Array.from({ length: MAX_TITLES }, (_, index) =>
                  renderTitleField(index, `Title ${index + 1}`),
                )}
              </div>

              <div className="min-w-0">
                {renderThumbnailSlot(0, "Thumbnail")}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {[0].map((index) =>
                  renderTitleField(
                    index,
                    "Title",
                  ),
                )}
              </div>

              <div
                className={
                  abTestMode === "thumbnail"
                    ? "grid gap-3 sm:grid-cols-3"
                    : "max-w-sm"
                }
              >
                {(abTestMode === "thumbnail"
                  ? Array.from({ length: MAX_THUMBNAILS }, (_, index) => index)
                  : [0]
                ).map((index) =>
                  renderThumbnailSlot(
                    index,
                    abTestMode === "thumbnail"
                      ? `Thumbnail ${index + 1}`
                      : "Thumbnail",
                  ),
                )}
              </div>
            </>
          )}

          {abTestMode ? null : (
            <div className="flex flex-col items-start gap-1.5 border-t pt-4">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => selectAbTestMode("title")}
              >
                <PlusIcon className="size-4" />
                Set up A/B test
              </Button>
            </div>
          )}

          {thumbnailBusySlot != null ? (
            <p className="text-xs text-muted-foreground">
              Uploading your thumbnail…
            </p>
          ) : null}
        </div>
      </PlanStep>

      <PlanStep
        icon={<FileVideoIcon className="size-4 text-muted-foreground" />}
        title="Upload video"
        description="The cut you are about to publish. Nothing is made public; we read its opening to hear the hook your titles and thumbnails have to match."
      >
        {footage ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {footage.filename}
                </p>
                <p className="text-sm text-muted-foreground">
                  {footage.sizeBytes != null
                    ? `${formatBytes(footage.sizeBytes)} · `
                    : ""}
                  {formatDuration(footage.durationSeconds)}
                  {footagePhase.phase === "idle" && !footage.ready
                    ? " · not uploaded"
                    : ""}
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

            {footagePhase.phase === "uploading" && (
              <div className="h-2 w-full max-w-md overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm bg-primary transition-[width] duration-150"
                  style={{
                    width: `${Math.round(footagePhase.progress * 100)}%`,
                  }}
                />
              </div>
            )}

            {uploading && (
              <p className="text-sm text-muted-foreground">
                {footagePhase.phase === "uploading"
                  ? `Uploading ${Math.round(footagePhase.progress * 100)}%. Keep this page open until it finishes.`
                  : "Saving your footage…"}
              </p>
            )}
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
      </PlanStep>

      <div className="flex flex-col items-start gap-3">
        <Button disabled={!canStart} onClick={start}>
          {starting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <FileVideoIcon className="size-4" />
          )}
          {starting ? "Starting your review…" : "Review video"}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!error &&
          !canStart &&
          !busy &&
          !savingTitles &&
          !savingPackagingMode && (
            <p className="text-sm text-muted-foreground">
              {missingPieceMessage({
                footage,
                hasThumbnail,
                titleCount: filledTitles.length,
                abTestMode,
                abTestReady,
              })}
            </p>
          )}
      </div>
    </div>
  )
}

// What is still needed, checked in the order the page asks for it. Says one
// thing at a time: a creator who has just landed on an empty plan does not need
// all three read back to them.
function missingPieceMessage({
  footage,
  hasThumbnail,
  titleCount,
  abTestMode,
  abTestReady,
}: {
  footage: Footage | null
  hasThumbnail: boolean
  titleCount: number
  abTestMode: AbTestMode | null
  abTestReady: boolean
}): string {
  if (titleCount === 0) return "Add at least one title idea to start the plan."
  if (!hasThumbnail) return "Add your thumbnail to start the plan."
  if (!abTestReady) {
    if (abTestMode === "title") {
      return "Add at least two title options to run a title A/B test."
    }
    if (abTestMode === "thumbnail") {
      return "Add at least two thumbnail options to run a thumbnail A/B test."
    }
    return "Complete the required title and thumbnail combinations to run an A/B test."
  }
  if (!footage?.ready) return "Upload your video to start the plan."
  return "Everything is saved. You can start the plan whenever you are ready."
}

function PlanStep({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5">{icon}</span>
          <div>
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}
