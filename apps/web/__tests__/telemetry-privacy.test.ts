import type { ErrorEvent } from "@sentry/nextjs";
import { afterEach, describe, expect, test, vi } from "vitest";

const sentryInit = vi.hoisted(() => vi.fn());
const posthogInit = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  init: sentryInit,
  replayIntegration: () => ({ name: "replay" }),
  consoleLoggingIntegration: () => ({ name: "console" }),
  captureRouterTransitionStart: () => undefined,
}));
// posthog-js 는 packages/analytics 쪽에서 해석되므로 그 경로 기준으로 바꿔치기한다.
vi.mock("../../../packages/analytics/node_modules/posthog-js", () => ({
  default: { init: posthogInit },
}));
vi.mock("@repo/analytics/keys", () => ({
  keys: () => ({
    NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
    NEXT_PUBLIC_POSTHOG_HOST: "/ingest",
  }),
}));
vi.mock("@repo/observability/keys", () => ({
  keys: () => ({ NEXT_PUBLIC_SENTRY_DSN: undefined }),
}));

import { sanitizePostHogEvent } from "@repo/analytics/privacy";
import {
  ensureGtag,
  sendSafePageView,
} from "@repo/analytics/safe-google-analytics";
import { initializeSentry as initClient } from "@repo/observability/client";
import { initializeSentry as initEdge } from "@repo/observability/edge";
import {
  parseTracesSampleRate,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryTransaction,
} from "@repo/observability/privacy";
import { initializeSentry as initServer } from "@repo/observability/server";
import {
  isReportTokenPath,
  isSensitivePath,
  redactUrl,
} from "@repo/observability/url-privacy";

const TOKEN = "AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf01234";
const JOB = "3f1c2a9e-1111-4222-8333-444455556666";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("redactUrl", () => {
  test("고객 리포트 토큰 경로 치환", () => {
    expect(redactUrl(`https://findable.co.kr/r/${TOKEN}`)).toBe(
      "https://findable.co.kr/r/[token]"
    );
    expect(redactUrl(`/r/${TOKEN}/pdf`)).toBe("/r/[token]/pdf");
  });

  test("진단 jobId 경로 치환(언어 접두사 포함)", () => {
    expect(redactUrl(`https://findable.co.kr/ko/audit/${JOB}`)).toBe(
      "https://findable.co.kr/ko/audit/[jobId]"
    );
    expect(redactUrl(`/api/audit/${JOB}/crew`)).toBe("/api/audit/[jobId]/crew");
  });

  test("쿼리·해시 전체 제거(뉴스레터 토큰)", () => {
    expect(redactUrl("/api/newsletter/confirm?token=abc123")).toBe(
      "/api/newsletter/confirm"
    );
    expect(redactUrl(`/ko/audit/${JOB}?utm=1#x`)).toBe("/ko/audit/[jobId]");
  });

  test("비밀이 없는 주소는 그대로", () => {
    expect(redactUrl("https://findable.co.kr/ko/pricing")).toBe(
      "https://findable.co.kr/ko/pricing"
    );
    expect(redactUrl("/ko/audit")).toBe("/ko/audit");
  });

  test("경로 판정", () => {
    expect(isReportTokenPath(`/r/${TOKEN}`)).toBe(true);
    expect(isReportTokenPath("/ko/pricing")).toBe(false);
    expect(isSensitivePath(`/ko/audit/${JOB}`)).toBe(true);
    expect(isSensitivePath("/ko/audit")).toBe(false);
  });
});

