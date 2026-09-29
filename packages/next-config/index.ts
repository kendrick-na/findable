import withBundleAnalyzer from "@next/bundle-analyzer";
import { resolve } from "node:path";
import type { NextConfig } from "next";

export const config: NextConfig = {
  // Keep Turbopack rooted at this repository. Without an explicit root, Next
  // walks upward for lockfiles; in a multi-project workspace that can select
  // the shared parent folder and make chunk identifiers include its path.
  // Besides incorrect tracing, that currently triggers a Turbopack UTF-8
  // boundary panic when an ancestor directory contains Korean characters.
  turbopack: {
    root: resolve(import.meta.dirname, "../.."),
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },

  // biome-ignore lint/suspicious/useAwait: rewrites is async
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];
  },

  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export const withAnalyzer = (sourceConfig: NextConfig): NextConfig =>
  withBundleAnalyzer()(sourceConfig);
