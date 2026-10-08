/**
 * @vitest-environment jsdom
 *
 * 👤 2026-10-07 CEO 결정 — **공개 무료 진단을 외부에서 숨긴다(코드는 남긴다).**
 *   단일 플래그 env `FREE_AUDIT_PUBLIC_ENABLED`(기본 꺼짐)로 다시 켤 수 있어야 한다.
 *
 * 여기서 고정하는 계약:
 *   ① 플래그 판정 — 미설정·빈 값·"false" = 꺼짐, "true"/"1"/"on"/"yes" = 켜짐
 *   ② OFF: `/audit` 폼 페이지 = notFound(404) · 요금제에 Free Audit 등급·`/audit` 링크 0개
 *          · 대시보드 첫 화면의 「이미 무료 진단을 받아보셨나요?」 회수 안내 숨김
 *   ③ ON : 위 셋 모두 옛 동작 그대로
 *   ④ 전수 가드: `apps/web` 화면 어디에서든 `/audit` 폼으로 가는 링크는 플래그 뒤에 있어야 한다
 *
 * ⚠️ `POST /api/audit` 의 404 는 `audit-route-boundary.test.tsx` 가 고정한다(같은 mock 재사용).
 * ⚠️ apps/web 에는 테스트 러너가 없다 — 이 저장소 관례대로 app 스위트에서 web 소스를 import/읽는다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ko from "@repo/internationalization/dictionaries/ko.json";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    NEXT_PUBLIC_WEB_URL: "https://www.example.test",
  },
}));
vi.mock("@repo/seo/metadata", () => ({
  createMetadata: (input: Record<string, unknown>) => input,
}));
const notFoundError = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
  useRouter: () => ({ push: vi.fn() }),
}));
// 폼 자체(클라이언트 상호작용)는 이 테스트의 대상이 아니다 — 페이지가 그리는지만 본다.
vi.mock("../../web/app/[locale]/audit/components/audit-form", () => ({
  AuditForm: () => <form data-testid="audit-form" />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const { isFreeAuditPublicEnabled } = await import(
  "@repo/audit/free-audit-public"
);
const { visibleFaq, visiblePricingTiers } = await import(
  "../../web/lib/free-audit"
);
const auditPage = await import("../../web/app/[locale]/audit/page");
const pricingPage = await import("../../web/app/[locale]/pricing/page");
const { DashboardEmptyStateView } = await import(
  "../app/(authenticated)/components/dashboard-empty-state"
);

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe("① 플래그 판정 (기본 꺼짐)", () => {
  test.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["0", false],
    ["off", false],
    ["true", true],
    ["TRUE", true],
    ["1", true],
    [" on ", true],
    ["yes", true],
  ])("FREE_AUDIT_PUBLIC_ENABLED=%j → %s", (value, expected) => {
    expect(isFreeAuditPublicEnabled({ FREE_AUDIT_PUBLIC_ENABLED: value })).toBe(
      expected
    );
  });

  test("process.env 를 기본으로 읽는다", () => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "true");
    expect(isFreeAuditPublicEnabled()).toBe(true);
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "");
    expect(isFreeAuditPublicEnabled()).toBe(false);
  });
});

describe("② /audit 폼 페이지", () => {
  test("OFF → 페이지·메타데이터 모두 notFound(404)", async () => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "");
    await expect(auditPage.default(params("ko"))).rejects.toBe(notFoundError);
    await expect(auditPage.generateMetadata(params("ko"))).rejects.toBe(
      notFoundError
    );
  });

  test("ON → 옛 폼 페이지를 그대로 그린다", async () => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "true");
    const view = render(
      (await auditPage.default(params("ko"))) as ReactElement
    );
    expect(view.getByTestId("audit-form")).toBeTruthy();
    await expect(
      auditPage.generateMetadata(params("ko"))
    ).resolves.toBeTruthy();
  });
});

describe("③ 요금제 페이지", () => {
  const renderPricing = async (locale: string) =>
    render((await pricingPage.default(params(locale))) as ReactElement);
  const auditLinks = (container: HTMLElement) =>
    [...container.querySelectorAll("a")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => /\/audit(\/?$|\?)/.test(href));

  test.each([
    "ko",
    "en",
  ])("OFF(%s) → Free Audit 등급·/audit 링크·무료 진단 FAQ·부제가 없다", async (locale) => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "");
    const { container } = await renderPricing(locale);
    const text = container.textContent ?? "";
    expect(auditLinks(container)).toEqual([]);
    expect(text).not.toContain("Free Audit");
    expect(text).not.toMatch(/무료 진단|free audit/i);
    // 유료 3등급은 그대로 남는다.
    for (const name of ["Starter", "Growth", "Scale"]) {
      expect(text).toContain(name);
    }
    const meta = (await pricingPage.generateMetadata(params(locale))) as {
      description: string;
    };
    expect(meta.description).not.toMatch(/무료 진단|free audit/i);
  });

  test("ON(ko) → 옛 표 그대로(Free Audit 등급 + /ko/audit 링크 + 무료 진단 FAQ)", async () => {
    vi.stubEnv("FREE_AUDIT_PUBLIC_ENABLED", "true");
    const { container } = await renderPricing("ko");
    const text = container.textContent ?? "";
    expect(auditLinks(container)).toEqual(["/ko/audit"]);
    expect(text).toContain("Free Audit 모든 기능");
    expect(text).toContain("무료 진단은 정말 무료인가요?");
    expect(text).toContain("무료 진단으로 시작해서");
  });

  test("헬퍼는 원본 데이터를 바꾸지 않는다(켜면 그대로 돌아온다)", () => {
    const tiers = [
      { name: "Free Audit", features: ["a"] },
      { name: "Starter", features: ["Free Audit 모든 기능", "b"] },
    ];
    const faq = [{ q: "무료 진단은 정말 무료인가요?" }, { q: "다른 질문" }];
    expect(visiblePricingTiers(tiers, false)).toEqual([
      { name: "Starter", features: ["b"] },
    ]);
    expect(visiblePricingTiers(tiers, true)).toBe(tiers);
    expect(tiers[1].features).toHaveLength(2);
    expect(visibleFaq(faq, false)).toEqual([{ q: "다른 질문" }]);
    expect(visibleFaq(faq, true)).toBe(faq);
  });
});

describe("④ 앱 대시보드 첫 화면의 무료 진단 회수 안내", () => {
  const t = ko.app.emptyState;
  const base = { sampleUrl: "https://www.example.test/sample", t };

  test("OFF(기본값) → 회수 안내를 그리지 않는다", () => {
    const view = render(
      <DashboardEmptyStateView {...base} signedInEmail="a@example.com" />
    );
    expect(view.queryByText(t.reclaimTitle)).toBeNull();
    // 나머지 온보딩(브랜드 등록 CTA)은 그대로다.
    expect(view.getByText(t.cta)).toBeTruthy();
  });

  test("ON → 옛 회수 안내를 그대로 그린다", () => {
    const view = render(
      <DashboardEmptyStateView
        {...base}
        showFreeAuditReclaim
        signedInEmail="a@example.com"
      />
    );
    expect(view.getByText(t.reclaimTitle)).toBeTruthy();
  });

  test("서버 껍데기가 같은 플래그를 읽어 넘긴다", () => {
    const server = readFileSync(
      join(
        import.meta.dirname,
        "../app/(authenticated)/components/dashboard-empty-state-server.tsx"
      ),
      "utf8"
    );
    expect(server).toContain(
      "showFreeAuditReclaim={isFreeAuditPublicEnabled()}"
    );
  });
});

describe("⑤ 전수 가드 — /audit 폼 링크는 반드시 플래그 뒤에 있다", () => {
  const WEB = join(import.meta.dirname, "../../web");
  /** 주석은 세지 않는다(「왜 숨겼는지」 적은 자리가 가드를 물면 안 된다). */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /** `/audit` 폼으로 가는 링크(결과 페이지 `/audit/<jobId>` 는 제외). */
  const AUDIT_FORM_LINK = /\/audit(`|"|'|\?)/;

  const files = () => {
    const { globSync } = require("node:fs") as typeof import("node:fs");
    return (
      globSync(join(WEB, "app/**/*.{ts,tsx}"), {
        exclude: (p: string) =>
          p.includes("node_modules") || p.includes(".next"),
      }) as string[]
    ).filter(
      // 폼 페이지 자체와 공개 진단 API 는 이미 진입부에서 404 로 닫힌다.
      (f) =>
        !(
          f.includes("/app/[locale]/audit/page.tsx") ||
          f.includes("/app/[locale]/audit/components/") ||
          f.includes("/app/api/")
        )
    );
  };

  test("훑는 대상이 비어 있지 않다", () => {
    expect(files().length).toBeGreaterThan(20);
  });

  test("/audit 링크가 있는 파일은 모두 freeAuditPublic 플래그를 참조한다", () => {
    const offenders = files()
      .filter((f) =>
        AUDIT_FORM_LINK.test(stripComments(readFileSync(f, "utf8")))
      )
      .filter((f) => !readFileSync(f, "utf8").includes("freeAuditPublic"))
      .map((f) => f.replace(WEB, "apps/web"));
    expect(offenders, "플래그 없이 /audit 폼으로 보내는 화면").toEqual([]);
  });

  test("sitemap·robots·llms.txt 도 같은 플래그를 따른다", () => {
    for (const rel of [
      "app/sitemap.ts",
      "app/robots.ts",
      "app/llms.txt/route.ts",
    ]) {
      expect(readFileSync(join(WEB, rel), "utf8"), rel).toContain(
        "freeAuditPublicEnabled()"
      );
    }
  });
});
