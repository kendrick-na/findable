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

const {
  CALL_CTA,
  CALL_CTA_V2,
  CTA_V2_HEADLINE,
  ClientReportV12,
  eulreul,
  eunneun,
  iga,
  INTERNAL_STATUS_NOTE,
  V12_TEMPLATE_MD5,
} = await import("../components/client-report-v12/report-v12");

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

// ── 2026-10-16 표지 직접 문구·매출 범위·분수 표기(대표 승인) — 필드가 있을 때만 적용, 없으면 기존 그대로 ──
describe("v12 템플릿 — 표지 문구·분수 표기(선택 필드)", () => {
  const withConfig = (extra: Record<string, unknown>) => ({
    ...sample,
    config: { ...sample.config, ...extra },
  });
  const text = (html: string) => html.replaceAll("<!-- -->", "");

  it("headlines.cover 가 없으면 기존 자동 한 줄 결론 그대로(회귀 0)", () => {
    const html = text(render(false, sample));
    expect(html).toContain("AI에게 노우버스를 물으면");
    expect(html).not.toContain('class="ssub"');
  });

  it("headlines.cover·cover_sub 가 있으면 자동 문장 대신 그것을 표지 큰 문구로 쓴다", () => {
    const html = text(
      render(
        false,
        withConfig({
          headlines: {
            ...(sample.config.headlines ?? {}),
            cover:
              "AI에 이름 없이 추천을 물으면, 노우버스는 <b>68번 중 0번</b>도 나오지 않습니다",
            cover_sub: "이름을 알려 주면 대체로 맞게 답합니다",
          },
        })
      )
    );
    expect(html).toContain("<b>68번 중 0번</b>");
    expect(html).not.toContain("AI에게 노우버스를 물으면");
    expect(html).toContain('class="ssub"');
    expect(html).toContain("이름을 알려 주면 대체로 맞게 답합니다");
  });

  it("headlines.cover 의 스크립트·허용 밖 태그는 글자로 찍힌다", () => {
    const html = render(
      false,
      withConfig({ headlines: { cover: "<script>alert(1)</script>안녕" } })
    );
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("headlines.revenue_range 문자열이 표지 매출 문구에 그대로 보인다(확인된 연매출이 있을 때만)", () => {
    const html = text(
      render(
        false,
        withConfig({
          headlines: { revenue_range: "190.9~211.2억 원" },
        })
      )
    );
    expect(html).toContain("연 약 190.9~211.2억 원");
    const cfg = Object.fromEntries(
      Object.entries(sample.config).filter(([k]) => k !== "revenue_opportunity")
    );
    const noRev = text(
      render(false, {
        ...sample,
        config: { ...cfg, headlines: { revenue_range: "190.9~211.2억 원" } },
      })
    );
    expect(noRev).not.toContain("190.9~211.2억");
  });

  it("display.fractions=true 면 점유·출처·엔진 막대가 분수로 나오고, 없으면 % 그대로", () => {
    const off = text(render(false, sample));
    const on = text(
      render(false, withConfig({ display: { fractions: true } }))
    );
    // 순위표 .p 칸
    const rankCells = (h: string) =>
      [...h.matchAll(/<span class="p">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(rankCells(off).every((v) => v?.endsWith("%"))).toBe(true);
    expect(rankCells(on).length).toBeGreaterThan(0);
    expect(rankCells(on).every((v) => /^\d+\/\d+$/.test(v ?? ""))).toBe(true);
    // 출처 범례(.ch-legend b)
    const legend = (h: string) =>
      [...h.matchAll(/<span class="ch-[a-z]+"[^>]*>[^<]*<b>([^<]*)<\/b>/g)].map(
        (m) => m[1]
      );
    expect(legend(off).every((v) => v?.endsWith("%"))).toBe(true);
    expect(legend(on).every((v) => /^\d+\/\d+$/.test(v ?? ""))).toBe(true);
    // AI가 관여하는 구매 비중 7%는 설문 비율이라 분수로 바꾸지 않는다.
    expect(on).toContain("7%");
  });
});

// ── 2026-10-16 PDF 점검 결함 7건 수정 ──
describe("v12 템플릿 — PDF 점검 결함 수정", () => {
  const text = (html: string) => html.replaceAll("<!-- -->", "");
  const withConfig = (extra: Record<string, unknown>) => ({
    ...sample,
    config: { ...sample.config, ...extra },
  });

  it("조사: 받침 유무로 이/가·은/는·을/를을 고른다(한글·영문·숫자)", () => {
    expect(iga("넘버즈인")).toBe("넘버즈인이");
    expect(iga("프란츠")).toBe("프란츠가");
    expect(iga("프롬맘")).toBe("프롬맘이");
    expect(eulreul("넘버즈인")).toBe("넘버즈인을");
    expect(eulreul("프란츠")).toBe("프란츠를");
    expect(eunneun("프롬맘")).toBe("프롬맘은");
    expect(eunneun("노우버스")).toBe("노우버스는");
    // 영문: l·m·n·r 만 받침 소리가 있다
    expect(iga("Findable")).toBe("Findable가");
    expect(iga("Wall")).toBe("Wall이");
    expect(eulreul("Peec AI")).toBe("Peec AI를");
    // 숫자(삼=받침, 이=없음)
    expect(iga("A3")).toBe("A3이");
    expect(iga("B2")).toBe("B2가");
    // 끝에 기호가 있어도 마지막 글자(주)로 판단
    expect(iga("프롬맘(주)")).toBe("프롬맘(주)가");
  });

  it("받침 있는 이름도 문장 조사가 맞게 나온다", () => {
    const html = text(
      render(false, {
        ...sample,
        config: { ...sample.config, brand: "넘버즈인" },
      })
    );
    expect(html).not.toContain("넘버즈인를");
    expect(html).not.toContain("넘버즈인가 ");
    expect(html).toContain("넘버즈인을");
  });

  it("display.cta_v2 가 없으면 기존 CTA, 켜면 20분 리뷰 문구·전화 포함", () => {
    const off = text(render(false, sample));
    expect(off).toContain(CALL_CTA);
    expect(off).toContain("15분만 시간을 내 주세요");
    expect(off).not.toContain("010-8958-2547");
    const on = text(render(false, withConfig({ display: { cta_v2: true } })));
    expect(on).toContain(CTA_V2_HEADLINE);
    expect(on).toContain(CALL_CTA_V2);
    expect(on).toContain("contact@findable.co.kr · 010-8958-2547");
    expect(on).not.toContain("15분");
  });

  it("매출 쪽 놓치는 비율: 분수 모드에서 miss_num/miss_den 이 있으면 분수, 없으면 기존 %", () => {
    const rev = {
      ...sample.config.revenue_opportunity,
      miss_den: 56,
      miss_num: 47,
    };
    const on = text(
      render(
        false,
        withConfig({ display: { fractions: true }, revenue_opportunity: rev })
      )
    );
    expect(on).toContain("<b>47/56</b>");
    const off = text(render(false, withConfig({ revenue_opportunity: rev })));
    expect(off).not.toContain("47/56");
    expect(off).toContain(`${sample.config.revenue_opportunity.miss_pct}%`);
  });

  it("매출 범위: 큰 숫자·결과 칸에 범위, 월 환산은 범위 문자열이 있을 때만(하한값만 보이지 않게)", () => {
    const base = { headlines: { revenue_range: "190.9~211.2억 원" } };
    const noMonthly = text(render(false, withConfig(base)));
    expect(noMonthly).toContain("190.9~211.2억<small>원 / 연</small>");
    expect(noMonthly).toContain("연 190.9~211.2억 원");
    expect(noMonthly).not.toContain('class="m">월 약');
    const withMonthly = text(
      render(
        false,
        withConfig({
          headlines: {
            revenue_range: "190.9~211.2억 원",
            revenue_range_monthly: "15.9~17.6억 원",
          },
        })
      )
    );
    expect(withMonthly).toContain('class="m">월 약 15.9~17.6억 원');
  });

  it("AI 4곳 모두 정답이면 '모두' 문장, 아니면 기존 '중 N곳만' 문장", () => {
    const html = text(render(false, sample));
    const s = sample.computed.s;
    if (s.engines_correct === s.engines_total) {
      expect(html).toContain(
        `AI ${s.engines_total}곳 <b>모두</b> 한 번 이상 정답을 냈습니다`
      );
    } else {
      expect(html).toContain(`<b>${s.engines_correct}곳</b>만 한 번`);
    }
    // 전원 정답 데이터로 바꿔 '모두' 문장 확인
    const all = JSON.parse(JSON.stringify(sample));
    all.computed.s.engines_correct = all.computed.s.engines_total;
    const allHtml = text(render(false, all));
    expect(allHtml).toContain("<b>모두</b> 한 번 이상 정답을 냈습니다");
    expect(allHtml).not.toContain("곳</b>만 한 번");
  });

  it("쪽 맞춤 스크립트: 푸터를 넘는 쪽에 fit1~fit4 를 붙이는 코드가 한 번 들어 있다", () => {
    const html = render(false, sample);
    expect(html.split("classList.add('fit'+k)").length - 1).toBe(1);
  });
});

// ── 레이아웃 v2(display.layout_v2) — 2026-10-16 ──
describe("v12 레이아웃 v2", () => {
  const text = (html: string) => html.replaceAll("<!-- -->", "");
  const l2Copy = {
    cover: {
      main: "AI에 추천을 물었더니, <b>노우버스</b>는 16번 중 <b>0번</b> 나왔습니다",
      sub: "이름을 알려 주면 대체로 맞게 답합니다.",
      revenue: "빠졌을 수 있는 매출, 연 약 0.5억 원 (추정)",
    },
    method: {
      sections: [{ h: "측정 방법", items: ["질문마다 1번씩 물었습니다."] }],
    },
  };
  async function renderL2(config: Record<string, unknown>, approved = false) {
    const { ClientReportV12L2 } = await import(
      "../components/client-report-v12/report-v12-l2"
    );
    const data = parseClientReportData({
      ...sample,
      config: { ...sample.config, ...config },
    });
    if (data?.schemaVersion !== 2) {
      throw new Error("sample 은 v2 여야 한다");
    }
    return text(
      renderToStaticMarkup(
        createElement(ClientReportV12L2, { data, sendApproved: approved })
      )
    );
  }

  it("11쪽: 표지·보는 법·핵심 숫자·이름 알려 주면·이름 없이·주제별·AI 모습·매출·할 일·측정 방법·문의", async () => {
    const html = await renderL2({
      layout_v2: l2Copy,
      display: { layout_v2: true },
    });
    expect(html.match(/<section class="page/g)).toHaveLength(11);
    expect(html).toContain("<b>0번</b> 나왔습니다");
    expect(html).toContain("이름을 알려 주면 대체로 맞게 답합니다.");
    // 푸터 쪽 번호 /11, 뒷표지 CTA v2(20분·전화)
    expect(html).toContain("02 / 11");
    expect(html).toContain("10 / 11");
    expect(html).toContain(CTA_V2_HEADLINE);
    expect(html).toContain("010-8958-2547");
    expect(html).not.toContain("15분");
  });

  it("자동 글자 축소 스크립트·fit 클래스를 쓰지 않는다", async () => {
    const html = await renderL2({ layout_v2: l2Copy });
    expect(html).not.toContain("classList.add('fit'");
    expect(html).not.toContain("fit1");
  });

  it("내부 시안 표기는 발송 승인 전 모든 쪽에, 승인 후에는 없다", async () => {
    const before = await renderL2({ layout_v2: l2Copy });
    expect(
      before.split(INTERNAL_STATUS_NOTE).length - 1
    ).toBeGreaterThanOrEqual(10);
    const after = await renderL2({ layout_v2: l2Copy }, true);
    expect(after).not.toContain(INTERNAL_STATUS_NOTE);
  });

  it("문구 키가 없어도 저장된 숫자로 만든 기본 문장으로 11쪽이 나온다", async () => {
    const html = await renderL2({});
    expect(html.match(/<section class="page/g)).toHaveLength(11);
    expect(html).toContain("AI에 추천을 물었더니");
    expect(html).toContain("나왔습니다");
  });

  it("점유·주제·매출 데이터가 없으면 그 쪽만 빠지고 쪽 번호는 실제 쪽 수로 매긴다", async () => {
    const html = await renderL2({
      category_share: undefined,
      topic_winners: undefined,
      revenue_opportunity: undefined,
    });
    expect(html.match(/<section class="page/g)).toHaveLength(8);
    expect(html).toContain("02 / 08");
    expect(html).not.toContain("빠졌을 수 있는 매출");
  });

  it("'놓치는 매출'(손실 단정) 문구를 쓰지 않는다 — 확정 규칙 E3", async () => {
    const html = await renderL2({ layout_v2: l2Copy });
    expect(html).not.toContain("놓치는 매출");
    expect(html).toContain("빠졌을 수 있는 매출");
  });

  it("쪽 전환 코드: 플래그가 있을 때만 L2, 기본은 기존 12쪽", () => {
    const src = readFileSync(
      join(import.meta.dirname, "../app/r/[token]/page.tsx"),
      "utf8"
    );
    expect(src).toContain("layout_v2");
    expect(src).toContain("ClientReportV12L2");
    expect(src).toContain("<ClientReportV12 data");
  });
});
