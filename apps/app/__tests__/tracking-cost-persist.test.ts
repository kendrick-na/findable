/**
 * 🔴🔴 **측정 1건 원가를 몰랐다 — 요금제 설계의 분모가 비어 있었다** (N-47 · 2026-08-20).
 *
 * 👤 가 *"그라운딩을 켜면 비용이 얼마나 오르나"* 를 물었는데 **답할 방법이 없었다**:
 *
 *   · `packages/ai/lib/engines/cost.ts` — 잘 만들어져 있는데 **프로덕션 호출 0곳**
 *   · 토큰 수를 **어디에도 저장하지 않음** → 나중에 되돌아와 계산할 수도 없다
 *
 * 📕 N-46 *"이미 있는 걸 안 쓰고 있을 수 있다"* 와 **완전히 같은 유형**이다
 *   (`stripMarkdown`·`User.organizationId` 에 이어 세 번째). 신설이 아니라 **배선**이 답이었다.
 *
 * ## 이 테스트가 지키는 것
 * ① 적재 경로가 `costOf` 를 **실제로 부른다**(안 부르면 다시 죽은 코드가 된다)
 * ② **산출값과 원재료를 같이** 남긴다 — 단가가 바뀌어도 토큰만 있으면 재계산된다
 * ③ usage 없는 엔진은 **null** 이다 — 📕 *"못 잰 것을 0이라 부르지 않기"*
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { costOf } from "@repo/ai/lib/engines";
import { describe, expect, it } from "vitest";

const TRACKING = readFileSync(
  join(process.cwd(), "../../packages/audit/tracking.ts"),
  "utf8"
);
const SCHEMA = readFileSync(
  join(process.cwd(), "../../packages/database/prisma/schema.prisma"),
  "utf8"
);

/** 주석을 세면 가드가 자기 문서를 보고 통과한다 — 이번 세션에만 3번 당했다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(TRACKING);

/** 최소 EngineResponse — 원가 계산에 필요한 필드만 채운다. */
function response(over: Record<string, unknown> = {}) {
  return {
    engineId: "chatgpt",
    rawResponse: "…",
    brandMentioned: true,
    mentionPosition: null,
    mentionListSize: null,
    sentiment: null,
    citedSources: [],
    shareOfVoice: null,
    errorMessage: null,
    durationMs: 1000,
    // ⚠️ `isStub` 를 빼면 타입이 안 맞는다(tsc 가 잡았다) — 실제 응답에 항상 있는 필드다.
    isStub: false,
    usage: {
      costModel: "token" as const,
      inputTokens: 1000,
      outputTokens: 500,
    },
    ...over,
  } as Parameters<typeof costOf>[0];
}

describe("원가 계기 — 배선", () => {
  it("🔴 적재 경로가 `costOf` 를 **실제로 부른다**", () => {
    // 이게 없으면 cost.ts 는 또 「있지만 안 쓰는 함수」로 돌아간다.
    expect(CODE).toMatch(/costOf\(/);
    expect(CODE).toMatch(/import \{[^}]*costOf/);
  });

  it("🔴 **산출값과 원재료를 같이** 남긴다 (단가는 추정이라 바뀐다)", () => {
    // 단가가 틀렸다고 나중에 밝혀져도 토큰 수만 있으면 **전량 재계산**이 된다.
    // 결과값만 저장하면 그때 소급이 불가능하다.
    for (const field of [
      "costKrw",
      "costBasis",
      "inputTokens",
      "outputTokens",
    ]) {
      expect(CODE, `${field} 를 적재하지 않는다`).toContain(`${field}:`);
    }
  });

  it("🔴 스키마가 **전부 nullable** 이다 (기존 382행을 깨지 않는다)", () => {
    const block = SCHEMA.slice(
      SCHEMA.indexOf("model Tracking"),
      SCHEMA.indexOf("model", SCHEMA.indexOf("model Tracking") + 10)
    );
    // `Int?` `Float?` `String?` — `?` 가 빠지면 마이그레이션이 기존 행에서 실패한다.
    expect(block).toMatch(/inputTokens\s+Int\?/);
    expect(block).toMatch(/outputTokens\s+Int\?/);
    expect(block).toMatch(/costKrw\s+Float\?/);
    expect(block).toMatch(/costBasis\s+String\?/);
  });
});

describe("원가 계산 — 「못 잼」과 「0원」을 가른다", () => {
  it("✅ 토큰이 있으면 원가가 **0보다 크다**", () => {
    const cost = costOf(response());
    expect(cost.basis).toBe("token");
    expect(cost.krw).toBeGreaterThan(0);
  });

  it("🔴 토큰을 **못 잰** 회차는 `unknown` 이다 — 0원이 아니다", () => {
    // 📕 이 저장소 최다 사고: 못 잰 것을 0이라 부르기.
    // basis 가 `unknown` 이면 집계에서 **분모에서 빼야 한다**(0원으로 더하면 안 된다).
    const cost = costOf(
      response({
        usage: { costModel: "token", inputTokens: null, outputTokens: null },
      })
    );
    expect(cost.basis).toBe("unknown");
  });

  it("✅ stub·실패 호출은 **진짜 0원** 이다 (실제로 안 불렀다)", () => {
    expect(costOf(response({ isStub: true })).krw).toBe(0);
    expect(costOf(response({ errorMessage: "timeout" })).krw).toBe(0);
  });

  it("⭐ gemini 는 무료 티어라 0원 — 그라운딩 비용 판단의 핵심 근거", () => {
    // Google AI Studio 하루 1,500회 무료(`global-adapters.ts:67`).
    // 👤 의 "비용이 얼마나 오르나" 질문에서 gemini 가 무료면 위험이 크게 준다.
    // ⚠️ 단, 그라운딩(googleSearch)은 **별도 과금일 수 있다** — 청구서로 확인 전엔 단정 금지.
    const cost = costOf(response({ engineId: "gemini", usage: undefined }));
    expect(cost.basis).toBe("free");
    expect(cost.krw).toBe(0);
  });
});
