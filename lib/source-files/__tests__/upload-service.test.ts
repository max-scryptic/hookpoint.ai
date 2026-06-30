import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  UploadError,
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
    createSignedUpload: vi.fn(),
    statObject: vi.fn(async () => ({
      exists,
      sizeBytes: exists ? 1000 : null,
      contentType: exists ? "video/mp4" : null,
    })),
    createSignedReadUrl: vi.fn(async () => "https://signed.example/read"),
    deleteObject: vi.fn(async () => {}),
  } as StorageProvider
}

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
