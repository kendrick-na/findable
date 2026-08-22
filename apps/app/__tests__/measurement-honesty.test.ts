/**
 * "잰 것만 말한다" 회귀 테스트 (2026-08-10 세션N-14).
 *
 * 🔴 **왜 필요한가 — 라이브 화면 실측에서 발견한 결함**
 *   `apple.com` 진단은 엔진 **28개가 전부 실패**했는데 `status=completed` 로 저장돼
 *   고객 화면에 이렇게 나가고 있었다:
 *
 *     "우리를 아는 AI  0/0" · "측정한 AI 0개 중 0개가 애플를 알고 있습니다"
 *     그런데 바로 아래 → **"놓치는 유입 800 세션 / 월"**
 *
 *   **아무것도 측정하지 못했는데 사업 손실을 숫자로 단언**하고 있었다.
 *   못 잰 것을 "0점"이라 부른 것 = 체온계가 안 켜졌는데 "체온 0도"라고 적은 것.
 *   실측 해당: 성공 0건 **7건**(nike·apple·innisfree·tonymoly·themedicube·medicube×2).
 *
 * 🔴 **원인**: `sov = 0` 이 두 가지를 구분하지 못한다.
 *     ① AI 가 정말 우리를 모른다(= 진짜 발견, 보여줘야 한다)
 *     ② 측정이 전멸했다(= 아무 정보 없음, 말할 수 있는 게 없다)
 *
 * ⚠️ **임계값("40% 미만이면 경고")을 두지 않는다.** 그런 경계선은 근거가 없고,
 *   근거 없는 숫자를 코드에 박는 건 이 결함과 **같은 잘못**이다.
 *   판정은 **0인가 아닌가** 하나뿐이고, 나머지는 **분모를 밝히는 것**으로 해결한다.
 *
 * @vitest-environment node
 */

import {
  countMeasurementCoverage,
  isMeasurementFailure,
} from "@repo/audit/measurement-coverage";
import { describe, expect, it } from "vitest";

// ⚠️ 규칙을 여기 복제하지 않는다 — **화면과 같은 모듈을 그대로 import** 한다.
//   복제하면 조용히 갈라져서 "테스트는 통과하는데 화면은 틀린" 상태가 된다.
const countMeasured = countMeasurementCoverage;

const ok = (engineId: string) => ({
  engineId,
  errorMessage: null,
  isStub: false,
});
const failed = (engineId: string, msg = "Unauthorized") => ({
  engineId,
  errorMessage: msg,
  isStub: false,
});
const stub = (engineId: string) => ({
  engineId,
  errorMessage: null,
  isStub: true,
});

describe("측정 성공 집계 — 못 잰 걸 0점이라 부르지 않는다", () => {
  it("🔴 전부 실패하면 measured=0 (→ 화면은 점수·손실을 숨긴다)", () => {
    // apple.com 실측 재현: 물어본 엔진은 있는데 성공이 하나도 없다.
    const responses = [
      failed("chatgpt"),
      failed("claude"),
      failed("perplexity"),
      failed("gemini"),
    ];
    const { measured, attempted } = countMeasured(responses);
    expect(measured).toBe(0);
    expect(attempted).toBe(4);
  });

  it("🔴 스텁(미연결)도 '측정 성공'으로 세지 않는다", () => {
    // 스텁은 API 키가 없어 가짜 응답을 만든 것 — 잰 게 아니다.
    const { measured, attempted } = countMeasured([
      stub("naver"),
      stub("daum"),
      stub("hyperclova"),
    ]);
    expect(measured).toBe(0);
    expect(attempted).toBe(3);
  });

  it("🔴 '측정 전멸'과 '진짜 0점'은 다르다 — 후자는 결과를 보여줘야 한다", () => {
    // AI 가 응답은 했는데 우리 브랜드를 언급 안 한 경우 = 진짜 발견.
    //   measured > 0 이므로 화면은 정상적으로 결과를 보여준다.
    const { measured, attempted } = countMeasured([
      ok("chatgpt"),
      ok("claude"),
    ]);
    expect(measured).toBe(2);
    expect(attempted).toBe(2);
    expect(measured > 0).toBe(true);
  });

  it("일부만 성공하면 분모가 그대로 드러난다 (임계값 없음)", () => {
    const { measured, attempted } = countMeasured([
      ok("chatgpt"),
      ok("claude"),
      failed("perplexity"),
      failed("gemini"),
      stub("naver"),
    ]);
    expect(measured).toBe(2);
    expect(attempted).toBe(5);
    // ⚠️ 여기서 "2/5 는 믿을 만한가"를 코드가 판단하지 않는다 — 밝히기만 한다.
    expect(measured < attempted).toBe(true);
  });

  it("🔴 같은 엔진이 여러 프롬프트로 중복돼도 엔진 수로 센다", () => {
    // 실측: 엔진 7개 × 프롬프트 4개 = 28행. 행 수를 세면 분모가 뻥튀기된다.
    const { measured, attempted } = countMeasured([
      ok("chatgpt"),
      ok("chatgpt"),
      ok("chatgpt"),
      failed("claude"),
      failed("claude"),
    ]);
    expect(attempted).toBe(2);
    expect(measured).toBe(1);
  });

  it("🔴 한 프롬프트만 성공해도 그 엔진은 '측정됨'이다 (과소 차단 방지)", () => {
    // 같은 엔진이 4번 중 1번만 성공한 경우 — 근거가 있으므로 결과를 숨기면 안 된다.
    const { measured } = countMeasured([
      failed("chatgpt"),
      failed("chatgpt"),
      failed("chatgpt"),
      ok("chatgpt"),
    ]);
    expect(measured).toBe(1);
  });

  it("응답이 아예 없으면 attempted=0 (측정 실패 화면을 띄우지 않는다)", () => {
    // attempted 가 0이면 "물어보지도 않은" 상태라 별도 처리(기존 빈 결과 화면).
    const { measured, attempted } = countMeasured([]);
    expect(measured).toBe(0);
    expect(attempted).toBe(0);
  });
});

describe("isMeasurementFailure — 화면이 실제로 쓰는 판정", () => {
  it("🔴 전멸 회차만 '측정 실패'다", () => {
    expect(
      isMeasurementFailure(
        countMeasured([failed("chatgpt"), failed("claude"), stub("naver")])
      )
    ).toBe(true);
  });

  it("한 곳이라도 성공하면 실패가 아니다 (결과를 보여준다)", () => {
    expect(
      isMeasurementFailure(countMeasured([failed("chatgpt"), ok("claude")]))
    ).toBe(false);
  });

  it("🔴 빈 배열은 실패로 가로채지 않는다 (기존 빈 결과 화면 담당)", () => {
    // 여기서 true 를 주면 "물어보지도 않은" 회차까지 측정실패 화면이 뜬다.
    expect(isMeasurementFailure(countMeasured([]))).toBe(false);
  });

  it("null·undefined 도 안전하다 (저장 JSON 이라 보장이 없다)", () => {
    expect(isMeasurementFailure(countMeasured(null))).toBe(false);
    expect(isMeasurementFailure(countMeasured(undefined))).toBe(false);
  });
});
