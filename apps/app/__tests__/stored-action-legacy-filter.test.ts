/**
 * Stored-action display containment for legacy cards.
 *
 * @vitest-environment node
 */

import { filterStoredGeoActions } from "@repo/audit/action-display-filter";
import { buildGeoActions } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

const action = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  evidence: "측정 근거",
  how: "실행 방법",
  priority: 2,
  title: "액션",
  ...overrides,
});

describe("저장된 구형 액션의 과장 문구 표시 차단", () => {
  it("prompt_gap의 인용 보장 문구를 제거한다", () => {
    const result = filterStoredGeoActions([
      action({
        kind: "prompt_gap",
        how: "첫 문단에서 결론부터 제시하는 구조가 AI가 인용하기 좋습니다.",
      }),
    ]);

    expect(result).toEqual([]);
  });

  it("네이버 주 1회·49.3% 외삽 카드를 제거한다", () => {
    const result = filterStoredGeoActions([
      action({
        kind: "naver_blog",
        evidence: "검색 상위 10위 밖 문서도 49.3% 인용",
        how: "매주 한 편씩 올리면 네이버 AI 브리핑에 인용될 수 있습니다.",
      }),
    ]);

    expect(result).toEqual([]);
  });

  it("새 네이버 카드의 면책 문구는 구형 외삽 카드로 오인하지 않는다", () => {
    const safe = action({
      kind: "naver_blog",
      evidence: "한 사례 분석(네이버 AI 브리핑 인용 272건)의 분포",
      how: "그 분석은 기업 블로그 게시의 효과를 잰 것이 아닙니다. 보장하지 않는 것: 매주 올리면 네이버 AI 브리핑에 인용·언급된다는 근거는 없습니다. 인용 272건은 한 사례의 분포일 뿐입니다.",
    });

    expect(filterStoredGeoActions([safe])).toEqual([safe]);
  });

  it("구형 content_fix 템플릿 지시는 제거하지만 조건부 안내는 보존한다", () => {
    const legacy = action({
      kind: "content_fix",
      how: "질문마다 답하는 페이지를 하나씩 만들고, 질문을 제목·URL에 그대로 넣으세요.",
    });
    const current = action({
      kind: "content_fix",
      how: "기존 페이지를 먼저 보강하고, 내용이 충분히 다를 때만 별도 페이지를 검토하세요. 같은 문구의 페이지를 질문마다 복제하지 마세요.",
    });

    expect(filterStoredGeoActions([legacy, current])).toEqual([current]);
  });

  it("신규 카드의 정직한 부정문은 legacy regex에 걸리지 않는다", () => {
    const current = action({
      kind: "content_fix",
      how: "질문마다 페이지 하나씩 만들 필요 없습니다. 질문을 제목·URL에 그대로 복사하지 말고 실제 내용에 맞추세요.",
    });
    const naver = action({
      kind: "naver_blog",
      evidence: "인용 272건은 한 사례의 분포입니다.",
      how: "매주 올려도 인용될 수 있다는 보장은 없습니다.",
    });

    expect(filterStoredGeoActions([current, naver])).toEqual([current, naver]);
  });

  it("인용형 부정문은 구형 Naver 긍정 서명으로 오인하지 않는다", () => {
    const honest = action({
      kind: "naver_blog",
      source: "[사례 분석] 네이버 AI 브리핑 인용 272건 · 49.3%가 검색 상위 10위 밖",
      how: "매주 올리면 AI 브리핑이 절반 가까이 인용합니다라는 주장은 근거가 없습니다.",
    });

    expect(filterStoredGeoActions([honest])).toEqual([honest]);
  });

  it("다른 문장의 부정문이 구형 긍정 지시를 살리지 않는다", () => {
    const content = action({
      kind: "content_fix",
      how: "질문마다 답하는 페이지를 하나씩 두고, 질문을 제목·URL에 그대로 쓰세요.\n다만 효과를 보장하지 않는다는 점은 확인하세요.",
    });
    const naver = action({
      kind: "naver_blog",
      evidence: "인용 272건은 한 사례의 분포입니다.",
      how: "매주 올리면 네이버 AI 브리핑에 인용될 수 있습니다.\n이 수치가 기업 블로그 효과의 근거는 아닙니다.",
    });

    expect(filterStoredGeoActions([content, naver])).toEqual([]);
  });

  it("저장 원본은 유지하고 구형 effectLag만 표시용으로 정정한다", () => {
    const legacy = action({
      kind: "naver_blog",
      guide: { effectLag: "몇 주~몇 달. 글이 쌓여야 보입니다." },
    });
    const projected = filterStoredGeoActions([legacy]);

    expect((legacy.guide as { effectLag: string }).effectLag).toBe(
      "몇 주~몇 달. 글이 쌓여야 보입니다."
    );
    expect(
      (projected[0]?.guide as { effectLag: string }).effectLag
    ).toBe("게시 후 몇 주~몇 달. 실제 반영 시점과 변화는 같은 질문으로 확인하세요.");
  });

  it("3618c25 생성기 형태의 구형 content_fix는 guide가 완비돼도 제거한다", () => {
    const base = {
      brandName: "설화수",
      brandDomain: "sulwhasoo.com",
      averageMentionPosition: null,
      enginesMeasured: 4,
      enginesMentioned: 1,
      marketScope: "both" as const,
      prompts: [{ hit: 0, text: "설화수 추천해줘", total: 4 }],
      verdicts: {
        confusedQuotes: [],
        counts: {
          absent: 0,
          answered: 10,
          confirmed: 1,
          differentEntity: 0,
          engineError: 0,
          total: 10,
          unclassified: 0,
          unknownBrand: 6,
          unverified: 0,
        },
        differentEntityEngines: [],
        ownedCitationCount: 0,
      },
    };
    const scenarios = [
      base,
      { ...base, marketScope: "korea" as const },
      { ...base, enginesMentioned: 0 },
      {
        ...base,
        verdicts: { ...base.verdicts, ownedCitationCount: 2 },
      },
    ];
    const restoredLegacyCards = scenarios.flatMap((scenario) =>
      buildGeoActions(scenario).flatMap((generated) =>
        generated.kind === "content_fix"
          ? [
              JSON.parse(
                JSON.stringify({
                  ...generated,
                  how: "고객이 AI에 실제로 묻는 질문마다 답하는 페이지를 하나씩 두고, 그 질문을 페이지 제목과 주소(URL)에 그대로 쓰세요.",
                })
              ),
            ]
          : []
      )
    );

    expect(restoredLegacyCards).toHaveLength(4);
    expect(filterStoredGeoActions(restoredLegacyCards)).toEqual([]);
  });

  it("37088ab 생성기 형태의 구형 Naver 카드 4개를 source/how 분리 상태에서도 제거한다", () => {
    const base = {
      brandName: "설화수",
      brandDomain: "sulwhasoo.com",
      averageMentionPosition: null,
      enginesMeasured: 4,
      enginesMentioned: 1,
      marketScope: "both" as const,
      prompts: [{ hit: 0, text: "설화수 추천해줘", total: 4 }],
      verdicts: {
        confusedQuotes: [],
        counts: {
          absent: 0,
          answered: 10,
          confirmed: 1,
          differentEntity: 0,
          engineError: 0,
          total: 10,
          unclassified: 0,
          unknownBrand: 6,
          unverified: 0,
        },
        differentEntityEngines: [],
        ownedCitationCount: 0,
      },
    };
    const scenarios = [
      base,
      { ...base, marketScope: "korea" as const },
      { ...base, enginesMentioned: 0 },
      {
        ...base,
        verdicts: { ...base.verdicts, ownedCitationCount: 2 },
      },
    ];
    const restoredLegacyCards = scenarios.flatMap((scenario) =>
      buildGeoActions(scenario).flatMap((generated) =>
        generated.kind === "naver_blog"
          ? [
              JSON.parse(
                JSON.stringify({
                  ...generated,
                  how:
                    "우리 업종의 한 주제를 정해, 고객이 실제로 묻는 질문을 제목으로 삼아 매주 올리세요. 첫 문단에 답을 먼저 쓰고, 회사 이름을 정확히 적습니다. 분석에 따르면 네이버 AI 브리핑은 검색 상위 10위 밖 문서도 절반 가까이 인용합니다 — 순위보다 질문에 맞게 정리된 글이 뽑힐 여지가 있습니다.",
                })
              ),
            ]
          : []
      )
    );

    expect(restoredLegacyCards).toHaveLength(4);
    expect(filterStoredGeoActions(restoredLegacyCards)).toEqual([]);
  });

  it("Bing 등록을 ChatGPT 노출의 필요조건으로 말하는 카드를 제거한다", () => {
    const result = filterStoredGeoActions([
      action({
        kind: "bing_webmaster",
        how: "Bing에 안 잡히면 ChatGPT 검색에도 나오기 어렵습니다.",
      }),
    ]);

    expect(result).toEqual([]);
  });

  it("구형 llms.txt 금지 카드는 제거하지만 중립적인 안내는 보존한다", () => {
    const result = filterStoredGeoActions([
      action({
        kind: "avoid",
        title: "llms.txt 파일 만들기",
        evidence: "주요 AI 서비스가 이 파일을 읽는다고 밝힌 적이 없고",
      }),
      action({
        kind: "avoid",
        title: "llms.txt 참고",
        evidence: "보편적인 표준이 아니므로 선택 사항입니다.",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("llms.txt 참고");
  });

  it("관계없는 관찰 문장과 현재의 신중한 카드는 보존한다", () => {
    const safe = action({
      kind: "prompt_gap",
      how: "기존 페이지에 확인 가능한 사양과 사례를 보강하세요.",
      verification: "공개 주소에서 게시·색인을 확인하세요.",
    });

    expect(filterStoredGeoActions([safe])).toEqual([safe]);
  });
});
