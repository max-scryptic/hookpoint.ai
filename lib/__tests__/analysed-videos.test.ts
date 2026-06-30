import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { saveAnalysedVideo } from "@/lib/analysed-videos"

describe("saveAnalysedVideo", () => {
  it("replaces caption bleep markers before persisting the transcript", async () => {
    let persisted: Record<string, unknown> | undefined
    const supabase = {
      from: () => ({
        upsert: (value: Record<string, unknown>) => {
          persisted = value
          return {
            select: () => ({
              single: async () => ({ data: null, error: null }),
            }),
          }
        },
      }),
    } as unknown as SupabaseClient

    await saveAnalysedVideo(supabase, {
      userId: "user-1",
      video: {
        id: "video-1",
        title: "Test video",
        channelId: "channel-1",
        publishedAt: "2026-06-29T00:00:00.000Z",
        durationSeconds: 10,
        thumbnailUrl: null,
      },
      retention: [],
      transcript: [
        {
          startSeconds: 0,
          endSeconds: 2,
          text: "we made [&nbsp;__&nbsp;] money",
        },
      ],
    })

    expect(persisted?.transcript).toEqual([
      {
        startSeconds: 0,
        endSeconds: 2,
        text: "we made ***** money",
      },
    ])
  })
})
