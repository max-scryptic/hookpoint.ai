// Deterministic (no LLM) on-screen text recognition for a harvested
// retention-window snapshot, via tesseract.js running entirely offline: both
// the WASM engine (tesseract.js-core, resolved through Node's own require —
// never a browser CDN fetch) and the trained language data
// (@tesseract.js-data/eng, an npm dependency bundled in node_modules) are
// local files, so this never makes a network call at runtime — unlike
// tesseract.js's out-of-the-box default of fetching both from jsdelivr on
// first use, which would add a live external dependency to every extraction
// run for no reason.

import os from "node:os"
import path from "node:path"

import { createWorker, type Worker } from "tesseract.js"

// Below this recognition confidence (tesseract's own 0-100 scale) a result is
// usually noise from a text-free frame (a face, a hand, background clutter)
// rather than real on-screen text, so it's discarded rather than stored as a
// false positive.
const MIN_OCR_CONFIDENCE = 60

export interface OcrResult {
  text: string | null
  confidence: number
}

// One worker (which loads the WASM core + trained data once) recognizes many
// images across an extraction run — recreating it per snapshot would pay
// that load cost on every frame instead of once per run.
export interface OcrEngine {
  recognize(image: Buffer): Promise<OcrResult>
  terminate(): Promise<void>
}

// @tesseract.js-data/eng's own index.js points at its non-LSTM '4.0.0'
// variant, but tesseract.js defaults to LSTM_ONLY mode (the modern, more
// accurate engine), which needs the '4.0.0_best_int' variant instead — so
// this resolves that directory directly rather than trusting the package's
// own export.
function resolveEnglishLangPath(): string {
  const packageEntry = require.resolve("@tesseract.js-data/eng")
  return path.join(path.dirname(packageEntry), "4.0.0_best_int")
}

export async function createOcrEngine(): Promise<OcrEngine> {
  const worker: Worker = await createWorker("eng", undefined, {
    langPath: resolveEnglishLangPath(),
    gzip: true,
    // The Node worker writes a decompressed copy of the trained data to
    // `${cachePath}/eng.traineddata`; the default ('.', the process's cwd)
    // isn't guaranteed writable in a serverless runtime, but os.tmpdir() is.
    cachePath: os.tmpdir(),
  })

  return {
    async recognize(image) {
      const {
        data: { text, confidence },
      } = await worker.recognize(image)
      const trimmed = text.trim()
      return {
        text: trimmed.length > 0 && confidence >= MIN_OCR_CONFIDENCE ? trimmed : null,
        confidence,
      }
    },
    async terminate() {
      await worker.terminate()
    },
  }
}
