"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  FileVideoIcon,
  Loader2Icon,
  TrashIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { notifySourceFileReady } from "@/components/source-video-thumbnail"
import { ACCEPTED_EXTENSIONS, isAcceptedExtension } from "@/lib/source-files/config"
import type { SerialisedSourceFile } from "@/lib/source-files/serialise"
import {
  compareDuration,
  computeFilenameSimilarity,
  filenameStatusFromScore,
  type FilenameValidationStatus,
} from "@/lib/source-files/validation"

// The accept attribute / human hint for the file picker.
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",")

type ClientState =
  | { phase: "idle" }
  | { phase: "preparing"; filename: string }
  | {
      phase: "warning"
      file: File
      durationSeconds: number | null
      durationDifferenceSeconds: number | null
      durationMismatch: boolean
      filenameStatus: FilenameValidationStatus
    }
  | { phase: "uploading"; progress: number; filename: string }
  | { phase: "processing"; filename: string }
  | { phase: "error"; message: string }

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—"
  const total = Math.round(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}

// One finished part the browser reports back to the completion endpoint. Defined
// locally (not imported from @/lib/storage) so the server-only storage barrel —
// and the AWS SDK it pulls in — never reaches the browser bundle.
interface CompletedPart {
  partNumber: number
  etag: string
}

interface MultipartTarget {
  provider: string
  uploadId: string
  partSizeBytes: number
  totalParts: number
  parts: { partNumber: number; signedUrl: string }[]
  expiresAt?: string
}

interface UploadInitResponse {
  sourceFile: SerialisedSourceFile
  // The single-PUT path returns `upload`; the parallel path returns
  // `multipartUpload`. Exactly one is present.
  upload?: {
    provider: string
    bucket: string
    path: string
    token?: string
    signedUrl?: string
    expiresAt?: string
  }
  multipartUpload?: MultipartTarget
}

