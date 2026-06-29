import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  UploadError,
  completeSourceFileUpload,
  initiateSourceFileUpload,
} from "@/lib/source-files/upload-service"
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
}

type Handler = (ctx: CallCtx) => { data: unknown; error: unknown }

function makeFakeSupabase(handler: Handler): SupabaseClient {
  return {
    from(table: string) {
      const state: { table: string; op: CallCtx["op"] } = {
        table,
        op: "select",
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => ((state.op = "insert"), builder),
        update: () => ((state.op = "update"), builder),
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
})
