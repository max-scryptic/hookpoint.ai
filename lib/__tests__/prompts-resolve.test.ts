import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The resolver reads the newest prompt_versions row for a key. The mock stands
// in for that one query, so a test says what the table holds and asserts what
// the pipeline would be sent.
const { rows, failNextRead } = vi.hoisted(() => ({
  rows: new Map<string, { content: string | null }>(),
  failNextRead: { value: false },
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, key: string) => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => {
                if (failNextRead.value) {
                  return { data: null, error: new Error("database is down") }
                }
                return { data: rows.get(key) ?? null, error: null }
              },
            }),
          }),
        }),
      }),
    }),
  }),
}))

const { clearPromptCache, defaultPromptText, resolvePrompt } = await import(
  "@/lib/prompts/resolve"
)
const { promptDefinition } = await import("@/lib/prompts/registry")

const TIP_VOICE = promptDefinition("tip_voice")?.default as string

beforeEach(() => {
  rows.clear()
  failNextRead.value = false
  clearPromptCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolvePrompt", () => {
  it("sends the shipped default when nothing has been saved", async () => {
    // Compared against defaultPromptText rather than the raw default, since
    // the shipped text of a prompt that quotes a fragment includes that
    // fragment's own shipped text.
    expect(await resolvePrompt("event_synthesis")).toBe(
      defaultPromptText("event_synthesis"),
    )
  })

  it("sends a saved override instead of the default", async () => {
    rows.set("event_synthesis", { content: "Only surface what moved." })
    expect(await resolvePrompt("event_synthesis")).toBe(
      "Only surface what moved.",
    )
  })

  it("treats a null content as back to the shipped default, not an empty prompt", async () => {
    // This is how a reset is recorded, and getting it wrong would send an empty
    // developer turn rather than the text the prompt ships with.
    rows.set("event_synthesis", { content: null })
    expect(await resolvePrompt("event_synthesis")).toBe(
      defaultPromptText("event_synthesis"),
    )
  })

  it("substitutes a fragment into the prompt that quotes it", async () => {
    const resolved = await resolvePrompt("pacing")
    expect(resolved).toContain(TIP_VOICE)
    expect(resolved).not.toContain("{{tip_voice}}")
  })

  it("carries an edited fragment into every prompt that quotes it", async () => {
    rows.set("tip_voice", { content: "Write tips for the next video only." })

    for (const key of ["pacing", "retention_attribution", "script_comparison"]) {
      const resolved = await resolvePrompt(key)
      expect(resolved, key).toContain("Write tips for the next video only.")
      expect(resolved, key).not.toContain(TIP_VOICE)
    }
  })

  it("leaves an unknown placeholder exactly as written", async () => {
    // Better a visible typo in the prompt than a rule silently blanked out.
    rows.set("pacing", { content: "Judge pacing. {{not_a_prompt}}" })
    expect(await resolvePrompt("pacing")).toBe("Judge pacing. {{not_a_prompt}}")
  })

  it("stops rather than hangs when a prompt is edited into quoting itself", async () => {
    rows.set("tip_voice", { content: "Tips only. {{tip_voice}}" })
    const resolved = await resolvePrompt("tip_voice")
    expect(resolved).toContain("Tips only.")
    expect(resolved.length).toBeLessThan(10_000)
  })

  it("falls back to the shipped default when the database cannot be read", async () => {
    // An analysis run has already spent money by the time a prompt is resolved,
    // so a database outage must not fail the run.
    vi.spyOn(console, "error").mockImplementation(() => {})
    failNextRead.value = true
    expect(await resolvePrompt("pacing")).toBe(defaultPromptText("pacing"))
  })

  it("throws on a key that is not registered", async () => {
    await expect(resolvePrompt("not_a_prompt")).rejects.toThrow(
      /Unknown prompt key/,
    )
  })
})

describe("the resolver cache", () => {
  it("serves a second call for the same prompt without re-reading", async () => {
    rows.set("pacing", { content: "First." })
    expect(await resolvePrompt("pacing")).toBe("First.")

    // A change the cache has not been told about is not picked up yet, which is
    // the documented trade: an edit takes effect within the cache window.
    rows.set("pacing", { content: "Second." })
    expect(await resolvePrompt("pacing")).toBe("First.")

    clearPromptCache("pacing")
    expect(await resolvePrompt("pacing")).toBe("Second.")
  })

  it("caches the absence of an override too", async () => {
    const shipped = defaultPromptText("pacing")
    expect(await resolvePrompt("pacing")).toBe(shipped)
    rows.set("pacing", { content: "Saved after the first read." })
    expect(await resolvePrompt("pacing")).toBe(shipped)
  })
})

describe("defaultPromptText", () => {
  it("substitutes fragments from their own shipped defaults", () => {
    rows.set("tip_voice", { content: "An override that must not appear here." })
    expect(defaultPromptText("pacing")).toContain(TIP_VOICE)
    expect(defaultPromptText("pacing")).not.toContain("{{tip_voice}}")
  })
})
