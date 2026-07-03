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
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  // The @ffmpeg-installer/ffmpeg binary is a runtime dependency (retention-
  // window thumbnail/audio extraction shells out to it) rather than an import
  // Next's file-tracing would otherwise discover, so it has to be listed
  // explicitly or serverless deploys ship without it.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/@ffmpeg-installer/**"],
  },
};

export default nextConfig;
