import { filterStoredGeoActions } from "@repo/audit/action-display-filter";
import type { GeoAction } from "@repo/audit/actions";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDetails,
  ActionLead,
} from "../app/[locale]/audit/[jobId]/components/action-teaser-cards";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  database: { auditJob: { findUnique: mocks.findUnique } },
}));
vi.mock("@repo/observability/error", () => ({
  parseError: (error: unknown) => String(error),
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn() },
}));
vi.mock("@repo/seo/metadata", () => ({ createMetadata: () => ({}) }));
vi.mock("../app/api/audit/_lib/owner", () => ({
  resolveIsOwner: vi.fn(async () => false),
}));
vi.mock("../app/api/audit/_lib/public-access", () => ({
  canExposeAuditResult: vi.fn(() => true),
}));
vi.mock("@repo/audit/normalize-stored-metrics", () => ({
  isPublishableAuditResult: () => false,
  withRecomputedAuditMetrics: (result: unknown) => result,
}));
vi.mock("../app/[locale]/audit/[jobId]/components/audit-summary-ssr", () => ({
  AuditSummarySsr: () => null,
}));

const newAction: GeoAction = {
  evidence: "현재 측정에서 네이버 검색 노출이 확인되지 않았습니다.",
  guide: {
    evidenceGrade: "medium",
    engines: ["naver"],
    effectLag: "게시 후 며칠~몇 주",
    effortHours: { min: 2, max: 4, per: "total" },
    remeasureMetric: "같은 질문에서 네이버 검색 노출이 확인된 질문 수",
    failCondition: "다음 측정에서도 노출이 확인되지 않으면 재점검",
    notGuaranteed: "게시한다고 네이버 검색 노출이 보장되지는 않습니다.",
    sources: [{ label: "출처 A", url: "https://example.com/a" }],
  },
  how: "질문에 답하는 페이지를 게시하세요.",
  kind: "naver_blog",
  priority: 2,
  title: "네이버 검색에 잡힐 글을 올리세요",
  verification: "같은 질문에 네이버 검색 노출이 있었는지 확인하세요.",
  where: "네이버 블로그(회사 공식 계정)",
};

const storedAction = {
  kind: "naver_blog",
  title: "네이버 블로그에 꾸준히 글을 올리세요",
  evidence: "기존 측정 근거",
  how: "기존 실행 방법",
  verification:
    "다음 측정에서 네이버·네이버 AI 브리핑·HyperCLOVA X 답변이 우리를 알아봤는지 보세요.",
  source: "근거 약함 · 기존 출처",
  priority: 2 as const,
  guide: {
    evidenceGrade: "weak" as const,
    engines: ["naver", "naver-briefing", "hyperclova"],
    effectLag: "게시 후 몇 주~몇 달",
    effortHours: { min: 1, max: 2, per: "week" as const },
    remeasureMetric: "AI가 제대로 알아본 답변 수",
    failCondition: "네이버 계열 답변에서 알아본 답변이 0건이면 재점검",
    notGuaranteed: "매주 올리면 네이버 AI 브리핑에 인용된다는 근거는 없습니다.",
    sources: [{ label: "기존 출처", url: "https://example.com/legacy" }],
  },
};

const storedProjectedAction = filterStoredGeoActions([
  storedAction,
])[0] as GeoAction;

vi.mock("../app/[locale]/audit/[jobId]/components/audit-result", () => ({
  AuditResultView: ({ locale }: { locale: string }) => {
    const isKo = locale.startsWith("ko");
    return createElement(
      "section",
      null,
      createElement(ActionLead, { action: newAction, isKo }),
      createElement(ActionDetails, {
        action: storedProjectedAction,
        index: 1,
        isKo,
      })
    );
  },
}));

import AuditResultPage from "../app/[locale]/audit/[jobId]/page";

const job = {
  email: "lead@example.com",
  organizationId: null,
  domain: "example.com",
  result: {},
  status: "completed" as const,
};

describe("무료 진단 route-level 액션 가이드 렌더 계약", () => {
  beforeEach(() => {
    mocks.findUnique.mockResolvedValue(job);
  });

  it.each([
    ["ko", "적용 채널", "네이버 검색 노출", "수정 위치", "검증 방법"],
    [
      "en",
      "Measurement channels",
      "Naver search exposure",
      "Where to change",
      "How to verify",
    ],
  ])("%s route가 신규·저장 카드의 채널·위치·검증·비보장 고지를 렌더한다", async (locale, channelLabel, naverLabel, whereLabel, verifyLabel) => {
    const html = renderToStaticMarkup(
      await AuditResultPage({
        params: Promise.resolve({
          locale,
          jobId: "11111111-1111-4111-8111-111111111111",
        }),
      })
    );
    expect(html).toContain(channelLabel);
    expect(html).toContain(naverLabel);
    expect(html).toContain(whereLabel);
    expect(html).toContain(verifyLabel);
    expect(html).toContain(locale === "ko" ? "근거" : "Evidence:");
    expect(html).toContain("네이버 검색에 잡힐 글을 올리세요");
    expect(html).toContain(
      locale === "ko"
        ? "네이버 블로그에 꾸준히 글을 올리세요"
        : "네이버 블로그에 꾸준히 글을 올리세요"
    );
    expect(html).toContain(
      locale === "ko"
        ? "효과를 입증하지 않습니다"
        : "they do not prove an effect"
    );
    expect(html).not.toContain("적용되는 AI");
    expect(html).not.toContain("Naver AI Briefing");
    expect(html).not.toContain("HyperCLOVA X");
  });
});
