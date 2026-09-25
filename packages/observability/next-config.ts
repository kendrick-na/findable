import { withLogtail } from "@logtail/next";
import { withSentryConfig } from "@sentry/nextjs";
import { keys } from "./keys";

export const sentryConfig: Parameters<typeof withSentryConfig>[1] = {
  org: keys().SENTRY_ORG,
  project: keys().SENTRY_PROJECT,

  // Vercel CI에서는 업로드 대상 수백 개를 stdout에 출력하다 sentry-cli가
  // EAGAIN으로 중단되는 것을 운영 빌드에서 확인했다. 오류는 유지하고 상세 목록만 숨긴다.
  silent: true,

  /*
   * For all available options, see:
   * https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
   */

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  /*
   * Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
   * This can increase your server load as well as your hosting bill.
   * Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
   * side errors will fail.
   */
  tunnelRoute: "/monitoring",

  webpack: {
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    treeshake: {
      removeDebugLogging: true,
    },

    /*
     * Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
     * See the following for more information:
     * https://docs.sentry.io/product/crons/
     * https://vercel.com/docs/cron-jobs
     */
    automaticVercelMonitors: true,
  },
};

export const withSentry = (sourceConfig: object): object => {
  const source = sourceConfig as { transpilePackages?: string[] };
  const configWithTranspile = {
    ...sourceConfig,
    transpilePackages: [
      ...(source.transpilePackages ?? []),
      "@sentry/nextjs",
    ],
  };

  return withSentryConfig(configWithTranspile, sentryConfig);
};

export const withLogging = (config: object): object => withLogtail(config);
