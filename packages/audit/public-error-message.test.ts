import { describe, expect, it } from "vitest";
import { answerReason } from "./answer-buckets";
import {
  classifyPublicError,
  publicErrorMessage,
  sanitizeResultErrorsForCustomer,
} from "./public-error-message";

const ON = { STABILITY_ERROR_SANITIZE_ENABLED: "1" };
const OFF = {};

// 분류 표: 공급자 오류 샘플 → 분류
const CLASSIFICATION_TABLE: [string, ReturnType<typeof classifyPublicError>][] =
  [
    ["Engine chatgpt timed out after 60000ms", "timeout"],
    ["Request timed out", "timeout"],
    ["ETIMEDOUT 10.0.3.7:443", "timeout"],
    [
      "QUEUE_START_TIMEOUT: 측정 실행이 시작되지 않아 자동 종료했습니다. 다시 측정해 주세요.",
      "timeout",
    ],
    ["stuck-swept: 백그라운드 처리가 시간 내 완료되지 않았습니다.", "timeout"],
    ["429 Too Many Requests", "rate_limit"],
    [
      "OpenAI: Rate limit reached for gpt-x in organization org-AbC123",
      "rate_limit",
    ],
    ["usage_limit_reached", "rate_limit"],
    [
      "You exceeded your current quota, please check your plan and billing details",
      "quota",
    ],
    ["credit balance is too low", "quota"],
    ["ECONNREFUSED 127.0.0.1:5432", "connection"],
    ["fetch failed", "connection"],
    ["getaddrinfo ENOTFOUND internal-llm.corp.local", "connection"],
    ["검색 결과 없음", "empty"],
    ["Empty response from provider", "empty"],
    ["Unexpected token < in JSON at position 0", "general"],
    ["late_cell_pending", "general"],
    ["", "general"],
  ];

describe("classifyPublicError", () => {
  it.each(CLASSIFICATION_TABLE)("%s → %s", (raw, kind) => {
    expect(classifyPublicError(raw)).toBe(kind);
  });
  it("null·undefined 는 general", () => {
    expect(classifyPublicError(null)).toBe("general");
    expect(classifyPublicError(undefined)).toBe("general");
  });
});

describe("publicErrorMessage — 꺼짐 동일성", () => {
  it("꺼짐이면 어떤 입력이든 그대로(null·undefined·빈 문자열 포함)", () => {
    for (const [raw] of CLASSIFICATION_TABLE) {
      expect(publicErrorMessage(raw, true, { env: OFF })).toBe(raw);
      expect(publicErrorMessage(raw, false, { env: OFF })).toBe(raw);
    }
    expect(publicErrorMessage(null, true, { env: OFF })).toBeNull();
    expect(publicErrorMessage(undefined, true, { env: OFF })).toBeUndefined();
  });
  it("꺼짐 값(0·false·빈 값)도 꺼짐", () => {
    for (const value of ["", "0", "false", "no"]) {
      expect(
        publicErrorMessage("secret host 10.0.0.1", true, {
          env: { STABILITY_ERROR_SANITIZE_ENABLED: value },
        })
      ).toBe("secret host 10.0.0.1");
    }
  });
  it("sanitizeResultErrorsForCustomer 꺼짐은 같은 참조", () => {
    const result = {
      engineResponses: [{ engineId: "x", errorMessage: "boom 10.0.0.1" }],
    };
    expect(sanitizeResultErrorsForCustomer(result, true, OFF)).toBe(result);
  });
});

describe("publicErrorMessage — 켜짐", () => {
  it("분류별로 기존 사전 문장만 나온다(한국어)", () => {
    expect(
      publicErrorMessage("Engine a timed out after 1ms", true, { env: ON })
    ).toBe(answerReason({ engineId: "a", errorMessage: "timeout" }, true));
    expect(publicErrorMessage("429 Too Many Requests", true, { env: ON })).toBe(
      "요청이 몰려 거절됨(429)"
    );
    expect(publicErrorMessage("insufficient_quota", true, { env: ON })).toBe(
      "AI 서비스 사용 한도 초과"
    );
    expect(publicErrorMessage("ECONNREFUSED", true, { env: ON })).toBe(
      "AI 서비스 응답 오류"
    );
    expect(publicErrorMessage("???", true, { env: ON })).toBe(
      "AI 서비스 응답 오류"
    );
  });
  it("영어 문장", () => {
    expect(publicErrorMessage("429", false, { env: ON })).toBe(
      "Rate limited (429)"
    );
    expect(publicErrorMessage("boom", false, { env: ON })).toBe(
      "AI service error"
    );
  });
  it("일반 실패는 호출부가 준 기존 문장을 쓴다", () => {
    expect(
      publicErrorMessage("boom", true, {
        env: ON,
        generalFallback: "기존 안내문",
      })
    ).toBe("기존 안내문");
    // 분류가 되는 것은 fallback 이 아니라 분류 문장
    expect(
      publicErrorMessage("timed out", true, {
        env: ON,
        generalFallback: "기존 안내문",
      })
    ).toBe("응답 시간 초과");
  });
  it("비어 있는 입력은 그대로", () => {
    expect(publicErrorMessage(null, true, { env: ON })).toBeNull();
    expect(publicErrorMessage("", true, { env: ON })).toBe("");
  });
  it("결과 문장은 화면의 기존 사유 판정이 같은 분류로 다시 읽는다(왕복)", () => {
    for (const raw of ["timed out", "429", "quota exceeded", "boom"]) {
      const ko = publicErrorMessage(raw, true, { env: ON });
      const en = publicErrorMessage(raw, false, { env: ON });
      expect(answerReason({ engineId: "x", errorMessage: ko }, true)).toBe(ko);
      expect(answerReason({ engineId: "x", errorMessage: en }, false)).toBe(en);
    }
  });
});

