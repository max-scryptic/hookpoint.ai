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
}

export { SupabaseStorageProvider } from "@/lib/storage/supabase-storage"
export { getStorageProvider } from "@/lib/storage/provider"
