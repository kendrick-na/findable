import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * @vitest-environment jsdom
 *
 * 답변 4분류 화면 (2026-09-29) — **렌더해서** 확인한다(소스 문자열 검사 아님).
 * 입력은 공개 API 응답 원본(packages/audit/__fixtures__/public-audits).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withRecomputedAuditMetrics } from "@repo/audit/normalize-stored-metrics";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnswerBucketBoard,
  BrandNameMismatchNotice,
  type MatrixAnswer,
  QuestionEngineMatrix,
  RevenueImpactOptIn,
} from "../../web/app/[locale]/audit/[jobId]/components/answer-buckets";
import { DashboardAnswerBuckets } from "../app/(authenticated)/components/dashboard-answer-buckets";

/** 대시보드 카드 문구는 사전에서 온다(2026-10-06) — 한국어 화면 기준으로 검사. */
const KO_BUCKETS = koDict.app.answerBuckets;

const FIXTURES = join(
  process.cwd(),
  "../../packages/audit/__fixtures__/public-audits"
);

function replay(id: string) {
  const data = JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), "utf8"));
  return withRecomputedAuditMetrics(data.result) as {
    engineResponses: MatrixAnswer[];
    measurementContext: { brandNameCheck: never };
    metrics: { answerBuckets: never };
  };
}

const KNOWVERSE = "b7f319e1-1d96-4875-a1e1-e7f5e0e814c9";

afterEach(cleanup);

