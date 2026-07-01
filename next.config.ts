import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // YouTube thumbnail hosts, served by next/image on the dashboard.
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
  // The ffmpeg-static binary is a runtime dependency (retention-window
  // thumbnail/audio extraction shells out to it) rather than an import Next's
  // file-tracing would otherwise discover, so it has to be listed explicitly
  // or serverless deploys ship without it.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ffmpeg-static/**"],
  },
};

export default nextConfig;
