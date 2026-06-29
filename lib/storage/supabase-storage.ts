// Supabase Storage implementation of the StorageProvider interface.
//
// All operations go through the service-role admin client, so the bucket itself
// stays fully private (no anon/authenticated RLS policies needed): every read,
// write target and delete is minted server-side only after the route handler has
// confirmed the caller owns the underlying YouTube video. The browser only ever
// receives a single-object, short-lived signed upload token.
//
// NOTE: createSignedUpload uses Supabase's signed-upload-URL flow, a single PUT.
// It comfortably covers the MVP. For genuinely huge (30 GB) resumable uploads
// the swap-in is a TUS-based provider implementing this same interface — nothing
// upstream changes.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import type {
  SignedUpload,
  StorageObjectInfo,
  StorageProvider,
} from "@/lib/storage"

const SIGNED_UPLOAD_TTL_HINT_MS = 2 * 60 * 60 * 1000 // Supabase signed uploads last ~2h.

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase"
  private readonly bucket: string
  private readonly client: SupabaseClient

  constructor(bucket: string, client?: SupabaseClient) {
    this.bucket = bucket
    this.client = client ?? createAdminClient()
  }

  async createSignedUpload(path: string): Promise<SignedUpload> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(path)

    if (error || !data) {
      throw new Error(
        `Failed to create signed upload URL: ${error?.message ?? "unknown error"}`,
      )
    }

    return {
      provider: this.name,
      bucket: this.bucket,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_HINT_MS).toISOString(),
    }
  }

  async statObject(path: string): Promise<StorageObjectInfo> {
    // Supabase has no direct HEAD; list the object's folder and match by name to
    // read the storage-recorded size/type. Splitting on the last "/" gives the
    // prefix to list and the leaf name to search for.
    const slash = path.lastIndexOf("/")
    const prefix = slash === -1 ? "" : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, { search: name, limit: 100 })

    if (error) {
      throw new Error(`Failed to stat storage object: ${error.message}`)
    }

    const match = data?.find((item) => item.name === name)
    if (!match) {
      return { exists: false, sizeBytes: null, contentType: null }
    }

    const metadata = (match.metadata ?? {}) as {
      size?: number
      mimetype?: string
    }

    return {
      exists: true,
      sizeBytes: typeof metadata.size === "number" ? metadata.size : null,
      contentType: metadata.mimetype ?? null,
    }
  }

  async createSignedReadUrl(
    path: string,
    expiresInSeconds = 60 * 60,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds)

    if (error || !data?.signedUrl) {
      throw new Error(
        `Failed to create signed read URL: ${error?.message ?? "unknown error"}`,
      )
    }

    return data.signedUrl
  }

  async deleteObject(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([path])
    // Supabase's remove() is idempotent for missing keys, so we only surface
    // genuine failures.
    if (error) {
      throw new Error(`Failed to delete storage object: ${error.message}`)
    }
  }
}