function tile(container: HTMLElement, bucket: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="answer-bucket-board"] [data-bucket="${bucket}"]`
  );
  if (!el) {
    throw new Error(`tile ${bucket} missing`);
  }
  return el as HTMLElement;
}

describe("AnswerBucketBoard — 공개 리포트 히어로 4칸", () => {
  it("노우버스: 제대로 앎 5 · 다른 회사로 앎 5 · 모름 5 (AI 4곳 16개) · 측정 실패 0 (답변 기준 비율)", () => {
    const result = replay(KNOWVERSE);
    const { container } = render(
      <AnswerBucketBoard isKo summary={result.metrics.answerBuckets} />
    );
    expect(within(tile(container, "confirmed")).getByText("5")).toBeTruthy();
    expect(within(tile(container, "confirmed")).getByText("33%")).toBeTruthy();
    expect(
      within(tile(container, "different_entity")).getByText("5")
    ).toBeTruthy();
    expect(
      within(tile(container, "different_entity")).getByText("다른 회사로 앎")
    ).toBeTruthy();
    expect(within(tile(container, "unknown")).getByText("5")).toBeTruthy();
    expect(within(tile(container, "engine_error")).getByText("0")).toBeTruthy();
    // 기준이 라벨에 적혀 있다(엔진 기준과 섞이지 않게).
    expect(container.textContent).toContain("답변 기준");
    // Daum 은 검색 노출로 따로
    expect(
      container.querySelector('[data-testid="search-exposure-line"]')
        ?.textContent
    ).toContain("다음 검색 노출");
    // 판정 보류 1개는 각주
    expect(container.textContent).toContain("판정 보류 1");
  });

  it("이름 없는 질문이 0개인 회차는 그 이유를 말한다 · 그 기능 이전 회차는 말하지 않는다", () => {
    const summary = replay(KNOWVERSE).metrics.answerBuckets;
    const zero = render(
      <AnswerBucketBoard discoveryPromptCount={0} isKo summary={summary} />
    );
    expect(
      zero.container.querySelector('[data-testid="discovery-line"]')
        ?.textContent
    ).toContain("업종 단서");
    cleanup();
    const legacy = render(<AnswerBucketBoard isKo summary={summary} />);
    expect(
      legacy.container.querySelector('[data-testid="discovery-line"]')
    ).toBeNull();
  });
});

describe("QuestionEngineMatrix — 질문 × 엔진", () => {
  it("질문 원문 4개가 모두 보이고, 배지는 4분류 라벨이다(「미언급」 없음)", () => {
    const { container } = render(
      <QuestionEngineMatrix
        brandDomain="knowverse.net"
        isKo
        rows={replay(KNOWVERSE).engineResponses}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("노우버스는 어떤 브랜드이고 어떤 서비스를 제공해?");
    expect(text).toContain("Top alternatives to 노우버스 and how they differ");
    expect(text).not.toContain("미언급");
    const differentRows = container.querySelectorAll(
      'li[data-bucket="different_entity"]'
    );
    expect(differentRows.length).toBe(5); // AI 4곳만 — 과거 HyperCLOVA 원문은 「집계 제외」
    // 과거 네이버 합성 요약은 판정 배지 없이 회색 표기
    const legacy = container.querySelectorAll('li[data-bucket="legacy_naver"]');
    expect(legacy.length).toBe(2);
    for (const li of legacy) {
      expect(li.textContent).toContain(
        "이전 측정: Findable이 검색 결과로 만든 요약(현재 미사용)"
      );
      expect(li.textContent).toContain("검색 노출: 공식 도메인 없음");
      expect(li.textContent).not.toContain("다른 회사로 앎");
      expect(li.textContent).not.toContain("우버");
    }
    expect(text).toContain("HyperCLOVA X (서비스 종료 전 이전 측정)");
    // 질문 머리의 요약 수에는 HyperCLOVA·검색 노출이 섞이지 않는다
    expect(container.querySelectorAll('li[data-bucket="retired"]').length).toBe(
      2
    );
    expect(text).toContain("집계 제외 · 서비스 종료");
    // Q1 머리 요약: AI 4곳만(HyperCLOVA 「모름」이 섞이면 「모름 1」이 붙는다)
    expect(text).toContain(
      "노우버스는 어떤 브랜드이고 어떤 서비스를 제공해?제대로 앎 1다른 회사로 앎 3ChatGPT"
    );
    // 브리핑은 이 표에 없다(별도 축)
    expect(text).not.toContain("naver-briefing");
    // 사유 한 줄
    expect(text).toContain("같은 이름의 다른 대상을 설명했어요");
    // 🔴 엔진 이름은 실제로 잰 것을 말한다(네이버·다음 = 검색 노출)
    expect(text).toContain("네이버 검색 노출");
    expect(text).toContain("다음 검색 노출");
    expect(text).toContain("ChatGPT (웹검색 없음)");
    expect(
      container.querySelector('[data-testid="engine-legend"]')?.textContent
    ).toContain("네이버가 직접 한 답이 아니에요");
  });

  it("측정 실패는 발췌 대신 사유(한도 초과)를 보여준다", () => {
    const rows = replay("d5dd90b4-1bf3-4022-bfa6-76de64ab8496").engineResponses;
    const { container } = render(<QuestionEngineMatrix isKo rows={rows} />);
    const failed = container.querySelectorAll('li[data-bucket="engine_error"]');
    expect(failed.length).toBe(4);
    for (const li of failed) {
      expect(li.textContent).toContain("사용 한도 초과");
      expect(li.textContent).not.toContain("exceeded");
    }
  });
});

describe("RevenueImpactOptIn — 고객 숫자 없이는 추정하지 않는다", () => {
  it("입력 전엔 세션 추정이 없고, 두 값을 넣으면 그 값으로 계산한다", () => {
    const { container } = render(
      <RevenueImpactOptIn
        attemptedEngines={7}
        isKo
        measuredEngines={7}
        sov={26}
      />
    );
    expect(container.textContent).toContain("가정한 유입 규모를 보고 싶다면");
    expect(container.textContent).not.toContain("세션 / 월");
    const inputs = container.querySelectorAll("input");
    fireEvent.change(inputs[0] as HTMLInputElement, {
      target: { value: "20000" },
    });
    expect(container.textContent).not.toContain("세션 / 월");
    fireEvent.change(inputs[1] as HTMLInputElement, {
      target: { value: "50000" },
    });
    expect(container.textContent).toContain("세션 / 월");
    // 규모 프리셋(기본 가정)은 고객 값이 있으면 쓰지 않는다
    expect(container.textContent).not.toContain(
      "측정 결과(인지 엔진 수·점유율)로 자동 선택됨"
    );
  });
});

describe("BrandNameMismatchNotice", () => {
  it("🔴 「Findable OAuth Verification」 회차는 경고, 노우버스는 없음", () => {
    const bad = replay("00e40b02-cf16-48c8-bb61-ace0c1da692f");
    const r1 = render(
      <BrandNameMismatchNotice
        check={bad.measurementContext.brandNameCheck}
        isKo
      />
    );
    expect(r1.container.textContent).toContain("Findable OAuth Verification");
    expect(r1.container.textContent).toContain("「Findable」");
    cleanup();
    const good = replay(KNOWVERSE);
    const r2 = render(
      <BrandNameMismatchNotice
        check={good.measurementContext.brandNameCheck}
        isKo
      />
    );
    expect(r2.container.textContent).toBe("");
  });
});

describe("DashboardAnswerBuckets — 대시보드도 같은 숫자", () => {
  it("대시보드 카드 4칸이 공개 리포트와 같은 수를 말한다", () => {
    const { container } = render(
      <DashboardAnswerBuckets result={replay(KNOWVERSE)} t={KO_BUCKETS} />
    );
    const count = (bucket: string) =>
      container
        .querySelector(`[data-bucket="${bucket}"]`)
        ?.querySelector(".text-2xl")?.textContent;
    expect(count("confirmed")).toBe("5");
    expect(count("different_entity")).toBe("5");
    expect(count("unknown")).toBe("5");
    expect(count("engine_error")).toBe("0");
    expect(container.textContent).toContain(
      "엔진 기준 · 우리를 제대로 안 AI 2/4곳"
    );
  });
});
