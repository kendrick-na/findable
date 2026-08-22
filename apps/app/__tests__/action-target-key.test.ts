/**
 * 액션 완료 대상 키 회귀 테스트 (2026-08-10 세션N-13).
 *
 * 여기서 지키는 것 = **"같은 액션은 어느 화면에서 눌러도 같은 한 건"**.
 *
 * 🔴 왜 중요한가: `ActionCompletion` 은 `@@unique([brandId, kind, target])` 이라
 *   이 키가 곧 액션의 정체성이다. 규칙이 화면마다 갈라지면
 *     · 추적 경로에서 완료한 액션이 무료 진단 화면에선 **미완료로 보이고**
 *     · 같은 액션이 **두 건 기록**되거나
 *     · 완료 표시가 **엉뚱한 액션에 붙는다**.
 *   실제로 이 규칙은 세션N-13 직전까지 **두 화면에 복제**돼 있었다.
 *
 * 🔗 이 키가 안정적이어야 `ActionCompletion` 이 쌓이고, 그래야
 *   before/after(진단→조치→재측정)를 데이터로 증명할 수 있다.
 *
 * ⚠️ app 에 두는 이유: 이 저장소에서 vitest 가 설정된 곳이 `apps/app` 뿐이다
 *   (`packages/audit` 엔 vitest 미설치 — 새 의존성 추가는 별건).
 *
 * @vitest-environment node
 */

import { type ActionKind, actionTargetKey } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

describe("actionTargetKey", () => {
  it("prompt_gap 은 제목으로 구분한다 — 질문마다 별개의 액션이다", () => {
    expect(
      actionTargetKey({
        kind: "prompt_gap",
        title: "'수분크림 추천' 질문에서 안 나옵니다",
      })
    ).toBe("'수분크림 추천' 질문에서 안 나옵니다");
  });

  it("🔴 서로 다른 질문은 서로 다른 키가 된다 (뭉치면 완료가 덮어써진다)", () => {
    const a = actionTargetKey({ kind: "prompt_gap", title: "질문 A" });
    const b = actionTargetKey({ kind: "prompt_gap", title: "질문 B" });
    expect(a).not.toBe(b);
  });

  it("나머지 종류는 브랜드당 1건이라 빈 문자열", () => {
    const kinds: ActionKind[] = [
      "content_fix",
      "source_portfolio",
      "rank_strategy",
      "avoid",
    ];
    for (const kind of kinds) {
      expect(actionTargetKey({ kind, title: "제목이 무엇이든" })).toBe("");
    }
  });

  it("🔴 같은 종류·같은 제목이면 항상 같은 키 (멱등 — 두 화면이 같은 값을 낸다)", () => {
    const action = { kind: "prompt_gap" as const, title: "동일 질문" };
    expect(actionTargetKey(action)).toBe(actionTargetKey({ ...action }));
  });

  it("🔴 제목이 같아도 종류가 다르면 다른 키 (content_fix 는 제목을 안 쓴다)", () => {
    const title = "같은 제목";
    expect(actionTargetKey({ kind: "prompt_gap", title })).not.toBe(
      actionTargetKey({ kind: "content_fix", title })
    );
  });
});
