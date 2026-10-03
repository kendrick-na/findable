/**
 * Stored-action display containment for legacy cards.
 *
 * @vitest-environment node
 */

import { filterStoredGeoActions } from "@repo/audit/action-display-filter";
import { describe, expect, it } from "vitest";

const action = (overrides: Record<string, unknown>) => ({
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