describe("Sentry 청소 연결", () => {
  const inits = { client: initClient, server: initServer, edge: initEdge };
  const load = (path: "client" | "server" | "edge") => {
    inits[path]();
    return sentryInit.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  };

  test.each([
    "client",
    "server",
    "edge",
  ] as const)("%s 설정에 청소 함수가 걸려 있다", (path) => {
    const options = load(path);
    expect(options.beforeSend).toBe(sanitizeSentryEvent);
    expect(typeof options.beforeSendTransaction).toBe("function");
    expect(typeof options.beforeBreadcrumb).toBe("function");
    expect(typeof options.beforeSendLog).toBe("function");
    expect(options.enableLogs).toBe(true);
    expect(options.tracesSampleRate).toBe(0.1);
  });

  test("서버는 지역 변수를 첨부하지 않는다", () => {
    const options = load("server");
    expect(options.includeLocalVariables).toBe(false);
  });

  test("표본 비율은 환경변수로 덮되 잘못된 값은 기본값", () => {
    expect(parseTracesSampleRate("0.5")).toBe(0.5);
    expect(parseTracesSampleRate("abc")).toBe(0.1);
    expect(parseTracesSampleRate("5")).toBe(0.1);
    expect(parseTracesSampleRate(undefined)).toBe(0.1);
  });

  test("오류 이벤트의 주소·헤더·이동기록이 치환된다", () => {
    const event = sanitizeSentryEvent(
      {
        type: undefined,
        request: {
          url: `https://findable.co.kr/r/${TOKEN}?x=1`,
          query_string: "x=1",
          headers: { Referer: `https://findable.co.kr/ko/audit/${JOB}` },
        },
        transaction: `/ko/audit/${JOB}`,
        breadcrumbs: [
          { category: "navigation", data: { to: `/r/${TOKEN}`, from: "/" } },
        ],
      } as ErrorEvent,
      {}
    );
    expect(event?.request?.url).toBe("https://findable.co.kr/r/[token]");
    expect(event?.request?.query_string).toBeUndefined();
    expect(event?.request?.headers?.Referer).toBe(
      "https://findable.co.kr/ko/audit/[jobId]"
    );
    expect(event?.transaction).toBe("/ko/audit/[jobId]");
    expect(event?.breadcrumbs?.[0]?.data?.to).toBe("/r/[token]");
  });

  test("트랜잭션과 로그도 치환된다", () => {
    const tx = sanitizeSentryTransaction({
      type: "transaction",
      transaction: `/r/${TOKEN}`,
      request: { url: `https://findable.co.kr/r/${TOKEN}` },
    } as Parameters<typeof sanitizeSentryTransaction>[0]);
    expect(tx.transaction).toBe("/r/[token]");
    expect(tx.request?.url).toBe("https://findable.co.kr/r/[token]");

    const log = sanitizeSentryLog({
      level: "info",
      message: `GET /ko/audit/${JOB} ok`,
      attributes: { path: `/r/${TOKEN}` },
    } as Parameters<typeof sanitizeSentryLog>[0]);
    expect(String(log.message)).toContain("/audit/[jobId]");
    expect(JSON.stringify(log.attributes)).toContain("/r/[token]");
  });
});

describe("PostHog", () => {
  test("before_send 가 주소 속성을 치환한다", () => {
    const out = sanitizePostHogEvent({
      properties: {
        $current_url: "https://findable.co.kr/ko/pricing?t=1",
        $pathname: `/ko/audit/${JOB}`,
        $referrer: `https://findable.co.kr/ko/audit/${JOB}?x=1`,
        $initial_current_url: `https://findable.co.kr/r/${TOKEN}`,
        $initial_pathname: `/r/${TOKEN}`,
        $initial_referrer: "$direct",
        plan: "free",
      },
    });
    expect(out?.properties).toMatchObject({
      $current_url: "https://findable.co.kr/ko/pricing",
      $pathname: "/ko/audit/[jobId]",
      $referrer: "https://findable.co.kr/ko/audit/[jobId]",
      $initial_current_url: "https://findable.co.kr/r/[token]",
      $initial_pathname: "/r/[token]",
      $initial_referrer: "$direct",
      plan: "free",
    });
  });

  test("init 옵션: 사람 프로필·녹화·IP·before_send", async () => {
    vi.stubGlobal("window", { location: { pathname: "/ko" } });
    const { initializeAnalytics } = await import(
      "@repo/analytics/instrumentation-client"
    );
    initializeAnalytics();
    const options = posthogInit.mock.calls[0]?.[1];
    expect(options.person_profiles).toBe("identified_only");
    expect(options.disable_session_recording).toBe(true);
    expect(options.ip).toBe(false);
    expect(typeof options.before_send).toBe("function");
  });

  test("/r/ 경로로 진입하면 초기화하지 않는다", async () => {
    vi.stubGlobal("window", { location: { pathname: `/r/${TOKEN}` } });
    const { initializeAnalytics } = await import(
      "@repo/analytics/instrumentation-client"
    );
    initializeAnalytics();
    expect(posthogInit).not.toHaveBeenCalled();
  });
});

