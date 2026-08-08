import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Aa packages ne webpack ma bundle NA karo — e badha native binary
   * (`.node` / `.exe`) sathe aave che, ane bundle thay to runtime par
   * "module not found" aave che.
   */
  serverExternalPackages: [
    "mongoose",
    "sharp",
    "ffmpeg-static",
    "ffprobe-static",
  ],

  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },

  /**
   * `output: standalone` thi deploy karo tyare ffmpeg/ffprobe ni binary
   * pan sathe aavvi joiye — nahi to server par reel render nahi thay.
   */
  outputFileTracingIncludes: {
    "/api/studio/**": [
      "./node_modules/ffmpeg-static/**",
      "./node_modules/ffprobe-static/**",
      "./assets/fonts/**",
    ],
    "/api/cron/**": [
      "./node_modules/ffmpeg-static/**",
      "./node_modules/ffprobe-static/**",
      "./assets/fonts/**",
    ],
  },
};

export default nextConfig;
