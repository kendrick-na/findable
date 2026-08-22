/**
 * 관리자 진단 목록 건수 문구 (세션N-27).
 *
 * 🔴 **막는 사고**: 목록이 `take: PAGE_SIZE` 로 잘리는데 화면이 아무 말도 안 하면,
 *   운영자는 **"전체가 이것뿐"** 이라고 믿는다. 실제로는 51번째부터 안 보이는 것이다.
 *   `/history` 가 정확히 같은 사고를 겪고 `historyCountLabel` 로 고쳤다(S7-4차).
 *
 * ⚠️ 순수 함수 테스트라 jsdom 도크블록이 필요 없다(DOM 을 안 쓴다).
 */
import { describe, expect, it } from "vitest";
import { adminAuditsCountLabel } from "../app/(authenticated)/lib/admin-audits-label";

const PAGE_SIZE = 50;

describe("adminAuditsCountLabel", () => {
  it("0건이면 건수를 말하지 않는다", () => {
    expect(adminAuditsCountLabel(0, PAGE_SIZE)).toBe(
      "아직 생성된 진단이 없어요."
    );
  });

  it("음수(비정상 입력)도 0건과 같이 처리한다", () => {
    expect(adminAuditsCountLabel(-1, PAGE_SIZE)).toBe(
      "아직 생성된 진단이 없어요."
    );
  });

  it("상한 이하면 잘림 안내를 붙이지 않는다", () => {
    expect(adminAuditsCountLabel(1, PAGE_SIZE)).toBe("전체 1건.");
    expect(adminAuditsCountLabel(50, PAGE_SIZE)).toBe("전체 50건.");
  });

  it("🔴 상한을 넘으면 반드시 '일부만 보여준다'고 밝힌다", () => {
    expect(adminAuditsCountLabel(51, PAGE_SIZE)).toBe(
      "전체 51건. 최근 50건만 보여드려요."
    );
    expect(adminAuditsCountLabel(83, PAGE_SIZE)).toBe(
      "전체 83건. 최근 50건만 보여드려요."
    );
  });

  it("경계값 50↔51 에서 문구가 갈린다 (off-by-one 고정)", () => {
    expect(adminAuditsCountLabel(50, PAGE_SIZE)).not.toContain("최근");
    expect(adminAuditsCountLabel(51, PAGE_SIZE)).toContain("최근");
  });
});
