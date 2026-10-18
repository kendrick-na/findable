import { describe, expect, it } from "vitest";
import {
  buildGapPreflight,
  classifyGaps,
  finalizeGapDiagnostics,
  formatUnmeasuredTable,
  isMeasurementGapLogEnabled,
  MIN_HEALTHY_QUESTION_COUNT,
  questionSetWarnings,
} from "./measurement-gap";
import { classifySiteReadError } from "./site-profile";

describe("플래그", () => {
  it("기본 꺼짐, 1/true 만 켜짐", () => {
    expect(isMeasurementGapLogEnabled({})).toBe(false);
    expect(
      isMeasurementGapLogEnabled({ MEASUREMENT_GAP_LOG_ENABLED: "0" })
    ).toBe(false);
    expect(
      isMeasurementGapLogEnabled({ MEASUREMENT_GAP_LOG_ENABLED: "true" })
    ).toBe(true);
  });
});

describe("질문 세트 경고(시작 전·후 같은 규칙)", () => {
  it("0개 / 8개 미만 / 이름 질문 0개를 가른다", () => {
    expect(
      questionSetWarnings({ brandQuestionCount: 0, questionCount: 0 })
    ).toEqual(["zero_questions"]);
    expect(
      questionSetWarnings({ brandQuestionCount: 2, questionCount: 6 })
    ).toEqual(["few_questions"]);
    expect(
      questionSetWarnings({ brandQuestionCount: 0, questionCount: 6 })
    ).toEqual(["few_questions", "no_brand_question"]);
    expect(
      questionSetWarnings({
        brandQuestionCount: 0,
        questionCount: MIN_HEALTHY_QUESTION_COUNT,
      })
    ).toEqual(["no_brand_question"]);
    expect(
      questionSetWarnings({ brandQuestionCount: 3, questionCount: 8 })
    ).toEqual([]);
  });
});

describe("사유 분류", () => {
  it("사이트 → 질문 → 엔진 순서로 코드를 모은다", () => {
    expect(
      classifyGaps({
        brandQuestionCount: 0,
        engine: { attempted: 6, measured: 0 },
        questionCount: 0,
        siteOutcome: "robots_blocked",
      })
    ).toEqual(["robots_blocked", "zero_questions", "all_engines_failed"]);
    expect(
      classifyGaps({
        brandQuestionCount: 3,
        questionCount: 12,
        siteOutcome: "ok",
      })
    ).toEqual([]);
  });

  it("사이트 읽기 결과 코드를 사유로 옮긴다(인증서·시간 초과·렌더링 필요)", () => {
    const base = { brandQuestionCount: 3, questionCount: 12 };
    expect(classifyGaps({ ...base, siteOutcome: "certificate_error" })).toEqual(
      ["certificate_error"]
    );
    expect(classifyGaps({ ...base, siteOutcome: "timeout" })).toEqual([
      "site_timeout",
    ]);
    expect(classifyGaps({ ...base, siteOutcome: "render_needed" })).toEqual([
      "render_needed",
    ]);
    expect(classifyGaps({ ...base, siteOutcome: "fetch_failed" })).toEqual([
      "site_unreachable",
    ]);
  });

  it("시작 전 기록 + 끝난 뒤 분류가 이어진다(이름 질문 수는 discovery 가 아닌 것)", () => {
    const pre = buildGapPreflight({
      prompts: [{ kind: "brand" }, { kind: undefined }, { kind: "discovery" }],
      siteOutcome: "render_needed",
    });
    expect(pre.questionCount).toBe(3);
    expect(pre.brandQuestionCount).toBe(2);
    expect(pre.warnings).toEqual(["few_questions"]);
    expect(
      finalizeGapDiagnostics(pre, { attempted: 4, measured: 4 }).codes
    ).toEqual(["render_needed", "few_questions"]);
  });
});

describe("사이트 읽기 오류 분류", () => {
  it("인증서 오류는 cause 깊이까지 본다", () => {
    const cause = Object.assign(
      new Error("Hostname/IP does not match certificate's altnames"),
      {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      }
    );
    expect(classifySiteReadError(new Error("fetch failed", { cause }))).toBe(
      "certificate_error"
    );
  });
  it("시간 초과·HTML 아님·그 밖", () => {
    expect(
      classifySiteReadError(
        new DOMException("signal timed out", "TimeoutError")
      )
    ).toBe("timeout");
    expect(classifySiteReadError(new Error("NOT_HTML"))).toBe("not_html");
    expect(classifySiteReadError(new Error("HTTP_500"))).toBe("fetch_failed");
  });
});

describe("측정 완료 보고 — 못 잰 곳 사유별 표", () => {
  it("사유별 곳 수·ID 와 정상 수를 낸다(회사명·도메인 없음)", () => {
    const table = formatUnmeasuredTable([
      { codes: ["robots_blocked", "zero_questions"], id: "A-30" },
      { codes: ["certificate_error"], id: "I-21" },
      { codes: ["few_questions", "no_brand_question"], id: "A-15" },
      { codes: ["few_questions"], id: "E-11" },
      { codes: [], id: "A-01" },
    ]);
    expect(table).toContain("| 사이트가 AI 접근을 막음(robots) | 1 | A-30 |");
    expect(table).toContain("| 질문 8개 미만 | 2 | A-15, E-11 |");
    expect(table).toContain("정상(사유 없음) 1곳 / 전체 5곳");
  });
});
