import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import en from "../../../packages/internationalization/dictionaries/en.json";
import ko from "../../../packages/internationalization/dictionaries/ko.json";
import { TodayView } from "../app/(authenticated)/components/today-view";

const base = {
  basis: { prompts: 12, engines: 7, runs: 1 },
  brandId: "brand_1",
  brandName: "Acme",
  conditions: [
    { engine: "ChatGPT", answers: 12, withSources: 0 },
    { engine: "Perplexity", answers: 12, withSources: 12 },
  ],
  coverage: { mentioned: 3, total: 7 },
  delta: { kind: "none", points: null } as const,
  first: {
    kind: "weak",
    prompt: "best tool?",
    hit: 1,
    total: 7,
  } as const,
  oldViewHref: "/?view=old",
  site: { total: 18, fail: 1, warning: 2 },
  sov: 25,
  warnMissingSources: true,
};

describe("TodayView 렌더", () => {
  test("한국어: 주인공 숫자·먼저 볼 질문·측정 조건·되돌리기 링크가 모두 나온다", () => {
    const html = renderToStaticMarkup(<TodayView {...base} t={ko.app.today} />);
    expect(html).toContain("25%");
    expect(html).toContain("Acme");
    expect(html).toContain("엔진 7곳 중 3곳에서 나와요");
    expect(html).toContain("비교할 지난 측정이 아직 없어요");
    expect(html).toContain("질문 12개 × 엔진 7곳 · 1번째 측정");
    expect(html).toContain("측정이 한 번뿐이라");
    expect(html).toContain("엔진 7곳 중 1곳에서만 나와요");
    expect(html).toContain("/actions?brand=brand_1");
    expect(html).toContain("응답 12개 중 출처가 붙은 응답 0개");
    expect(html).toContain("웹 검색 없이 답했을 수 있어요");
    expect(html).toContain("점검 18개 중 문제 1개 · 주의 2개");
    expect(html).toContain("/?view=old");
    // 치환 안 된 자리표시자가 남으면 안 된다
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("영어도 같은 구조로 그려진다", () => {
    const html = renderToStaticMarkup(<TodayView {...base} t={en.app.today} />);
    expect(html).toContain("25%");
    expect(html).toContain("Mentioned on 3 of 7 engines");
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test("조건에 따라 숨겨질 것은 숨겨진다(1회 이상·경고 없음·점검 전)", () => {
    const html = renderToStaticMarkup(
      <TodayView
        {...base}
        basis={{ prompts: 12, engines: 7, runs: 3 }}
        first={{ kind: "allHit" }}
        site={null}
        t={ko.app.today}
        warnMissingSources={false}
      />
    );
    expect(html).not.toContain("측정이 한 번뿐이라");
    expect(html).not.toContain("웹 검색 없이 답했을 수 있어요");
    expect(html).toContain("아직 사이트 점검 전이에요");
    expect(html).toContain("모두 나오고 있어요");
  });
});