describe("2차 보강(코덱스 검토)", () => {
  test("Sentry Replay 는 완전 비활성(통합 없음·비율 0)", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE", "1");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_REPLAY_ERROR_SAMPLE_RATE", "1");
    initClient();
    const options = sentryInit.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
    const names = (options.integrations as { name: string }[]).map(
      (i) => i.name
    );
    expect(names).not.toContain("replay");
    vi.unstubAllEnvs();
  });

  test("PostHog: SPA 로 /r/ 에 들어가 발생한 이벤트는 버린다", () => {
    expect(
      sanitizePostHogEvent({
        properties: { $pathname: `/r/${TOKEN}`, $current_url: "x" },
      })
    ).toBeNull();
    expect(
      sanitizePostHogEvent({
        properties: { $current_url: `https://findable.co.kr/r/${TOKEN}?a=1` },
      })
    ).toBeNull();
    expect(
      sanitizePostHogEvent({ properties: { $pathname: "/ko/pricing" } })
    ).not.toBeNull();
  });

  test("PostHog: autocapture 속성 안의 주소도 재귀로 치환", () => {
    const out = sanitizePostHogEvent({
      properties: {
        $el_text: `/ko/audit/${JOB}`,
        $el_href: `/r/${TOKEN}?t=1`,
        $elements_chain: `a:href="/r/${TOKEN}"attr__href="/ko/audit/${JOB}"`,
        $elements: [{ attr__href: `/r/${TOKEN}` }],
      },
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(JOB);
    expect(text).toContain("/r/[token]");
  });

  test("Sentry: contexts·extra·span data 의 중첩 문자열도 치환", () => {
    const event = sanitizeSentryTransaction({
      type: "transaction",
      contexts: { custom: { deep: { link: `/r/${TOKEN}` } } },
      extra: { list: [`https://x.kr/ko/audit/${JOB}?token=abc`] },
      spans: [{ data: { nested: { u: `/r/${TOKEN}` } } }],
    } as unknown as Parameters<typeof sanitizeSentryTransaction>[0]);
    const text = JSON.stringify(event);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(JOB);
    expect(text).not.toContain("token=abc");
  });

  const makeDoc = (referrer = "") => {
    const appended: unknown[] = [];
    return {
      appended,
      doc: {
        referrer,
        head: { appendChild: (node: unknown) => appended.push(node) },
        createElement: () => ({ async: false, id: "", src: "" }),
        getElementById: (id: string) =>
          appended.find((n) => (n as { id: string }).id === id) ?? null,
        querySelector: () => null,
      },
    };
  };

  test("GA: 기존 gtag 가 있어도 현재 ID config 를 보장하고 스크립트는 한 번만", () => {
    const calls: unknown[][] = [];
    const w: Record<string, unknown> = {
      gtag: (...args: unknown[]) => calls.push(args),
    };
    const { doc, appended } = makeDoc();
    ensureGtag(w, doc, "G-TEST");
    ensureGtag(w, doc, "G-TEST");
    const configs = calls.filter((c) => c[0] === "config");
    expect(configs).toHaveLength(1);
    expect(configs[0]?.[1]).toBe("G-TEST");
    expect(configs[0]?.[2]).toEqual({ send_page_view: false });
    expect(appended).toHaveLength(1);
  });

  test("GA: page_referrer 치환·비밀 경로에서는 전송 안 함", () => {
    const calls: unknown[][] = [];
    const w: Record<string, unknown> = {
      gtag: (...args: unknown[]) => calls.push(args),
    };
    const { doc } = makeDoc(`https://findable.co.kr/ko/audit/${JOB}?x=1`);
    sendSafePageView(w, doc, "https://findable.co.kr", "/ko/pricing", "G-T");
    const view = calls.find((c) => c[0] === "event");
    expect(view?.[2]).toMatchObject({
      page_path: "/ko/pricing",
      page_referrer: "https://findable.co.kr/ko/audit/[jobId]",
    });

    calls.length = 0;
    sendSafePageView(
      w,
      doc,
      "https://findable.co.kr",
      `/ko/audit/${JOB}`,
      "G-T"
    );
    expect(calls.find((c) => c[0] === "event")).toBeUndefined();
    expect(w["ga-disable-G-T"]).toBe(true);
  });
});
