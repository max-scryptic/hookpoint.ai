import { describe, expect, it, vi } from "vitest"

import {
  QencodeClient,
  QencodeError,
  type QencodeQuery,
} from "@/lib/qencode/qencode"

// Builds a fake fetch that routes by endpoint to canned JSON, recording each
// call so tests can assert the handshake order and the body sent.
function fakeFetch(
  responders: Record<string, { ok?: boolean; status?: number; json: unknown }>,
) {
  const calls: { url: string; body: Record<string, string> }[] = []
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const key = Object.keys(responders).find((k) => u.endsWith(k))
    const body = Object.fromEntries(
      new URLSearchParams((init?.body as string) ?? ""),
    )
    calls.push({ url: u, body })
    const r = key ? responders[key] : undefined
    return {
      ok: r?.ok ?? true,
      status: r?.status ?? 200,
      json: async () => r?.json ?? { error: 0 },
    } as Response
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

function client(fetchImpl: typeof fetch) {
  return new QencodeClient({
    apiKey: "api-key",
    baseUrl: "https://api.test/v1",
    fetchImpl,
  })
}

const QUERY: QencodeQuery = {
  source: "https://signed.example/read",
  format: [{ output: "mp4", video_codec: "libx264", height: 1080 }],
  callback_url: "https://app.test/cb",
}

describe("QencodeClient.submitJob", () => {
  it("runs login -> create_task -> start_encode2 and returns the task token", async () => {
    const { impl, calls } = fakeFetch({
      access_token: { json: { error: 0, token: "access-1" } },
      create_task: { json: { error: 0, task_token: "task-1" } },
      start_encode2: { json: { error: 0 } },
    })

    const token = await client(impl).submitJob(QUERY)

    expect(token).toBe("task-1")
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/v1/access_token",
      "https://api.test/v1/create_task",
      "https://api.test/v1/start_encode2",
    ])
    // The access token flows from login into create_task.
    expect(calls[0].body.api_key).toBe("api-key")
    expect(calls[1].body.token).toBe("access-1")
    // start_encode2 carries the task token + the serialised query, which nests
    // our parameters under a top-level `query` key as the API requires.
    expect(calls[2].body.task_token).toBe("task-1")
    expect(JSON.parse(calls[2].body.query)).toMatchObject({
      query: {
        source: QUERY.source,
        callback_url: QUERY.callback_url,
      },
    })
  })

  it("throws a QencodeError when a step reports a non-zero error", async () => {
    const { impl } = fakeFetch({
      access_token: { json: { error: 4, message: "bad key" } },
    })
    await expect(client(impl).submitJob(QUERY)).rejects.toMatchObject({
      name: "QencodeError",
      message: "bad key",
    })
  })

  it("throws on a non-2xx HTTP response", async () => {
    const { impl } = fakeFetch({
      access_token: { ok: false, status: 502, json: {} },
    })
    await expect(client(impl).login()).rejects.toBeInstanceOf(QencodeError)
  })

  it("throws when login succeeds but returns no token", async () => {
    const { impl } = fakeFetch({
      access_token: { json: { error: 0 } },
    })
    await expect(client(impl).login()).rejects.toMatchObject({
      message: expect.stringContaining("access token"),
    })
  })
})
