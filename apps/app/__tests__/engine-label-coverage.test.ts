/**
 * 엔진 이름표 **전량 보유** 회귀 테스트 (2026-08-17 세션N-38).
 *
 * 🔴 **왜 필요한가**: `ENGINE_LABEL` 은 폴백이 `?? id` 라서, 빠진 엔진은 **터지지 않고
 *   영문 슬러그가 그대로 화면에 나간다**. 실제로 `naver-briefing`·`chatgpt-web` 두 칸이
 *   비어 있었고, 사용자 화면에 `naver-briefing` 이라고 렌더될 수 있었다.
 *   조용히 실패하는 종류라 **아무도 모른다** — 이 저장소가 반복해 온 유형.
 *
 * ⚠️ 이 테스트는 **문구를 검사하지 않는다**(이름은 언제든 다듬을 수 있다).
 *   검사하는 계약은 하나 — *"모든 실엔진이 id 와 다른 사람 이름을 갖는다"*.
 *
 * @vitest-environment node
 */

import { ENGINES } from "@repo/ai/lib/engines";
import { describe, expect, it } from "vitest";
import { engineLabel } from "../app/(authenticated)/features/analysis/sources-board";

describe("엔진 이름표 — 슬러그가 화면에 새지 않는다", () => {
  it("🔴 실엔진 전량이 id 아닌 사람 이름을 갖는다", () => {
    const missing = ENGINES.filter((e) => engineLabel(e.id) === e.id).map(
      (e) => e.id
    );
    // 빈 배열이 아니면 그 id 가 화면에 그대로 나간다는 뜻.
    expect(missing).toEqual([]);
  });

  it("과거에 비어 있던 두 칸이 메워져 있다", () => {
    // 회귀 지점을 명시적으로 못박는다(전량 검사가 통과해도 이 둘은 따로 확인).
    expect(engineLabel("naver-briefing")).not.toBe("naver-briefing");
    expect(engineLabel("chatgpt-web")).not.toBe("chatgpt-web");
  });

  it("모르는 엔진은 id 를 그대로 돌려준다 — 없는 이름을 지어내지 않는다", () => {
    expect(engineLabel("some-new-engine")).toBe("some-new-engine");
  });
});
