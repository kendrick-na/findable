// v12 웹 템플릿(11쪽) — 문구·범위(AI 4곳×16건)·발송 승인 표시·옛 템플릿 문구 없음.
// 픽셀·전문 대조는 scripts/client-report/v12-parity.py (개발 서버 + 원본 v12 PDF 필요) 로 한다.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClientReportData } from "@repo/audit/client-report/report-data";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ClientReportV12, INTERNAL_STATUS_NOTE, V12_TEMPLATE_MD5 } =
  await import("../components/client-report-v12/report-v12");

const FIX = join(import.meta.dirname, "fixtures/client-report");
const fixture = JSON.parse(
  readFileSync(join(FIX, "knowverse-v12.report.json"), "utf8")
);

function render(sendApproved: boolean) {
  const data = parseClientReportData(fixture);
  if (data?.schemaVersion !== 2) {
    throw new Error("fixture 는 v2 승인본이어야 한다");
  }
  return renderToStaticMarkup(
    createElement(ClientReportV12, { data, sendApproved })
  );
}

describe("v12 웹 템플릿", () => {
  it("11쪽, v12 범위 문구(AI 4곳·16건·5/16·정답을 낸 AI)", () => {
    const html = render(false);
    expect(html.match(/<section class="page/g)).toHaveLength(11);
    for (const t of [
      "AI 4곳 · 16<!-- -->건",
      "정확히 설명하지 못함",
      "정답을 낸 AI",
      "공식 사이트가 출처에 있던 답변",
      "비교 답변 16건 (AI 4곳 × 질문 4개)",
      "다른 회사로 착각 5 · 지어낸 설명 3 · 모른다 3",
      "정확 비율 높은 순 · AI마다 같은 질문 4개",
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
      11
    );
    expect(html).not.toContain("고객 전용");
  });

  it("발송 승인 후 = 원본 템플릿 기본값(고객 전용) — 내부 시안 문구 없음", () => {
    const html = render(true);
    expect(html).not.toContain(INTERNAL_STATUS_NOTE);
    expect(html).toContain("고객 전용 · 무단 배포 금지");
    expect(html.split("고객 전용").length - 1).toBeGreaterThanOrEqual(10);
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
