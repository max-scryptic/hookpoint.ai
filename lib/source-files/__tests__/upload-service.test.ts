import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  UploadError,
  abortSourceFileUpload,
  completeSourceFileUpload,
  discardSourceFile,
  initiateSourceFileUpload,
  isStaleSourceFile,
} from "@/lib/source-files/upload-service"
import { mapSourceFileRow } from "@/lib/source-files/source-files"
import type { StorageProvider } from "@/lib/storage"

// ---------------------------------------------------------------------------
// A tiny chainable fake of the Supabase query builder. Each test supplies a
// `handler(ctx)` that returns the canned `{ data, error }` for a given call,
// keyed on the table, operation and terminal method. Enough to exercise the
// service branches without a real database.
// ---------------------------------------------------------------------------

interface CallCtx {
  table: string
  op: "select" | "insert" | "update" | "delete" | "upsert"
  terminal: "single" | "maybeSingle" | "await"
  // The payload passed to insert/update/upsert, when relevant.
  payload?: unknown
}

type Handler = (ctx: CallCtx) => { data: unknown; error: unknown }

function makeFakeSupabase(handler: Handler): SupabaseClient {
  return {
    from(table: string) {
      const state: { table: string; op: CallCtx["op"]; payload?: unknown } = {
        table,
        op: "select",
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => ((state.op = "insert"), (state.payload = payload), builder),
        update: (payload: unknown) => ((state.op = "update"), (state.payload = payload), builder),
        delete: () => ((state.op = "delete"), builder),
        upsert: () => ((state.op = "upsert"), builder),
        eq: () => builder,
        order: () => builder,
        single: () =>
          Promise.resolve(handler({ ...state, terminal: "single" })),
        maybeSingle: () =>
          Promise.resolve(handler({ ...state, terminal: "maybeSingle" })),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(handler({ ...state, terminal: "await" })).then(
            resolve,
            reject,
          ),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

function fakeStorage(exists: boolean): StorageProvider {
  return {
    name: "fake",
    createSignedUpload: vi.fn(async () => ({
      provider: "fake",
      bucket: "b",
      path: "p",
      signedUrl: "https://signed.example/put",
    })),
    statObject: vi.fn(async () => ({
      exists,
      sizeBytes: exists ? 1000 : null,
      contentType: exists ? "video/mp4" : null,
    })),
    createSignedReadUrl: vi.fn(async () => "https://signed.example/read"),
    deleteObject: vi.fn(async () => {}),
  } as StorageProvider
}

// A multipart-capable fake (mimics the S3 provider). Returns its own spies so a
// test can assert which upload mechanic the service chose.
function fakeMultipartStorage(exists = true): StorageProvider {
  return {
    name: "fake-s3",
    createSignedUpload: vi.fn(async () => ({
      provider: "fake-s3",
      bucket: "b",
      path: "p",
      signedUrl: "https://signed.example/put",
    })),
    createMultipartUpload: vi.fn(async (path: string) => ({
      provider: "fake-s3",
      bucket: "b",
      path,
      uploadId: "up-1",
      partSizeBytes: 64 * 1024 * 1024,
      totalParts: 4,
      parts: [],
    })),
    completeMultipartUpload: vi.fn(async () => {}),
    abortMultipartUpload: vi.fn(async () => {}),
    statObject: vi.fn(async () => ({
      exists,
      sizeBytes: exists ? 1000 : null,
      contentType: exists ? "video/mp4" : null,
    })),
    createSignedReadUrl: vi.fn(async () => "https://signed.example/read"),
    deleteObject: vi.fn(async () => {}),
  } as unknown as StorageProvider
}

// A Supabase fake wired for a successful initiate: the analysed video exists and
// belongs to the user, there's no prior source file, and insert/update return
// the fresh row.
function makeInitiateSupabase(): SupabaseClient {
  return makeFakeSupabase(({ table, op }) => {
    if (table === "analysed_videos") {
      return {
        data: {
          id: "av-1",
          user_id: "user-1",
          video_id: "vid-1",
          video_title: "Title",
          date_analysed: "2026-06-29T00:00:00Z",
          video_details: { durationSeconds: 600 },
          retention: null,
          drop_offs: null,
          transcript: null,
          raw_analytics: null,
        },
        error: null,
      }
    }
    if (table === "source_files" && op === "select") {
      return { data: null, error: null } // no existing source file
    }
    if (table === "source_files" && op === "insert") {
      return { data: sourceFileRow({ upload_status: "pending" }), error: null }
    }
    if (table === "source_files" && op === "update") {
      return { data: sourceFileRow({ upload_status: "uploading" }), error: null }
    }
    return { data: null, error: null }
  })
}

const MiB = 1024 * 1024

// A complete snake_case source_files row, as the DB would return it.
function sourceFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sf-1",
    user_id: "user-1",
    analysed_video_id: "av-1",
    youtube_video_id: "vid-1",
    original_filename: "clip.mp4",
    storage_provider: "fake",
    storage_path: "user-1/vid-1/sf-1/clip.mp4",
    file_size_bytes: null,
    mime_type: "video/mp4",
    uploaded_duration_seconds: null,
    youtube_duration_seconds: 600,
    duration_difference_seconds: null,
    duration_validation_status: null,
    filename_validation_status: null,
    filename_similarity_score: null,
    validation_status: "pending",
    upload_status: "uploading",
    failure_reason: null,
    delete_after: null,
    created_at: "2026-06-29T00:00:00Z",
    updated_at: "2026-06-29T00:00:00Z",
    ...overrides,
  }
}

describe("initiateSourceFileUpload", () => {
  it("rejects an upload to a video the user doesn't own", async () => {
    // getAnalysedVideo (RLS-scoped) finds no matching analysed video.
    const supabase = makeFakeSupabase(({ table }) =>
      table === "analysed_videos"
        ? { data: null, error: null }
        : { data: null, error: null },
    )

    await expect(
      initiateSourceFileUpload(supabase, fakeStorage(true), {
        userId: "user-1",
        youtubeVideoId: "someone-elses-video",
        originalFilename: "clip.mp4",
        mimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ code: "video_not_found" })
  })

  it("rejects an unsupported file type before any DB work", async () => {
    const supabase = makeFakeSupabase(() => ({ data: null, error: null }))
    await expect(
      initiateSourceFileUpload(supabase, fakeStorage(true), {
        userId: "user-1",
        youtubeVideoId: "vid-1",
        originalFilename: "notes.txt",
      }),
    ).rejects.toMatchObject({ code: "unsupported_type" })
  })

  it("uses a parallel multipart upload for a large file on a capable provider", async () => {
    const storage = fakeMultipartStorage()
    const result = await initiateSourceFileUpload(
      makeInitiateSupabase(),
      storage,
      {
        userId: "user-1",
        youtubeVideoId: "vid-1",
        originalFilename: "clip.mp4",
        mimeType: "video/mp4",
        declaredSizeBytes: 200 * MiB,
      },
    )

    expect(result.multipartUpload).toBeDefined()
    expect(result.upload).toBeUndefined()
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1)
    expect(storage.createSignedUpload).not.toHaveBeenCalled()
  })

  it("uses a single PUT for a small file even on a multipart-capable provider", async () => {
    const storage = fakeMultipartStorage()
    const result = await initiateSourceFileUpload(
      makeInitiateSupabase(),
      storage,
      {
        userId: "user-1",
        youtubeVideoId: "vid-1",
        originalFilename: "clip.mp4",
        mimeType: "video/mp4",
        declaredSizeBytes: 1 * MiB,
      },
    )

    expect(result.upload).toBeDefined()
    expect(result.multipartUpload).toBeUndefined()
    expect(storage.createSignedUpload).toHaveBeenCalledTimes(1)
    expect(storage.createMultipartUpload).not.toHaveBeenCalled()
  })
})

describe("completeSourceFileUpload", () => {
  it("fails with object_missing when the uploaded object isn't in storage", async () => {
    const supabase = makeFakeSupabase(({ table, op }) => {
      if (table === "source_files" && op === "select") {
        return { data: sourceFileRow(), error: null }
      }
      // The defensive "mark failed" update.
      if (table === "source_files" && op === "update") {
        return { data: sourceFileRow({ upload_status: "failed" }), error: null }
      }
      return { data: null, error: null }
    })

    await expect(
      completeSourceFileUpload(supabase, fakeStorage(false), {
        userId: "user-1",
        sourceFileId: "sf-1",
      }),
    ).rejects.toBeInstanceOf(UploadError)

    await expect(
      completeSourceFileUpload(supabase, fakeStorage(false), {
        userId: "user-1",
        sourceFileId: "sf-1",
      }),
    ).rejects.toMatchObject({ code: "object_missing" })
  })

  it("fails with not_found when the source file row doesn't exist", async () => {
    const supabase = makeFakeSupabase(() => ({ data: null, error: null }))
    await expect(
      completeSourceFileUpload(supabase, fakeStorage(true), {
        userId: "user-1",
        sourceFileId: "missing",
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })

  it("assembles multipart parts before verifying, and fails cleanly when assembly fails", async () => {
    const storage = fakeMultipartStorage()
    storage.completeMultipartUpload = vi.fn(async () => {
      throw new Error("assemble boom")
    })
    const supabase = makeFakeSupabase(({ table, op }) => {
      if (table === "source_files" && op === "select") {
        return { data: sourceFileRow(), error: null }
      }
      if (table === "source_files" && op === "update") {
        return { data: sourceFileRow({ upload_status: "failed" }), error: null }
      }
      return { data: null, error: null }
    })

    await expect(
      completeSourceFileUpload(supabase, storage, {
        userId: "user-1",
        sourceFileId: "sf-1",
        multipart: { uploadId: "up-1", parts: [{ partNumber: 1, etag: "e1" }] },
      }),
    ).rejects.toMatchObject({ code: "object_missing" })

    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/clip.mp4",
      "up-1",
      [{ partNumber: 1, etag: "e1" }],
    )
  })

  it("validates against the browser-measured duration and writes a terminal state", async () => {
    let updatePayload: Record<string, unknown> | undefined
    const supabase = makeFakeSupabase(({ table, op, payload }) => {
      if (table === "source_files" && op === "select") {
        return {
          data: sourceFileRow({
            original_filename: "my-great-video.mp4",
            youtube_duration_seconds: 600,
          }),
          error: null,
        }
      }
      if (table === "analysed_videos" && op === "select") {
        return {
          data: {
            id: "av-1",
            user_id: "user-1",
            video_id: "vid-1",
            video_title: "My Great Video",
            video_details: { durationSeconds: 600 },
          },
          error: null,
        }
      }
      if (table === "source_files" && op === "update") {
        updatePayload = payload as Record<string, unknown>
        return {
          data: sourceFileRow({
            upload_status: "ready",
            validation_status: "passed",
            duration_validation_status: "passed",
            uploaded_duration_seconds: 600,
          }),
          error: null,
        }
      }
      return { data: null, error: null }
    })

    const result = await completeSourceFileUpload(supabase, fakeStorage(true), {
      userId: "user-1",
      sourceFileId: "sf-1",
      clientDurationSeconds: 600,
    })

    expect(result.uploadStatus).toBe("ready")
    // The validation outcome must be persisted in the single completing write.
    expect(updatePayload).toMatchObject({
      upload_status: "ready",
      validation_status: "passed",
      duration_validation_status: "passed",
      uploaded_duration_seconds: 600,
      file_size_bytes: 1000,
    })
  })

  it("degrades to a warning when the browser couldn't measure the duration", async () => {
    let updatePayload: Record<string, unknown> | undefined
    const supabase = makeFakeSupabase(({ table, op, payload }) => {
      if (table === "source_files" && op === "select") {
        return { data: sourceFileRow({ youtube_duration_seconds: 600 }), error: null }
      }
      if (table === "analysed_videos" && op === "select") {
        return {
          data: { video_title: "Clip", video_details: { durationSeconds: 600 } },
          error: null,
        }
      }
      if (table === "source_files" && op === "update") {
        updatePayload = payload as Record<string, unknown>
        return {
          data: sourceFileRow({ upload_status: "ready", validation_status: "warning" }),
          error: null,
        }
      }
      return { data: null, error: null }
    })

    const result = await completeSourceFileUpload(supabase, fakeStorage(true), {
      userId: "user-1",
      sourceFileId: "sf-1",
      clientDurationSeconds: null,
    })

    expect(result.uploadStatus).toBe("ready")
    expect(updatePayload).toMatchObject({
      upload_status: "ready",
      validation_status: "warning",
      duration_validation_status: null,
      uploaded_duration_seconds: null,
    })
  })
})

describe("abortSourceFileUpload", () => {
  it("aborts the multipart upload and clears the row", async () => {
    const storage = fakeMultipartStorage()
    const deleted: string[] = []
    const supabase = makeFakeSupabase(({ table, op }) => {
      if (table === "source_files" && op === "select") {
        return { data: sourceFileRow({ upload_status: "uploading" }), error: null }
      }
      if (table === "source_files" && op === "delete") {
        deleted.push("row")
        return {
          data: { storage_path: "user-1/vid-1/sf-1/clip.mp4" },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    await abortSourceFileUpload(supabase, storage, {
      userId: "user-1",
      sourceFileId: "sf-1",
      uploadId: "up-1",
    })

    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/clip.mp4",
      "up-1",
    )
    expect(deleted).toEqual(["row"])
  })

  it("no-ops when the row is already gone", async () => {
    const storage = fakeMultipartStorage()
    const supabase = makeFakeSupabase(() => ({ data: null, error: null }))

    await expect(
      abortSourceFileUpload(supabase, storage, {
        userId: "user-1",
        sourceFileId: "missing",
        uploadId: "up-1",
      }),
    ).resolves.toBeUndefined()
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled()
  })
})

// Maps the loosely-typed test row to a domain SourceFile for functions that take
// the camelCase shape directly.
function asSourceFile(overrides: Record<string, unknown> = {}) {
  return mapSourceFileRow(
    sourceFileRow(overrides) as Parameters<typeof mapSourceFileRow>[0],
  )
}

describe("isStaleSourceFile", () => {
  it("treats non-terminal in-flight states as stale", () => {
    // "uploading" = abandoned transfer; "uploaded"/"processing" = rows stranded
    // by the old inline-ffprobe flow that those states are no longer written by.
    for (const status of ["uploading", "uploaded", "processing"]) {
      expect(isStaleSourceFile(asSourceFile({ upload_status: status }))).toBe(
        true,
      )
    }
  })

  it("does not treat pending or terminal states as stale", () => {
    for (const status of ["pending", "ready", "failed"]) {
      expect(isStaleSourceFile(asSourceFile({ upload_status: status }))).toBe(
        false,
      )
    }
  })
})

describe("discardSourceFile", () => {
  it("removes the storage object and deletes the row", async () => {
    const deleted: string[] = []
    const supabase = makeFakeSupabase(({ table, op }) => {
      if (table === "source_files" && op === "delete") {
        deleted.push("row")
        return { data: { storage_path: "user-1/vid-1/sf-1/clip.mp4" }, error: null }
      }
      return { data: null, error: null }
    })
    const storage = fakeStorage(true)
    const sourceFile = asSourceFile({ upload_status: "uploading" })

    await discardSourceFile(supabase, storage, "user-1", sourceFile)

    expect(storage.deleteObject).toHaveBeenCalledWith(
      "user-1/vid-1/sf-1/clip.mp4",
    )
    expect(deleted).toEqual(["row"])
  })

  it("still deletes the row when the object delete fails", async () => {
    const deleted: string[] = []
    const supabase = makeFakeSupabase(({ table, op }) => {
      if (table === "source_files" && op === "delete") {
        deleted.push("row")
        return { data: { storage_path: null }, error: null }
      }
      return { data: null, error: null }
    })
    const storage = fakeStorage(true)
    storage.deleteObject = vi.fn(async () => {
      throw new Error("storage boom")
    })
    const sourceFile = asSourceFile({ upload_status: "uploading" })

    await expect(
      discardSourceFile(supabase, storage, "user-1", sourceFile),
    ).resolves.toBeUndefined()
    expect(deleted).toEqual(["row"])
  })
})