// How many parts upload at once. Several concurrent streams are what overcome a
// single TCP stream's bandwidth-delay-product ceiling and let the upload reach
// the user's actual uplink. Kept modest so we don't thrash memory slicing the
// file or trip provider per-connection limits.
const MULTIPART_CONCURRENCY = 4
// Per-part retry budget. Parts are independent, so a transient blip on one part
// retries just that part instead of restarting the whole multi-GB upload.
const PART_MAX_ATTEMPTS = 3

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// PUTs a single part's bytes to its signed URL and resolves with the storage
// ETag, which completion needs to assemble the object. Reports bytes-so-far for
// this part via onProgress.
function uploadPart(
  signedUrl: string,
  body: Blob,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", signedUrl)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag =
          xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag")
        if (!etag) {
          // The bucket's S3 CORS must expose the ETag header, or we can't
          // complete the upload. Surface this clearly rather than silently hang.
          reject(
            new Error(
              "Upload response was missing its ETag. The storage bucket's CORS config must expose the ETag header.",
            ),
          )
          return
        }
        resolve(etag)
      } else {
        reject(new Error(`Part upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error("A part upload was interrupted."))
    xhr.onabort = () => reject(new Error("Upload was cancelled."))
    xhr.send(body)
  })
}

// Uploads `file` in parallel as a multipart upload: slices it into the planned
// parts and PUTs up to MULTIPART_CONCURRENCY of them at once, retrying any part
// that fails. Reports aggregate progress (0..1) across all parts and resolves
// with the per-part ETags. Rejects if any part exhausts its retries.
async function uploadFileMultipart(
  file: File,
  target: MultipartTarget,
  onProgress: (fraction: number) => void,
): Promise<CompletedPart[]> {
  const total = file.size
  const loaded = new Array<number>(target.parts.length).fill(0)
  const completed = new Array<CompletedPart | undefined>(target.parts.length)

  const reportProgress = () => {
    const sum = loaded.reduce((a, b) => a + b, 0)
    onProgress(total > 0 ? Math.min(sum / total, 1) : 1)
  }

  // Index-based work queue. Incrementing is atomic in JS's single-threaded model,
  // so the workers never grab the same part.
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++
      if (index >= target.parts.length) return

      const part = target.parts[index]
      const start = index * target.partSizeBytes
      const end = Math.min(start + target.partSizeBytes, total)
      const blob = file.slice(start, end)
      const partBytes = end - start

      let lastError: unknown
      for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
        try {
          loaded[index] = 0
          const etag = await uploadPart(part.signedUrl, blob, (partLoaded) => {
            loaded[index] = Math.min(partLoaded, partBytes)
            reportProgress()
          })
          loaded[index] = partBytes
          reportProgress()
          completed[index] = { partNumber: part.partNumber, etag }
          break
        } catch (error) {
          lastError = error
          if (attempt < PART_MAX_ATTEMPTS) await delay(attempt * 1000)
        }
      }

      if (!completed[index]) {
        throw lastError instanceof Error
          ? lastError
          : new Error("A part failed to upload.")
      }
    }
  }

  const workerCount = Math.min(MULTIPART_CONCURRENCY, target.parts.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return completed.filter((p): p is CompletedPart => p != null)
}

// Reads a video file's duration in the browser by loading just its metadata via
// an off-screen <video> element. The browser already holds the picked file, so
// this is essentially free and avoids any server-side probing. Resolves to null
// when the browser can't decode the container (notably most .mkv files) or the
// metadata can't be read within a short grace period — the server treats null as
// "couldn't verify" rather than a failure.
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false

    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      video.load()
      resolve(value)
    }

    // Some formats never fire loadedmetadata or error; cap the wait so a stuck
    // probe can't hold up completing the upload.
    const timer = setTimeout(() => finish(null), 15_000)

    video.preload = "metadata"
    video.onloadedmetadata = () => {
      const duration = video.duration
      finish(Number.isFinite(duration) && duration > 0 ? duration : null)
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}

// Drives a direct-to-storage PUT of `file` to the Supabase signed upload URL,
// reporting progress. Uses XHR (not fetch) because only XHR exposes upload
// progress events, which power the progress bar for these large files.
function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", signedUrl)
    // Mirrors @supabase/storage-js uploadToSignedUrl: a multipart body whose
    // unnamed field carries the file, plus the cache-control field.
    const form = new FormData()
    form.append("cacheControl", "3600")
    form.append("", file)
    xhr.setRequestHeader("x-upsert", "false")

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error("Upload was interrupted."))
    xhr.onabort = () => reject(new Error("Upload was cancelled."))
    xhr.send(form)
  })
}

export function SourceFileUpload({
  videoId,
  videoTitle,
  youtubeDurationSeconds,
  durationToleranceSeconds,
  filenameSimilarityThreshold,
  initialSourceFile,
}: {
  videoId: string
  videoTitle: string
  youtubeDurationSeconds: number
  durationToleranceSeconds: number
  filenameSimilarityThreshold: number
  initialSourceFile: SerialisedSourceFile | null
}) {
  const [sourceFile, setSourceFile] = useState<SerialisedSourceFile | null>(
    initialSourceFile,
  )
  const [client, setClient] = useState<ClientState>({ phase: "idle" })
  const inputRef = useRef<HTMLInputElement>(null)

  // Whether a stored record is in a settled (non-in-flight) state.
  const isBusy =
    client.phase === "preparing" ||
    client.phase === "uploading" ||
    client.phase === "processing"

  // While an upload is in flight, warn the user before they unload the page
  // (reload, tab close, or navigating to another site). Leaving would abort the
  // direct-to-storage transfer and strand the record mid-upload. The listener is
  // only attached while busy so it never blocks navigation at rest. Note: this
  // covers hard navigations only — the browser's native prompt can't be invoked
  // from client-side (in-app) route changes.
  useEffect(() => {
    if (!isBusy) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers require returnValue to be set for the prompt to show.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isBusy])

  async function preflightFile(file: File) {
    // Inspect the local file before creating an upload or transferring bytes.
    setClient({ phase: "preparing", filename: file.name })

    // Client-side format check for fast feedback. The server enforces it again.
    if (!isAcceptedExtension(file.name)) {
      setClient({
        phase: "error",
        message: `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      })
      return
    }

    const durationSeconds = await readVideoDuration(file)
    const filenameStatus = filenameStatusFromScore(
      computeFilenameSimilarity(file.name, videoTitle),
      filenameSimilarityThreshold,
    )
    const durationComparison =
      durationSeconds != null && youtubeDurationSeconds > 0
        ? compareDuration(
            durationSeconds,
            youtubeDurationSeconds,
            durationToleranceSeconds,
          )
        : null
    const durationMismatch = durationComparison?.status === "failed"

    if (
      durationMismatch ||
      durationComparison == null ||
      filenameStatus !== "passed"
    ) {
      setClient({
        phase: "warning",
        file,
        durationSeconds,
        durationDifferenceSeconds: durationComparison?.differenceSeconds ?? null,
        durationMismatch,
        filenameStatus,
      })
      return
    }

    await uploadFile(file, durationSeconds)
  }

  async function uploadFile(
    file: File,
    durationSeconds: number | null,
  ) {
    // Lock the UI before the initiate-upload round-trip so a second upload
    // cannot be started in the gap before transfer progress appears.
    setClient({ phase: "preparing", filename: file.name })

    try {
      // 1. Ask the backend to create the record + a signed upload target.
      const initRes = await fetch(
        `/api/videos/${videoId}/source-file/initiate-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || null,
            fileSizeBytes: file.size,
          }),
        },
      )
      const initData = (await initRes.json()) as
        | UploadInitResponse
        | { error?: string; message?: string }

      const hasTarget =
        "upload" in initData || "multipartUpload" in initData
      if (!initRes.ok || !hasTarget) {
        setClient({
          phase: "error",
          message:
            ("message" in initData && initData.message) ||
            "Could not start the upload.",
        })
        return
      }

      const created = (initData as UploadInitResponse).sourceFile
      setSourceFile(created)

      // 2. Upload the bytes straight to storage with a progress bar. Large files
      // go via a parallel multipart upload; smaller ones (or the Supabase
      // single-PUT provider) use one signed PUT. The completion body differs:
      // multipart must report its part ETags, single-PUT sends nothing.
      setClient({ phase: "uploading", progress: 0, filename: file.name })

      const onUploadProgress = (fraction: number) =>
        setClient({ phase: "uploading", progress: fraction, filename: file.name })

      const multipart = (initData as UploadInitResponse).multipartUpload
      const single = (initData as UploadInitResponse).upload

      let multipartParts: CompletedPart[] | undefined
      if (multipart) {
        try {
          multipartParts = await uploadFileMultipart(
            file,
            multipart,
            onUploadProgress,
          )
        } catch (error) {
          // Best-effort: tell the server to discard the orphaned parts so they
          // don't linger until the bucket lifecycle rule reaps them.
          void fetch(`/api/source-files/${created.id}/abort-upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId: multipart.uploadId }),
          }).catch(() => {})
          throw error
        }
      } else if (single?.signedUrl) {
        await uploadToSignedUrl(single.signedUrl, file, onUploadProgress)
      } else {
        setClient({ phase: "error", message: "No upload URL was provided." })
        return
      }

      // 3. Tell the backend the upload finished; it verifies the object and
      // recomputes validation from the preflight duration. For a multipart
      // upload we also send the part list so the server can assemble it.
      setClient({ phase: "processing", filename: file.name })
      const completeRes = await fetch(
        `/api/source-files/${created.id}/complete-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            multipart
              ? {
                  durationSeconds,
                  uploadId: multipart.uploadId,
                  parts: multipartParts,
                }
              : { durationSeconds },
          ),
        },
      )
      const completeData = (await completeRes.json()) as
        | { sourceFile: SerialisedSourceFile }
        | { error?: string; message?: string }

      if (!completeRes.ok || !("sourceFile" in completeData)) {
        setClient({
          phase: "error",
          message:
            ("message" in completeData && completeData.message) ||
            "Validation could not be completed.",
        })
        return
      }

      setSourceFile(completeData.sourceFile)
      setClient({ phase: "idle" })
      notifySourceFileReady(videoId)
    } catch (error) {
      setClient({
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : "Something went wrong during the upload.",
      })
    }
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so picking the same file again re-triggers onChange.
    event.target.value = ""
    if (file) void preflightFile(file)
  }

  function proceedAfterWarning() {
    if (client.phase !== "warning") return
    // A measured duration mismatch is blocking; only soft warnings (filename
    // similarity or an unreadable duration) can be explicitly overridden.
    if (client.durationMismatch) return
    void uploadFile(client.file, client.durationSeconds)
  }

  function chooseAnotherFile() {
    setClient({ phase: "idle" })
    inputRef.current?.click()
  }

  async function onDelete() {
    if (!sourceFile) return
    const previous = sourceFile
    setSourceFile(null)
    setClient({ phase: "idle" })
    const res = await fetch(`/api/source-files/${previous.id}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      // Restore so the user can retry the delete.
      setSourceFile(previous)
      setClient({ phase: "error", message: "Could not delete the file." })
    }
  }

  function triggerPicker() {
    inputRef.current?.click()
  }

  return (
    <section
      id="source-file-upload"
      tabIndex={-1}
      className="flex scroll-mt-4 flex-col gap-3 outline-none"
    >
      <div className="flex items-center gap-2">
        <FileVideoIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Raw source file</h2>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={onPick}
      />

      <div className="rounded-xl border bg-card p-4">
        <Body
          sourceFile={sourceFile}
          client={client}
          isBusy={isBusy}
          onPick={triggerPicker}
          onDelete={onDelete}
          onProceed={proceedAfterWarning}
          onChooseAnother={chooseAnotherFile}
          videoTitle={videoTitle}
          youtubeDurationSeconds={youtubeDurationSeconds}
        />
      </div>
    </section>
  )
}

