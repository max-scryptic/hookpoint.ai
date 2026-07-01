// Object-storage abstraction for raw source-file uploads. The rest of the app
// talks to this provider-agnostic interface so the concrete backend (Supabase
// Storage today; S3/R2/a resumable-TUS provider later) can be swapped without
// touching the upload routes, the validation service or the UI.
//
// The design goal is "direct-to-storage": the app server never proxies the file
// bytes. It hands the browser a short-lived signed upload target, the browser
// PUTs straight to storage, then the app verifies the object server-side.

export interface SignedUpload {
  // Opaque details the client needs to upload directly to storage. The shape is
  // provider-specific; the Supabase provider returns a path + token pair.
  provider: string
  bucket: string
  path: string
  // Provider token (Supabase) — used by the browser's uploadToSignedUrl call.
  token?: string
  // Fully-qualified signed URL, when the provider exposes one (S3/R2 style PUT).
  signedUrl?: string
  // When the signed target stops being valid (best-effort, ISO string).
  expiresAt?: string
}

export interface StorageObjectInfo {
  exists: boolean
  // Size in bytes as reported by storage — the authoritative value we persist,
  // never the client-claimed size. Null when the object is missing.
  sizeBytes: number | null
  // Content type storage recorded for the object, when available.
  contentType: string | null
}

// One part of a multipart upload, as handed to the browser: the 1-based part
// number plus the signed URL the browser PUTs that slice of the file to.
export interface MultipartPartTarget {
  partNumber: number
  signedUrl: string
}

// A planned multipart upload. The browser slices the file into `totalParts`
// chunks of `partSizeBytes` (the final part is the remainder) and PUTs each to
// its matching `parts[]` URL, in parallel, then reports the per-part ETags back
// so the server can assemble the object.
export interface MultipartUpload {
  provider: string
  bucket: string
  path: string
  // Opaque storage-side id tying the parts together until completion/abort.
  uploadId: string
  partSizeBytes: number
  totalParts: number
  parts: MultipartPartTarget[]
  // When the signed part URLs stop being valid (best-effort, ISO string).
  expiresAt?: string
}

// A finished part the browser reports back: its number and the ETag storage
// returned for it. Both are required to complete the upload.
export interface CompletedPart {
  partNumber: number
  etag: string
}

export interface StorageProvider {
  // Stable identifier persisted on the DB row (storage_provider column).
  readonly name: string

  // Creates a short-lived, write-only signed target for `path`. Scoped to that
  // exact object key so a leaked token can't be used to write elsewhere.
  createSignedUpload(path: string): Promise<SignedUpload>

  // Confirms an object exists and returns its storage-reported size/type. Used
  // to verify the upload actually landed before we mark it "uploaded".
  statObject(path: string): Promise<StorageObjectInfo>

  // Short-lived signed read URL, suitable for handing to ffprobe so it can read
  // duration metadata via range requests without downloading the whole file.
  createSignedReadUrl(path: string, expiresInSeconds?: number): Promise<string>

  // Deletes an object. Idempotent: deleting a missing object is not an error.
  deleteObject(path: string): Promise<void>

  // --- Optional: parallel multipart uploads ---
  // Providers that can split a large upload into independently-PUT parts
  // implement the three methods below. The upload service feature-detects them
  // (`typeof storage.createMultipartUpload === "function"`) and falls back to the
  // single-PUT `createSignedUpload` path when they're absent. This is the lever
  // that lets the browser saturate its uplink on multi-GB files instead of being
  // capped by a single TCP stream's bandwidth-delay product.

  // Begins a multipart upload for `path` and returns every part's signed PUT URL
  // up front, sized for a file of `totalSizeBytes`.
  createMultipartUpload?(
    path: string,
    opts: { totalSizeBytes: number; contentType?: string | null },
  ): Promise<MultipartUpload>

  // Assembles the uploaded parts into the final object. `parts` must list every
  // part with the ETag storage returned for it.
  completeMultipartUpload?(
    path: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void>

  // Cancels an in-progress multipart upload, discarding any uploaded parts.
  // Idempotent: aborting an already-gone upload is not an error.
  abortMultipartUpload?(path: string, uploadId: string): Promise<void>

  // --- Optional: pulling an object from a URL we don't control ---
  // Streams `sourceUrl`'s response body directly into `path`, without buffering
  // the whole object in memory. Used to pull a transcoder's temporary output
  // into our own bucket when the transcoder can't be trusted to write to our
  // storage directly (see the Qencode normalisation callback).
  putObjectFromUrl?(
    path: string,
    sourceUrl: string,
    opts?: { contentType?: string | null },
  ): Promise<void>
}

export { SupabaseStorageProvider } from "@/lib/storage/supabase-storage"
export { S3StorageProvider } from "@/lib/storage/s3-storage"
export { getStorageProvider } from "@/lib/storage/provider"
