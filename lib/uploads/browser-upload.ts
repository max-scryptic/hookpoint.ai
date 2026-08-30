// The browser half of a direct-to-storage upload: slicing a picked file into
// parts, PUTting them, and reading back what the local file says about itself.
//
// This was written inside components/source-file-upload.tsx, where it drove the
// upload on an analysed video's report. The Video Planner uploads the same way
// against a different owner, so the mechanics moved here and both surfaces call
// them - the alternative was a second copy of the multipart retry logic, which
// is exactly the code you least want two versions of.
//
// Client-safe by construction: no imports at all, so nothing server-only (the
// AWS SDK behind @/lib/storage in particular) can be dragged into the bundle by
// including this.

// One finished part the browser reports back to the completion endpoint.
export interface CompletedPart {
  partNumber: number
  etag: string
}

// A planned multipart upload, as the initiate endpoint describes it.
export interface MultipartTarget {
  provider: string
  uploadId: string
  partSizeBytes: number
  totalParts: number
  parts: { partNumber: number; signedUrl: string }[]
  expiresAt?: string
}

// The single-PUT target, for providers without multipart support.
export interface SingleUploadTarget {
  provider: string
  bucket: string
  path: string
  token?: string
  signedUrl?: string
  expiresAt?: string
}

// What an initiate-upload endpoint answers with. Both the analysed-video and
// the video-plan routes return this exact shape, which is what lets the two
// surfaces share every line of upload code below: only the URL differs.
// Exactly one of `upload` and `multipartUpload` is present.
export interface UploadInitResponse<TSourceFile> {
  sourceFile: TSourceFile
  upload?: SingleUploadTarget
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
export async function uploadFileMultipart(
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

// Drives a direct-to-storage PUT of `file` to the Supabase signed upload URL,
// reporting progress. Uses XHR (not fetch) because only XHR exposes upload
// progress events, which power the progress bar for these large files.
export function uploadToSignedUrl(
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

// Reads a video file's duration in the browser by loading just its metadata via
// an off-screen <video> element. The browser already holds the picked file, so
// this is essentially free and avoids any server-side probing. Resolves to null
// when the browser can't decode the container (notably most .mkv files) or the
// metadata can't be read within a short grace period - the server treats null as
// "couldn't verify" rather than a failure.
export function readVideoDuration(file: File): Promise<number | null> {
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

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "N/A"
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

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "N/A"
  const total = Math.round(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}
