import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The /dashboard prefix is gone: every screen that lived under it now sits at
  // the top level (/dashboard/analysed-videos → /analysed-videos) and the
  // dashboard index page itself no longer exists, so /dashboard sends people to
  // Analyse Video instead. These keep old links — a bookmark, an open tab, a
  // link mailed out before the move — landing on the right screen.
  //
  // Order matters: the two specific rules have to be matched before the
  // catch-all, which would otherwise rewrite /dashboard/tip-checklist to a
  // /tip-checklist that has never existed. (That checklist was renamed from
  // "Tip checklist" to just "Checklist" in an earlier move; it gets there in
  // one hop.)
  async redirects() {
    return [
      {
        source: "/dashboard/tip-checklist",
        destination: "/checklist",
        permanent: true,
      },
      {
        source: "/dashboard",
        destination: "/analyse-video",
        permanent: true,
      },
      {
        source: "/dashboard/:path*",
        destination: "/:path*",
        permanent: true,
      },
    ]
  },
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
  //
  // Keyed on "/**/*" (every route), not just "/api/**/*": retention window
  // media extraction (which needs all of these) also runs via after() from
  // the dashboard's analysed-video page route, not only from /api/* routes —
  // scoping this to /api/**/* left that page's serverless function without
  // tesseract's worker-script/WASM core/trained data. (The production
  // "createOcrEngine ... path argument must be of type string" error itself
  // traced back to a separate bug — a bundler-rewritten `require.resolve` in
  // lib/media/ocr.ts, see the comment there — but this route was still a real
  // gap in its own right once that's fixed.)
  //
  // The whole tesseract.js package is traced, not just its worker-script/**
  // subtree: that worker script is spawned via a runtime-computed path
  // (new Worker(...)), so nft never walks its require() graph — and that graph
  // reaches back out of worker-script/ into sibling src/constants/** and
  // src/utils/** (e.g. worker-script/utils/dump.js does
  // `require('../../constants/imageType')`). Shipping only worker-script/**
  // left those siblings out, surfacing as "Cannot find module
  // '../../constants/imageType'" in production. Its worker-script's own
  // third-party deps are invisible to nft for the same reason, so the
  // zero-dependency leaf packages it require()s at runtime are listed too.
  // (node-fetch is intentionally omitted: worker-script/node/index.js guards
  // it as `global.fetch || require('node-fetch')`, and the serverless runtime
  // provides a global fetch, so the require never executes.)
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/@ffmpeg-installer/**",
      "./node_modules/tesseract.js/**",
      "./node_modules/tesseract.js-core/**",
      "./node_modules/@tesseract.js-data/eng/**",
      "./node_modules/bmp-js/**",
      "./node_modules/idb-keyval/**",
      "./node_modules/is-url/**",
      "./node_modules/regenerator-runtime/**",
      "./node_modules/wasm-feature-detect/**",
      "./node_modules/zlibjs/**",
    ],
  },
};

export default nextConfig;
