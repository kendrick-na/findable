/*
 * This file configures the initialization of Sentry on the server.
 * The config you add here will be used whenever the server handles a request.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK convention
import * as Sentry from "@sentry/nextjs";
import { keys } from "./keys";
import {
  parseTracesSampleRate,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryTransaction,
} from "./privacy";

export const initializeSentry = (): ReturnType<typeof Sentry.init> =>
  Sentry.init({
    dsn: keys().NEXT_PUBLIC_SENTRY_DSN,

    // Enable logging
    enableLogs: true,

    // 운영 비용·개인정보를 고려해 기본 10%. 환경변수로 덮어쓸 수 있다.
    tracesSampleRate: parseTracesSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE
    ),

    // 개인정보 청소 — 오류·성능·이동기록·로그 모두 전송 전에 통과시킨다.
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryTransaction,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSendLog: sanitizeSentryLog,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    // 오류 순간의 함수 안 변수값(고객 입력 포함 가능)을 첨부하지 않는다.
    includeLocalVariables: false,

    // Integrations for console logging
    integrations: [
      // Send console.log, console.error, and console.warn calls as logs to Sentry
      Sentry.consoleLoggingIntegration({ levels: ["log", "error", "warn"] }),
    ],
  });