// 속성 테스트처럼: 민감한 조각을 여러 모양의 원문에 섞어도 고객 표시에는 절대 안 나온다.
const SENSITIVE = [
  "10.0.3.7",
  "127.0.0.1:5432",
  "internal-llm.corp.local",
  "api.internal.findable.co.kr",
  "sk-ant-api03-AbCdEf1234567890",
  "sk-proj-ZZZZ9999yyyy",
  "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
  "req_01H8XYZABCDEF",
  "x-request-id: 7f3a9c1e-2b44-4d1e-9a10-aaaaaaaaaaaa",
  "org-AbC123XyZ",
  "postgres://user:pa55w0rd@db.neon.tech/main",
  "/var/task/apps/app/.next/server/chunks/123.js:45:12",
];
const SHAPES = [
  (s: string) => `${s}`,
  (s: string) => `429 Too Many Requests ${s}`,
  (s: string) => `Engine chatgpt timed out after 60000ms (${s})`,
  (s: string) => `You exceeded your current quota ${s}`,
  (s: string) => `fetch failed: connect ECONNREFUSED ${s}`,
  (s: string) => `검색 결과 없음 ${s}`,
  (s: string) => `Error: ${s}\n    at fetch (node:internal/deps/undici:1)`,
  (s: string) => `{"error":{"message":"unknown","request_id":"${s}"}}`,
];

describe("민감 문자열은 고객 표시에 절대 포함되지 않는다(켜짐)", () => {
  it("모든 조합", () => {
    let checked = 0;
    for (const secret of SENSITIVE) {
      for (const shape of SHAPES) {
        for (const isKo of [true, false]) {
          const raw = shape(secret);
          const out = publicErrorMessage(raw, isKo, { env: ON });
          expect(out).not.toContain(secret);
          expect(out).not.toContain("request_id");
          expect(out).not.toContain("Error:");
          const sanitized = sanitizeResultErrorsForCustomer(
            {
              engineResponses: [{ engineId: "a", errorMessage: raw }],
              metrics: { errors: [{ engineId: "a", message: raw }] },
            },
            isKo,
            ON
          );
          expect(JSON.stringify(sanitized)).not.toContain(secret);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(SENSITIVE.length * SHAPES.length * 2);
  });
});

describe("sanitizeResultErrorsForCustomer — 켜짐", () => {
  it("엔진 칸 오류·metrics.errors 만 바꾸고 나머지·원본은 그대로", () => {
    const input = {
      brandName: "브랜드",
      engineResponses: [
        { engineId: "a", errorMessage: "boom 10.0.0.1", excerpt: "답" },
        { engineId: "b", errorMessage: null, excerpt: "정상" },
      ],
      metrics: { errors: [{ engineId: "a", message: "429" }], score: 3 },
    };
    const snapshot = JSON.stringify(input);
    const out = sanitizeResultErrorsForCustomer(
      input,
      true,
      ON
    ) as typeof input;
    expect(JSON.stringify(input)).toBe(snapshot); // 원본 불변
    expect(out.engineResponses[0].errorMessage).toBe("AI 서비스 응답 오류");
    expect(out.engineResponses[0].excerpt).toBe("답");
    expect(out.engineResponses[1]).toEqual(input.engineResponses[1]);
    expect(out.metrics.errors[0].message).toBe("요청이 몰려 거절됨(429)");
    expect(out.metrics.score).toBe(3);
    expect(out.brandName).toBe("브랜드");
  });
  it("객체가 아니면 그대로", () => {
    expect(sanitizeResultErrorsForCustomer(null, true, ON)).toBeNull();
    expect(sanitizeResultErrorsForCustomer("x", true, ON)).toBe("x");
  });
});
