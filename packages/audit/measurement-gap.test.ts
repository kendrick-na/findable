import { describe, expect, it } from "vitest";
import {
  buildGapPreflight,
  checkQuestionInvariant,
  classifyFailureMessage,
  classifyGaps,
  ensureReasonCodes,
  finalizeGapDiagnostics,
  formatUnmeasuredTable,
  GAP_ACTION_KO,
  GAP_LABEL_KO,
  type GapCode,
  isMeasurementGapLogEnabled,
  MIN_HEALTHY_QUESTION_COUNT,
  questionSetWarnings,
  unmeasurableMessage,
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
      "cert_host_mismatch"
    );
  });
  it("인증서 오류 원인 세분: 호스트 불일치·만료·자체 서명·체인 오류·그 밖(기록 전용)", () => {
    const withCode = (code: string, message = "fetch failed") =>
      classifySiteReadError(
        new Error("fetch failed", {
          cause: Object.assign(new Error(message), { code }),
        })
      );
    expect(withCode("ERR_TLS_CERT_ALTNAME_INVALID")).toBe("cert_host_mismatch");
    expect(withCode("CERT_HAS_EXPIRED", "certificate has expired")).toBe(
      "cert_expired"
    );
    expect(
      withCode("DEPTH_ZERO_SELF_SIGNED_CERT", "self signed certificate")
    ).toBe("cert_self_signed");
    expect(
      withCode(
        "SELF_SIGNED_CERT_IN_CHAIN",
        "self-signed certificate in certificate chain"
      )
    ).toBe("cert_self_signed");
    expect(
      withCode(
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "unable to verify the first certificate"
      )
    ).toBe("cert_chain_error");
    expect(withCode("ERR_SSL_PROTOCOL_ERROR", "ssl protocol error")).toBe(
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

describe("시작 불변식 · 사유 없는 실패 금지(2026-10-19)", () => {
  const OUTCOMES = [
    undefined,
    "ok",
    "robots_blocked",
    "certificate_error",
    "timeout",
    "not_html",
    "fetch_failed",
    "render_needed",
    "thin_after_render",
    "cert_host_mismatch",
    "cert_expired",
    "cert_self_signed",
    "cert_chain_error",
    "image_text_used",
    "image_text_failed",
  ] as const;

  it("질문 수·이름 질문 수 전 구간: 불변식 위반이면 사유 코드가 반드시 1개 이상, 통과면 코드 없음", () => {
    for (let q = 0; q <= 20; q++) {
      for (let b = 0; b <= q; b++) {
        const verdict = checkQuestionInvariant({
          brandQuestionCount: b,
          questionCount: q,
        });
        const shouldPass = q >= 8 && b >= 2;
        expect(verdict.ok).toBe(shouldPass);
        if (!verdict.ok) {
          expect(verdict.codes.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("측정이 안 된 모든 조합(사이트 결과 × 질문 수 × 엔진 전멸)에서 사유 코드가 비지 않는다", () => {
    for (const siteOutcome of OUTCOMES) {
      for (const q of [0, 3, 8, 12]) {
        for (const b of [0, 1, 2, 4]) {
          for (const measured of [0, 3]) {
            const input = {
              brandQuestionCount: Math.min(b, q),
              engine: { attempted: 4, measured },
              questionCount: q,
              siteOutcome,
            };
            const unmeasured =
              !checkQuestionInvariant(input).ok ||
              measured === 0 ||
              (siteOutcome !== undefined && siteOutcome !== "ok");
            const codes = classifyGaps(input);
            if (unmeasured) {
              expect(ensureReasonCodes(codes).length).toBeGreaterThan(0);
            }
            for (const c of codes) {
              expect(GAP_LABEL_KO[c]).toBeTruthy();
              expect(GAP_ACTION_KO[c]).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it("측정 불가 메시지는 머리표+코드이고, 읽으면 같은 코드가 나온다", () => {
    const message = unmeasurableMessage(["few_questions", "no_brand_question"]);
    expect(message).toBe("UNMEASURABLE:few_questions,no_brand_question");
    expect(classifyFailureMessage(message)).toEqual([
      "few_questions",
      "no_brand_question",
    ]);
    expect(unmeasurableMessage([])).toBe("UNMEASURABLE:unclassified");
  });

  it("어떤 실패 메시지도 코드 1개 이상(마지막 보증)", () => {
    const samples = [
      "Audit run has no prompts",
      "prepare_error:boom",
      "HTTP 500",
      "",
      null,
      undefined,
      "UNMEASURABLE:알수없음",
    ];
    for (const m of samples) {
      const codes: GapCode[] = classifyFailureMessage(m);
      expect(codes.length).toBeGreaterThan(0);
    }
    expect(classifyFailureMessage("Audit run has no prompts")).toEqual([
      "zero_questions",
    ]);
  });
});