function Body({
  sourceFile,
  client,
  isBusy,
  onPick,
  onDelete,
  onProceed,
  onChooseAnother,
  videoTitle,
  youtubeDurationSeconds,
}: {
  sourceFile: SerialisedSourceFile | null
  client: ClientState
  isBusy: boolean
  onPick: () => void
  onDelete: () => void
  onProceed: () => void
  onChooseAnother: () => void
  videoTitle: string
  youtubeDurationSeconds: number
}) {
  // In-flight states take precedence over the stored record's state.
  if (client.phase === "preparing") {
    return (
      <StatusRow
        icon={<Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        title="Preparing upload…"
        subtitle={client.filename}
      />
    )
  }

  if (client.phase === "warning") {
    return (
      <div className="flex flex-col gap-3">
        <StatusRow
          icon={<AlertTriangleIcon className="size-4 text-amber-500" />}
          title="Please check this file before uploading"
          subtitle={client.file.name}
        />
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
          {client.durationMismatch && (
            <li>
              Its duration is {formatDuration(client.durationSeconds)}, while the
              YouTube video is {formatDuration(youtubeDurationSeconds)} — a difference
              of {client.durationDifferenceSeconds?.toFixed(1) ?? "?"} seconds.
            </li>
          )}
          {client.durationSeconds == null && (
            <li>The browser couldn’t read this file’s duration.</li>
          )}
          {client.filenameStatus === "warning" && (
            <li>
              The filename doesn’t look similar to the YouTube title “{videoTitle}”.
            </li>
          )}
          {client.filenameStatus === "unknown" && (
            <li>The filename couldn’t be compared with the YouTube title.</li>
          )}
        </ul>
        <p className="text-sm text-muted-foreground">
          {client.durationMismatch
            ? "The duration must match the YouTube video before this source file can be uploaded."
            : "No video data has been uploaded yet. Continue only if this is the correct source file."}
        </p>
        <div className="flex flex-wrap gap-2">
          {!client.durationMismatch && (
            <Button onClick={onProceed}>
              <UploadIcon className="size-4" />
              Upload anyway
            </Button>
          )}
          <Button variant="outline" onClick={onChooseAnother}>
            Choose another file
          </Button>
        </div>
      </div>
    )
  }

  if (client.phase === "uploading") {
    const pct = Math.round(client.progress * 100)
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <UploadIcon className="size-4 text-muted-foreground" />
          <span className="truncate">Uploading {client.filename}…</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }

  if (client.phase === "processing") {
    return (
      <StatusRow
        icon={<Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        title="Validating your file…"
        subtitle="Checking the uploaded file matches this video."
      />
    )
  }

  // No stored file yet (and nothing in flight): show the upload CTA.
  if (!sourceFile || sourceFile.uploadStatus === "pending") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Upload the original video file to enable deeper visual analysis.
        </p>
        <Button onClick={onPick} disabled={isBusy}>
          <UploadIcon className="size-4" />
          Upload source file
        </Button>
        {client.phase === "error" && client.message && (
          <p className="text-sm text-destructive">{client.message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Accepted formats: {ACCEPTED_EXTENSIONS.join(", ")}.
        </p>
      </div>
    )
  }

  // A processing/validating record loaded from the server.
  if (
    sourceFile.uploadStatus === "uploaded" ||
    sourceFile.uploadStatus === "processing" ||
    sourceFile.uploadStatus === "uploading"
  ) {
    return (
      <StatusRow
        icon={<Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        title="Validating your file…"
        subtitle={sourceFile.originalFilename}
      />
    )
  }

  // Failed: show the reason and allow retry / re-upload.
  if (sourceFile.uploadStatus === "failed" || sourceFile.validationStatus === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <StatusRow
          icon={<XCircleIcon className="size-4 text-destructive" />}
          title="Upload couldn’t be validated"
          subtitle={sourceFile.originalFilename}
          tone="error"
        />
        {sourceFile.failureReason && (
          <p className="text-sm text-destructive">{sourceFile.failureReason}</p>
        )}
        <Meta sourceFile={sourceFile} />
        <div className="flex gap-2">
          <Button onClick={onPick} disabled={isBusy}>
            <UploadIcon className="size-4" />
            Re-upload
          </Button>
          <Button variant="outline" onClick={onDelete} disabled={isBusy}>
            <TrashIcon className="size-4" />
            Remove
          </Button>
        </div>
      </div>
    )
  }

  // Ready. Validation now happens before the upload begins, so a stored file is
  // simply shown as ready — no post-upload warning messages on the card.
  return (
    <div className="flex flex-col gap-3">
      <StatusRow
        icon={<CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />}
        title="Source file ready"
        subtitle={sourceFile.originalFilename}
      />

      <Meta sourceFile={sourceFile} />

      <div className="flex gap-2">
        <Button variant="outline" onClick={onPick} disabled={isBusy}>
          <UploadIcon className="size-4" />
          Replace
        </Button>
        <Button variant="outline" onClick={onDelete} disabled={isBusy}>
          <TrashIcon className="size-4" />
          Remove
        </Button>
      </div>
    </div>
  )
}

function StatusRow({
  icon,
  title,
  subtitle,
  tone = "default",
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  tone?: "default" | "error"
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p
          className={`text-sm font-medium ${tone === "error" ? "text-destructive" : ""}`}
        >
          {title}
        </p>
        {subtitle && (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

function Meta({ sourceFile }: { sourceFile: SerialisedSourceFile }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
      <Field label="File size" value={formatBytes(sourceFile.fileSizeBytes)} />
      <Field
        label="Duration"
        value={formatDuration(sourceFile.uploadedDurationSeconds)}
      />
      <Field
        label="Duration check"
        value={
          sourceFile.durationValidationStatus === "passed"
            ? "Matches YouTube"
            : sourceFile.durationValidationStatus === "failed"
              ? `Off by ${sourceFile.durationDifferenceSeconds?.toFixed(1) ?? "?"}s`
              : "Not verified"
        }
      />
      <Field
        label="Filename check"
        value={
          sourceFile.filenameValidationStatus === "passed"
            ? "Looks like the title"
            : sourceFile.filenameValidationStatus === "warning"
              ? "Doesn’t match title"
              : sourceFile.filenameValidationStatus === "unknown"
                ? "Couldn’t compare"
                : "—"
        }
      />
    </dl>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
