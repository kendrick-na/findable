/**
 * 🔬 **순위 구간 액션(`rank_strategy`) 가드** — N-46 → 2026-10-03 AG-0 개정.
 *
 * 예전 계약: 순위 구간마다 논문 Table 2 수치(Rank1 −30.3% · Rank2 +2.5% · Rank5 +115.1%)로
 *   「방어하라 / 효과 작다 / 지금 최적화하라」를 냈다.
 * 🔴 그 계약 자체가 오류였다. 논문의 Rank 는 검색결과(SERP)에 나온 **출처 웹사이트의
 *   위치**이고, 우리 입력은 AI 답변 속 **브랜드 언급 위치**다. 변수가 달라 수치를
 *   옮겨 쓸 근거가 없다(GEO_Findable_Research_20261003 Finding 7).
 * → 새 계약: 어떤 순위·목록 크기에서도 순위별 효과 카드를 만들지 않는다.
 *   올바른 입력 지표와 현 엔진 재현 실험이 생기면 이 테스트부터 다시 쓴다.
 */

import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

type Input = Parameters<typeof buildGeoActions>[0];

/** 순위 외 조건은 고정 — 순위만 움직여 그 축의 영향만 본다. */
const base: Input = {
  averageMentionPosition: 3,
  brandName: "설화수",
  enginesMeasured: 7,
  enginesMentioned: 7,
  prompts: [{ hit: 7, text: "설화수 추천해줘", total: 7 }],
  sourceMix: { community: 40, media: 10, other: 5, owned: 2, reference: 3 },
  topDomains: [
    { count: 40, domain: "blog.naver.com", owned: false },
    { count: 2, domain: "sulwhasoo.com", owned: true },
  ],
};

describe("순위 구간 액션 — 논문 SERP 순위 수치를 브랜드 순위에 쓰지 않는다", () => {
  it("🔴 어떤 평균 언급 위치에서도 rank_strategy 를 만들지 않는다", () => {
    for (const pos of [null, 0, 1, 1.5, 1.6, 2, 2.5, 2.6, 4.5, 4.6, 8, 20]) {
      for (const size of [undefined, null, 2, 3, 10]) {
        const actions = buildGeoActions({
          ...base,
          averageMentionListSize: size,
          averageMentionPosition: pos,
        });
        expect(
          actions.some((a) => a.kind === "rank_strategy"),
          `순위 ${pos}·목록 ${size} 에서 순위 카드가 나왔다`
        ).toBe(false);
      }
    }
  });

  it("⛔ 순위가 바뀌어도 처방 구성이 바뀌지 않는다 — 순위로 다른 카드를 숨기지 않는다", () => {
    const kinds = (pos: number | null) =>
      buildGeoActions({ ...base, averageMentionPosition: pos })
        .map((a) => a.kind)
        .join(",");
    expect(kinds(1)).toBe(kinds(8));
    expect(kinds(1)).toBe(kinds(null));
  });
});
