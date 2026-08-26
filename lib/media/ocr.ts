// Deterministic (no LLM) on-screen text recognition for a harvested
// retention-window snapshot, via tesseract.js running entirely offline: both
// the WASM engine (tesseract.js-core, resolved through Node's own require -
// never a browser CDN fetch) and the trained language data
// (@tesseract.js-data/eng, an npm dependency bundled in node_modules) are
// local files, so this never makes a network call at runtime - unlike
// tesseract.js's out-of-the-box default of fetching both from jsdelivr on
// first use, which would add a live external dependency to every extraction
// run for no reason.

import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

import { createWorker, type Worker } from "tesseract.js"

// Used only for `.resolve()` below, and never trusted blindly. Turbopack
// (and webpack before it) statically rewrites `require.resolve(...)` calls in
// bundled application code to return the bundler's own numeric module id
// instead of forwarding to Node's real module resolution - and, as observed
// in production, Turbopack applies the same rewrite through
// `createRequire(import.meta.url)`, so even this resolver can hand back a
// number. That numeric id then flowed into path.dirname/path.join and
// ultimately into node:worker_threads' Worker(), surfacing as "The 'path'
// argument must be of type string. Received type number". The only rewrite-
// proof answer is to treat resolution as a hint and verify the directory
// actually exists on disk - see resolveEnglishLangPath.
const nodeRequire = createRequire(import.meta.url)

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
// images across an extraction run - recreating it per snapshot would pay
// that load cost on every frame instead of once per run.
export interface OcrEngine {
  recognize(image: Buffer): Promise<OcrResult>
  terminate(): Promise<void>
}

// @tesseract.js-data/eng's own index.js points at its non-LSTM '4.0.0'
// variant, but tesseract.js defaults to LSTM_ONLY mode (the modern, more
// accurate engine), which needs the '4.0.0_best_int' variant instead - so
// this resolves that directory directly rather than trusting the package's
// own export.
// Candidates are checked against the filesystem rather than trusted, because
// a bundler-rewritten resolve can return a numeric module id or a virtual
// path (see the nodeRequire comment above). The cwd-anchored fallback is what
// actually holds in a serverless deploy: outputFileTracingIncludes (see
// next.config.ts) ships ./node_modules/@tesseract.js-data/eng/** relative to
// the project root, which is the function's working directory at runtime.
function resolveEnglishLangPath(): string {
  const candidates: string[] = []

  try {
    const packageEntry: unknown = nodeRequire.resolve("@tesseract.js-data/eng")
    if (typeof packageEntry === "string") {
      candidates.push(path.join(path.dirname(packageEntry), "4.0.0_best_int"))
    }
  } catch {
    // Resolution failing entirely is fine - the fallback below still applies.
  }

  candidates.push(
    path.join(
      process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0_best_int",
    ),
  )

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (!found) {
    throw new Error(
      `English OCR language data not found; looked in: ${candidates.join(", ")}`,
    )
  }
  return found
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
