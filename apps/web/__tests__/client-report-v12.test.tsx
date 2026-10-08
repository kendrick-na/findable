// v12 웹 템플릿(2026-10-06 개정: 9쪽 + 데이터가 있으면 신규 3쪽 = 최대 12쪽) — 문구·범위(AI 4곳×16건)·발송 승인 표시·옛 템플릿 문구 없음.
// 픽셀·전문 대조는 scripts/client-report/v12-parity.py (개발 서버 + 원본 v12 PDF 필요) 로 한다.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClientReportData } from "@repo/audit/client-report/report-data";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { CALL_CTA, ClientReportV12, INTERNAL_STATUS_NOTE, V12_TEMPLATE_MD5 } =
  await import("../components/client-report-v12/report-v12");

const FIX = join(import.meta.dirname, "fixtures/client-report");
const fixture = JSON.parse(
  readFileSync(join(FIX, "knowverse-v12.report.json"), "utf8")
);
const sample = JSON.parse(
  readFileSync(join(FIX, "knowverse-v12-sample.report.json"), "utf8")
);

function render(sendApproved: boolean, source: unknown = fixture) {
  const data = parseClientReportData(source);
  if (data?.schemaVersion !== 2) {
    throw new Error("fixture 는 v2 승인본이어야 한다");
  }
  return renderToStaticMarkup(
    createElement(ClientReportV12, { data, sendApproved })
  );
}

