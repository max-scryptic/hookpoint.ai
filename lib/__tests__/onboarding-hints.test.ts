import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import {
  ONBOARDING_HINTS,
  getPendingOnboardingHints,
  isOnboardingHint,
  markOnboardingHintSeen,
} from "@/lib/onboarding-hints"

// A Supabase stand-in for the one query getPendingOnboardingHints makes:
// select("hint").eq("user_id", …).
function selectingHints(result: {
  data?: { hint: string }[]
  error?: { message: string }
}) {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: result.data ?? null, error: result.error ?? null }),
      }),
    }),
  } as unknown as SupabaseClient
}

function insertingHints(error: { code?: string; message: string } | null) {
  return {
    from: () => ({
      insert: async () => ({ error }),
    }),
  } as unknown as SupabaseClient
}

describe("onboarding hint keys", () => {
  it("accepts only known hints", () => {
    expect(isOnboardingHint("retention_insight_playback")).toBe(true)
    expect(isOnboardingHint("deep_analysis_window_tabs")).toBe(true)
    expect(isOnboardingHint("retention_insight_playback ")).toBe(false)
    expect(isOnboardingHint(null)).toBe(false)
  })
})

describe("getPendingOnboardingHints", () => {
  it("treats an account with no rows as having met nothing", async () => {
    await expect(
      getPendingOnboardingHints(selectingHints({ data: [] }), "user-1"),
    ).resolves.toEqual([...ONBOARDING_HINTS])
  })

  it("drops the hints already recorded", async () => {
    await expect(
      getPendingOnboardingHints(
        selectingHints({ data: [{ hint: "retention_insight_playback" }] }),
        "user-1",
      ),
    ).resolves.toEqual(["deep_analysis_window_tabs"])
  })

  // A row for a hint that has since been retired from the interface is left in
  // place rather than migrated away, so it must not read as a pending one.
  it("ignores rows for keys the interface no longer knows", async () => {
    await expect(
      getPendingOnboardingHints(
        selectingHints({ data: [{ hint: "some_retired_hint" }] }),
        "user-1",
      ),
    ).resolves.toEqual([...ONBOARDING_HINTS])
  })

  it("surfaces a failed read rather than silently showing every hint", async () => {
    await expect(
      getPendingOnboardingHints(
        selectingHints({ error: { message: "boom" } }),
        "user-1",
      ),
    ).rejects.toThrow(/boom/)
  })
})

describe("markOnboardingHintSeen", () => {
  // Two reports open at once both report the hint the first time either is
  // used. The second arrival has nothing left to do, not something to raise.
  it("treats an already-recorded hint as recorded", async () => {
    await expect(
      markOnboardingHintSeen(
        insertingHints({ code: "23505", message: "duplicate key" }),
        "user-1",
        "retention_insight_playback",
      ),
    ).resolves.toBeUndefined()
  })

  it("raises anything else", async () => {
    await expect(
      markOnboardingHintSeen(
        insertingHints({ code: "42501", message: "permission denied" }),
        "user-1",
        "retention_insight_playback",
      ),
    ).rejects.toThrow(/permission denied/)
  })
})
