import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // YouTube thumbnail hosts, served by next/image on the dashboard.
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
  // @ffmpeg-installer/ffmpeg's own index.js picks the platform binary with a
  // runtime require(variableName), which Turbopack can't statically resolve
  // and fails the build on if left to bundle normally. Keep it a plain
  // runtime require instead of bundling it.
  //
  // tesseract.js has the same problem one layer deeper: createWorker spawns
  // its worker-script via `new Worker(path.join(__dirname, ...))`, a
  // runtime-computed path Turbopack can't statically resolve either — left
  // bundled, the worker thread gets handed a mangled (non-string) path
  // instead of the real file, so createOcrEngine throws
  // "The 'path' argument must be of type string. Received type number" in
  // production despite working locally (see naptha/tesseract.js#868).
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "tesseract.js",
    "tesseract.js-core",
    "@tesseract.js-data/eng",
  ],
  // Runtime dependencies (a shelled-out binary, a worker-thread script, a
  // WASM core, trained-language data) that Next's import-following
  // file-tracing has no way to discover, so serverless deploys ship without
  // them unless listed explicitly here.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/@ffmpeg-installer/**",
      "./node_modules/tesseract.js/src/worker-script/**",
      "./node_modules/tesseract.js-core/**",
      "./node_modules/@tesseract.js-data/eng/**",
    ],
  },
};

export default nextConfig;
