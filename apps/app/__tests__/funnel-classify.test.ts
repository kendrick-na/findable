/*
 * 진단 제출 판정 분류 테스트 — 2026-08-12 세션N-25.
 *
 * 🔴 **막는 사고**: 퍼널 숫자가 **조용히 거짓말**을 하는 것.
 *   분류가 틀려도 이벤트는 정상적으로 쌓이므로 아무 에러가 나지 않는다.
 *   그런데 그 숫자를 근거로 *"어디서 새는가"* 를 판단하게 되므로, 틀린 분류는
 *   **틀린 의사결정**으로 직결된다. 이 프로젝트 규칙: *틀린 숫자 절대 금지.*
 *
 * ⚠️ 왜 순수 함수로 뺐나: 이 분류는 원래 폼(`audit-form.tsx`)의 fetch 핸들러 안에서
 *   일어나는데, 폼을 돌리려면 브라우저가 필요하다 → **검증할 방법이 없다.**
 *   프로젝트 규칙 그대로: *"라이브에서 확인 못 하는 경로는 순수 함수로 빼서 테스트로 고정."*
 *
 * 🔴 **구조로 판정한다**(문구 파싱 금지) — 서버 에러 문구를 다듬는 순간
 *   문자열 기반 분류는 조용히 깨진다.
 *
 * @vitest-environment node
 */

import { classifySubmit, shouldOfferContact } from "@repo/analytics/funnel";
import { describe, expect, test } from "vitest";

describe("classifySubmit — 성공 계열", () => {
  test("200 + cached 없음 → accepted(실제 새 측정)", () => {
    expect(classifySubmit(200, {})).toBe("accepted");
  });

  test("🔴 200 + cached → cached — accepted 와 **합치지 않는다**", () => {
    // 캐시 히트는 고객에겐 성공으로 보이지만 **새 측정이 아니다**(원가 0).
    // 합치면 *"실제로 몇 건을 측정했나"* 를 물을 수 없고 원가 추정도 틀린다.
    expect(classifySubmit(200, { cached: true })).toBe("cached");
  });

  test("2xx 경계(201·299)도 성공으로 본다", () => {
    expect(classifySubmit(201, {})).toBe("accepted");
    expect(classifySubmit(299, {})).toBe("accepted");
  });
});

describe("classifySubmit — 거절 계열(우리가 막은 것)", () => {
  test("429 + budgetExhausted → budget(우리 사정으로 거절)", () => {
    expect(classifySubmit(429, { budgetExhausted: true })).toBe("budget");
  });

  test("⭐ 429 + ipQuotaExceeded → ip_capped — 대행사 ICP 이탈 지점", () => {
    // 이 값이 쌓이면 *"IP 상한 2건이 실제로 지불의사 높은 고객을 막고 있나"* 를
    // 숫자로 답할 수 있다(#16 판단 근거).
    expect(classifySubmit(429, { ipQuotaExceeded: true })).toBe("ip_capped");
  });

  test("429 + existingJobId(24h 재요청) → cached — 고객은 기존 결과로 이어진다", () => {
    expect(classifySubmit(429, { existingJobId: "abc123" })).toBe("cached");
  });

  test("403 → bot(BotID 차단)", () => {
    expect(classifySubmit(403, {})).toBe("bot");
  });

  test("400 → invalid(입력 검증 실패)", () => {
    expect(classifySubmit(400, {})).toBe("invalid");
  });

  test("알 수 없는 5xx 는 invalid 로 떨어진다 — 조용히 성공으로 세지 않는다", () => {
    // 🔴 실패를 성공으로 세는 것이 최악이다(퍼널이 부풀려진다).
    expect(classifySubmit(500, {})).toBe("invalid");
  });
});

describe("classifySubmit — 우선순위(플래그가 겹칠 때)", () => {
  test("성공 상태면 에러 플래그를 무시한다", () => {
    // 200 인데 budgetExhausted 가 섞여 오는 건 서버 버그지만, 그때도
    // **고객은 결과를 받았다** → 성공으로 센다.
    expect(classifySubmit(200, { budgetExhausted: true })).toBe("accepted");
  });

  test("budget 이 ip_capped 보다 앞선다 — 둘이 겹치면 전역 원인이 먼저다", () => {
    expect(
      classifySubmit(429, { budgetExhausted: true, ipQuotaExceeded: true })
    ).toBe("budget");
  });
});

/*
 * 2026-08-12 세션N-26 — **"문의해 주세요"라고 말해 놓고 클릭할 데가 없던 것** 수정.
 *
 * 🔴 막는 사고: 서버 429 문구가 문의를 권하는데 화면에 링크가 없어서
 *   **고의도 리드(대행사·에이전시)가 막다른 길에서 그대로 이탈**하는 것.
 * ⚠️ 가드는 **양방향**이다 — "띄운다"만 검사하면 전부 true 를 반환해도 통과한다.
 */
describe("shouldOfferContact — 429 문구가 약속한 링크를 실제로 준다", () => {
  test("budget(전역 예산 소진) → 문의 링크를 준다", () => {
    // 우리 사정으로 거절한 것이라 고객이 스스로 고칠 방법이 없다.
    expect(shouldOfferContact("budget")).toBe(true);
  });

  test("⭐ ip_capped → 문의 링크를 준다 — 대행사 ICP 가 여기서 사라졌다", () => {
    expect(shouldOfferContact("ip_capped")).toBe(true);
  });

  test("🔴 invalid 에는 띄우지 않는다 — 오타는 고객이 고칠 수 있다", () => {
    // 고칠 수 있는 문제에 문의를 권하면 소음이고, 문의함만 오염된다.
    expect(shouldOfferContact("invalid")).toBe(false);
  });

  test("🔴 bot 에는 띄우지 않는다 — 봇에게 문의 경로를 줄 이유가 없다", () => {
    expect(shouldOfferContact("bot")).toBe(false);
  });

  test("성공 계열(accepted·cached)에는 띄우지 않는다", () => {
    // 🔴 전부 true 를 반환하는 구현이 위 테스트만으로는 통과한다 — 이 줄이 막는다.
    expect(shouldOfferContact("accepted")).toBe(false);
    expect(shouldOfferContact("cached")).toBe(false);
  });

  test("서버 429 두 자리가 내는 판정이 **둘 다** 링크로 이어진다", () => {
    // route.ts 의 429 는 budgetExhausted / ipQuotaExceeded 두 갈래뿐이다.
    // 분류→노출을 이어서 검사한다(중간에서 끊기면 여기서 잡힌다).
    expect(
      shouldOfferContact(classifySubmit(429, { budgetExhausted: true }))
    ).toBe(true);
    expect(
      shouldOfferContact(classifySubmit(429, { ipQuotaExceeded: true }))
    ).toBe(true);
  });

  test("24h 재요청(429·existingJobId)은 기존 결과로 이어진다 → 문의 아님", () => {
    expect(
      shouldOfferContact(classifySubmit(429, { existingJobId: "abc123" }))
    ).toBe(false);
  });
});