describe("v12 웹 템플릿", () => {
  it("신규 쪽 데이터가 없으면 9쪽, 쪽 번호도 실제 쪽 수로 매긴다", () => {
    const html = render(false);
    expect(html.match(/<section class="page/g)).toHaveLength(9);
    expect(html).toContain("02 / 09");
    expect(html).not.toContain("이름 없이 물으면 누가 추천될까");
  });

  it("신규 3쪽(카테고리 점유율·주제별 1~3위·매출 기회)은 데이터가 있을 때만 나온다 — 12쪽", () => {
    const html = render(false, sample).replaceAll("<!-- -->", "");
    expect(html.match(/<section class="page/g)).toHaveLength(12);
    expect(html).toContain("11 / 12");
    expect(html).toContain("이름 없이 물으면 누가 추천될까");
    expect(html).toContain("주제별로 누가 1위일까");
    // 놓치는 매출(2026-10-07 확정): 큰 숫자 = 연, 월은 보조
    expect(html).toContain("AI 추천에서 빠져서 놓치는 매출");
    expect(html).toContain("연 약 4,813만\u00a0원");
    expect(html).toContain("월 약 401만\u00a0원");
    expect(html).toContain("연 7,000만\u00a0원");
    expect(html).toContain("69%");
    expect(html).toContain(
      "대신 다른 브랜드가 추천되거나 노우버스가 잘못 소개된 만큼입니다. (추정)"
    );
    expect(html).not.toContain("AI 추천을 거쳐 결정되는");
    expect(html).not.toContain("매달 약");
  });

  it("놓치는 매출 저장값이 없으면 화면에서 연매출 × 7% × (bad_n / n)으로 계산한다", () => {
    const stored = new Set([
      "ai_routed_annual",
      "miss_pct",
      "missed_annual",
      "missed_monthly",
    ]);
    const old = Object.fromEntries(
      Object.entries(sample.config.revenue_opportunity).filter(
        ([k]) => !stored.has(k)
      )
    );
    const html = render(false, {
      ...sample,
      config: { ...sample.config, revenue_opportunity: old },
    }).replaceAll("<!-- -->", "");
    // 1,000,000,000 × 7% = 70,000,000 × 11/16 = 48,125,000 → 연 약 4,813만 원
    expect(html).toContain("연 약 4,813만\u00a0원");
    expect(html).toContain("AI 답변 16건 중 5건만 노우버스를 정확히");
  });

  it("확인된 연매출이 없으면 돈 문장·매출 쪽이 통째로 빠진다", () => {
    const cfg = Object.fromEntries(
      Object.entries(sample.config).filter(([k]) => k !== "revenue_opportunity")
    );
    const html = render(false, { ...sample, config: cfg });
    expect(html).not.toContain("놓치는 매출");
    expect(html.match(/<section class="page/g)).toHaveLength(11);
  });

  it("행동은 「15분 통화」 하나, 내부 용어(측정 ID·P0·엔진)는 고객 화면에 없다", () => {
    const html = render(true, sample).replaceAll("<!-- -->", "");
    expect(html.split(CALL_CTA).length - 1).toBe(1);
    expect(html).not.toContain("20일 개선 PoC 알아보기");
    expect(html).not.toContain("측정 ID");
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\bP[012]\b/);
    expect(text).not.toContain("엔진");
    expect(html).not.toContain("GEO 실험");
  });

  it("v12 범위 문구(AI 4곳·16건·5/16·정답을 낸 AI)", () => {
    const html = render(false);
    for (const t of [
      "AI 4곳 · 16<!-- -->건",
      "틀리거나 모른다고 한 답변",
      "한 번이라도 맞힌 AI",
      "정확히 설명한 답변",
      "비교 답변 16건 (AI 4곳 × 질문 4개)",
      "다른 회사로 착각 5 · 지어낸 설명 3 · 모른다 3",
      "AI마다 같은 질문 4개",
    ]) {
      expect(html.replaceAll("<!-- -->", "")).toContain(
        t.replaceAll("<!-- -->", "")
      );
    }
  });

  it("🔴 옛 템플릿 문구·범위가 없다(AI·검색 엔진, 다음 검색, 정확 인식률 %, 네이버 표지 카드)", () => {
    const html = render(false);
    expect(html).not.toContain("AI·검색 엔진");
    expect(html).not.toContain("다음 검색은 AI 답변 대신");
    expect(html).not.toContain("정확 인식률</div>");
    expect(html).not.toContain("유효 답변");
    // 표지 카드 = cover_engines(chatgpt·claude·perplexity·gemini) — 네이버 없음
    const cover = html.slice(0, html.indexOf("</section>"));
    expect(cover).not.toContain("네이버");
    expect(cover.match(/class="acard /g)).toHaveLength(4);
  });

  it("🔴 대표 발송 승인 전 = 모든 쪽 꼬리말·표지·뒷표지에 「내부 시안 · 외부 발송 금지」", () => {
    const html = render(false);
    expect(html.split(INTERNAL_STATUS_NOTE).length - 1).toBeGreaterThanOrEqual(
      9
    );
    expect(html).not.toContain("고객 전용");
  });

  it("발송 승인 후 = 원본 템플릿 기본값(고객 전용) — 내부 시안 문구 없음", () => {
    const html = render(true);
    expect(html).not.toContain(INTERNAL_STATUS_NOTE);
    expect(html).toContain("고객 전용 · 무단 배포 금지");
    expect(html.split("고객 전용").length - 1).toBeGreaterThanOrEqual(8);
  });

  it("문구 속 서식 태그는 허용한 것만(b·em·br) 살아나고, 스크립트는 글자로 찍힌다", () => {
    const html = render(false);
    expect(html).not.toContain("&lt;br&gt;");
    const data = parseClientReportData(fixture);
    if (data?.schemaVersion !== 2) {
      throw new Error("fixture");
    }
    const evil = {
      ...data,
      config: {
        ...data.config,
        cover_title: "<script>x()</script><b>굵게</b>",
      },
    };
    const out = renderToStaticMarkup(
      createElement(ClientReportV12, { data: evil, sendApproved: false })
    );
    expect(out).not.toContain("<script>x()");
    expect(out).toContain("<b>굵게</b>");
  });

  it("CSS 는 원본 v12 템플릿(md5)에서 기계 변환한 것과 같은 판이다", () => {
    const css = readFileSync(
      join(
        import.meta.dirname,
        "../components/client-report-v12/report-v12.css"
      ),
      "utf8"
    );
    expect(css.split("\n")[0]).toContain(V12_TEMPLATE_MD5);
    expect(createHash("md5").update(css).digest("hex")).toMatch(
      /^[0-9a-f]{32}$/
    );
    expect(css).not.toContain("file:///");
  });
});
