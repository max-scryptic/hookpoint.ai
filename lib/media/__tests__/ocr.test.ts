import { describe, expect, it, vi } from "vitest"

const { recognizeMock, terminateMock, createWorkerMock } = vi.hoisted(() => ({
  recognizeMock: vi.fn(),
  terminateMock: vi.fn(async () => {}),
  createWorkerMock: vi.fn(),
}))

vi.mock("tesseract.js", () => ({
  createWorker: createWorkerMock,
}))

createWorkerMock.mockImplementation(async () => ({
  recognize: recognizeMock,
  terminate: terminateMock,
}))

describe("createOcrEngine", () => {
  it("keeps recognized text when confidence is high enough", async () => {
    const { createOcrEngine } = await import("@/lib/media/ocr")
    recognizeMock.mockResolvedValueOnce({
      data: { text: "SALE 50% OFF\n", confidence: 87 },
    })

    const engine = await createOcrEngine()
    const result = await engine.recognize(Buffer.from("jpeg-bytes"))

    expect(result).toEqual({ text: "SALE 50% OFF", confidence: 87 })
  })

  it("discards text below the confidence threshold as likely noise", async () => {
    const { createOcrEngine } = await import("@/lib/media/ocr")
    recognizeMock.mockResolvedValueOnce({
      data: { text: "garbled nonsense", confidence: 40 },
    })

    const engine = await createOcrEngine()
    const result = await engine.recognize(Buffer.from("jpeg-bytes"))

    expect(result).toEqual({ text: null, confidence: 40 })
  })

  it("treats empty/whitespace-only recognized text as no text found", async () => {
    const { createOcrEngine } = await import("@/lib/media/ocr")
    recognizeMock.mockResolvedValueOnce({
      data: { text: "   \n\n  ", confidence: 95 },
    })

    const engine = await createOcrEngine()
    const result = await engine.recognize(Buffer.from("jpeg-bytes"))

    expect(result.text).toBeNull()
  })

  it("delegates terminate to the underlying worker", async () => {
    const { createOcrEngine } = await import("@/lib/media/ocr")
    const engine = await createOcrEngine()

    await engine.terminate()

    expect(terminateMock).toHaveBeenCalledTimes(1)
  })

  it("configures the worker with a local (non-CDN) language path and a writable cache directory", async () => {
    const { createOcrEngine } = await import("@/lib/media/ocr")
    await createOcrEngine()

    const [langs, , options] = createWorkerMock.mock.calls.at(-1) as [
      string,
      unknown,
      { langPath: string; gzip: boolean; cachePath: string },
    ]
    expect(langs).toBe("eng")
    expect(options.langPath).not.toMatch(/^https?:\/\//)
    expect(options.langPath).toContain("@tesseract.js-data")
    expect(options.gzip).toBe(true)
    expect(options.cachePath.length).toBeGreaterThan(0)
  })
})
