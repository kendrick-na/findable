/**
 * 처방 채널의 시장 적합성 회귀 테스트 — 2026-08-12 세션N-24.
 *
 * 🔴 **막는 사고**: 타깃 시장과 무관한 채널을 처방하는 것.
 *   예전엔 `"네이버 지식iN·관련 카페"` 가 **문자열로 박혀 있어서**, 해외 시장(global)
 *   브랜드에게도 *"네이버 지식iN에 답변하세요"* 가 그대로 나갔다.
 *   한국 서비스에 레딧을 권하는 것과 **정확히 같은 오류의 반대 방향**이다.
 *
 * ⚠️ **왜 이 경로가 중요한가**: `buildGeoActions` 는 **모든 무료진단에서 항상** 돈다.
 *   (crew 4에이전트는 유료·승인자가 버튼을 눌러야만 도는 on-demand 경로다.)
 *   → 고객이 실제로 보는 처방은 **이 파일**이 만든다.
 *
 * 🔬 순수 함수라 라이브 확인 없이 세 시장을 전부 고정할 수 있다
 *   (프로젝트 교훈: "라이브에서 확인 못 하는 경로는 순수 함수로 빼서 테스트로 고정").
 *
 * @vitest-environment node
 */
import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, test } from "vitest";

/** 자사 편중(owned ≥ 60%) 상황 — `sourcePortfolioAction` 의 첫 분기를 태운다. */
const ownedHeavyInput = {
  averageMentionPosition: 3,
  brandName: "테스트브랜드",
  enginesMeasured: 7,
  enginesMentioned: 5,
  sourceMix: {
    community: 10,
    media: 5,
    other: 0,
    owned: 80,
    reference: 5,
  },
  topDomains: [
    { count: 20, domain: "test.com", owned: true },
    { count: 5, domain: "news.example.com", owned: false },
  ],
};

const howTextFor = (marketScope?: "korea" | "global" | "both"): string => {
  const portfolio = buildGeoActions({ ...ownedHeavyInput, marketScope }).find(
    (a) => a.kind === "source_portfolio"
  );
  // 🔴 처방이 안 나오면 빈 문자열이 되어 `not.toContain` 검사가 **전부 통과**한다.
  //   그 함정을 막으려고 여기서 던진다(단정은 test 안에 둬야 하므로 throw 로).
  if (!portfolio) {
    throw new Error("source_portfolio 처방이 나와야 한다 — 입력을 확인하라");
  }
  return portfolio.how;
};

describe("처방 채널이 타깃 시장을 따른다", () => {
  test("korea = 네이버 지식iN·카페를 제안한다", () => {
    const how = howTextFor("korea");
    expect(how).toContain("네이버 지식iN");
  });

  test("🔴 global = 네이버를 제안하지 않는다 (해외 브랜드에 엉뚱한 처방)", () => {
    const how = howTextFor("global");
    expect(how).not.toContain("네이버");
    expect(how).not.toContain("지식iN");
    // 대신 시장에 맞는 채널 유형을 말해야 한다.
    expect(how).toContain("영문 Q&A");
  });

  test("both = 양쪽을 모두 말한다 (한쪽만 말하면 절반이 빠진다)", () => {
    const how = howTextFor("both");
    expect(how).toContain("네이버 지식iN");
    expect(how).toContain("영문 Q&A");
  });

  test("marketScope 없으면 both 로 본다 (잘못 좁혀 숨기지 않는다)", () => {
    expect(howTextFor(undefined)).toBe(howTextFor("both"));
  });
});

describe("🔴 플랫폼 이름을 발명하지 않는다", () => {
  test.each([
    "korea",
    "global",
    "both",
  ] as const)("%s 처방에 Reddit 을 이름으로 박지 않는다", (scope) => {
    // 근거: 'Reddit 40.1%'(Semrush 2025-06)는 **영어권 기준**이고 자사 후속 연구에서
    //   급락했다. 시점 지난 수치로 처방하면 그건 측정이 아니라 추측이다.
    //   실제 인용 도메인은 `topDomains` 로 이미 들어오므로 관측된 것을 말하면 된다.
    const how = howTextFor(scope);
    expect(how).not.toContain("Reddit");
    expect(how).not.toContain("레딧");
  });
});

describe("시장 축이 다른 처방을 깨뜨리지 않는다", () => {
  test("세 시장 모두 동일한 개수·종류의 액션을 낸다", () => {
    const kinds = (scope: "korea" | "global" | "both") =>
      buildGeoActions({ ...ownedHeavyInput, marketScope: scope })
        .map((a) => a.kind)
        .sort();

    expect(kinds("korea")).toEqual(kinds("global"));
    expect(kinds("korea")).toEqual(kinds("both"));
  });

  test("바뀌는 것은 채널 문구뿐 — 제목·근거는 시장과 무관하다", () => {
    const pick = (scope: "korea" | "global" | "both") =>
      buildGeoActions({ ...ownedHeavyInput, marketScope: scope }).find(
        (a) => a.kind === "source_portfolio"
      );

    expect(pick("korea")?.title).toBe(pick("global")?.title);
    expect(pick("korea")?.evidence).toBe(pick("global")?.evidence);
    // how 만 달라야 한다.
    expect(pick("korea")?.how).not.toBe(pick("global")?.how);
  });
});
