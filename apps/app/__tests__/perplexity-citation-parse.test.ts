/**
 * 🔴🔴 **Perplexity 출처 0건의 진짜 원인** — N-48 정정 (2026-08-20).
 *
 * ## 👤 가 잡아준 인과 오류
 *
 * N-47 문서는 perplexity 출처 공백을 **「Vercel AI Gateway 크레딧 0」** 탓으로 적었다.
 * 👤 *"퍼플렉시티는 자체 api 키로 붙였는데 뭔 또 버셀 게이트웨이를 말하는거야."*
 * → **코드 실측 결과 👤 가 맞았다.**
 *
 * | | 실제 |
 * |---|---|
 * | 라이브 경로 | `PERPLEXITY_API_KEY` **직접 호출**(`api.perplexity.ai`) — 프로덕션 env 에 존재(21일 전) |
 * | Gateway | **키가 없을 때만** 타는 폴백(`resolveModel` 마지막 분기) |
 * | 크레딧 0 | *Gateway 로 돌려본 실험* 이 실패한 이유일 뿐 |
 *
 * ⭐ **되돌린 지금 라이브는 Gateway 를 안 타므로, 크레딧과 무관하게 출처가 비어 있었다.**
 *   즉 「충전하면 살아난다」는 처방 자체가 **원인을 빗나갔다**.
 *
 * ## 그럼 진짜 원인은
 *
 * `createOpenAI`(OpenAI 호환 껍데기)로 부르기 때문이다. Perplexity 는 인용을
 * **OpenAI 규격 밖 필드**에 실어 보내고, OpenAI provider 는 스키마에 없는 필드를
 * **잘라낸다** → 표준 `sources` 가 항상 빈다(프로덕션 47/47).
 *
 * 📕 근거(공식 API 레퍼런스 `chat-completions-post`):
 * | 필드 | 형태 |
 * |---|---|
 * | `search_results` | `{title, url, date?, snippet?}[]` ⭐ 제목까지 온다 |
 * | `citations` | `string[]`(URL 만) — 구형 |
 *
 * 📕 AI SDK 6.0.170 설치본 타입 실측: `result.response.body?: unknown`
 *   (*"Response body (available only for providers that use HTTP requests)"*)
 *   ⚠️ 공식 문서 페이지는 `finalStep.response` 라 안내하는데 **이 버전엔 그 속성이 없다**
 *     (tsc TS2339 로 확인). **설치본 타입이 진실이다.**
 *
 * ## 이 테스트가 지키는 것
 * ① `search_results` 를 우선 읽는다(제목이 있어 «무엇을 읽었나»를 말해준다)
 * ② `citations`(URL 만) 도 폴백으로 읽는다
 * ③ 표준 `sources` 가 있으면 **그게 이긴다**(회귀 방지 — 다른 엔진 경로를 망치지 않는다)
 * ④ 어댑터가 실제로 **원시 body 를 파서에 넘긴다**(함수만 있고 안 쓰는 사고 방지
 *    — 📕 N-46 *"함수는 있는데 안 쓰고 있다"* · cost.ts 가 프로덕션 호출 0곳이었던 유형)
 *
 * ⚠️ **라이브 검증은 배포 후** — 엔진 키는 프로덕션 전용이고 Sensitive 라 값 열람 불가.
 *   여기서는 **계약**을 잠그고, 효과는 배포 후 측정 1건으로 잰다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractPerplexitySources,
  mapProviderSources,
} from "../../../packages/ai/lib/engines/utils";

const ADAPTERS_PATH = join(
  process.cwd(),
  "../../packages/ai/lib/engines/global-adapters.ts"
);
const ADAPTERS = readFileSync(ADAPTERS_PATH, "utf8");

// 🔴 가드가 자기 주석을 세는 사고 5회(N-47 §3). 주석을 먼저 벗긴다.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const ADAPTERS_CODE = stripComments(ADAPTERS);

describe("Perplexity 인용 파싱 — 원시 body 에서 꺼낸다", () => {
  // ⭐ 훑는 대상이 비어있지 않다는 자기점검(N-47 §1 — glob 이 0개를 훑고 조용히 통과한 사고)
  it("가드가 실제 코드를 읽고 있다", () => {
    expect(ADAPTERS_CODE.length).toBeGreaterThan(2000);
    expect(ADAPTERS_CODE).toContain("makeGatewayAdapter");
  });

  it("search_results 를 CitedSource 로 바꾼다(제목 유지)", () => {
    const got = extractPerplexitySources({
      search_results: [
        { title: "설화수 공식몰", url: "https://www.sulwhasoo.com/kr/ko" },
        { title: "한국경제", url: "https://www.hankyung.com/article/123" },
      ],
    });
    expect(got).toHaveLength(2);
    expect(got[0]?.domain).toBe("www.sulwhasoo.com");
    expect(got[0]?.title).toBe("설화수 공식몰");
    expect(got[1]?.domain).toBe("www.hankyung.com");
  });

  it("citations(URL 문자열 배열) 도 폴백으로 읽는다", () => {
    const got = extractPerplexitySources({
      citations: [
        "https://www.amorepacific.com/kr/ko/index.html",
        "https://blog.naver.com/beauty/999",
      ],
    });
    expect(got.map((s) => s.domain)).toEqual([
      "www.amorepacific.com",
      "blog.naver.com",
    ]);
  });

  it("search_results 가 citations 보다 우선한다", () => {
    const got = extractPerplexitySources({
      search_results: [{ title: "우선", url: "https://a-priority.co.kr/x" }],
      citations: ["https://b-fallback.co.kr/y"],
    });
    expect(got).toHaveLength(1);
    expect(got[0]?.domain).toBe("a-priority.co.kr");
  });

  it("빈 응답·쓰레기 입력에 터지지 않고 빈 배열", () => {
    expect(extractPerplexitySources(null)).toEqual([]);
    expect(extractPerplexitySources(undefined)).toEqual([]);
    expect(extractPerplexitySources("문자열")).toEqual([]);
    expect(extractPerplexitySources({})).toEqual([]);
    expect(extractPerplexitySources({ search_results: [] })).toEqual([]);
    expect(
      extractPerplexitySources({ search_results: [{ title: "url 없음" }] })
    ).toEqual([]);
  });

  it("중복 URL 은 한 번만 담는다", () => {
    const got = extractPerplexitySources({
      citations: ["https://x.co.kr/a", "https://x.co.kr/a"],
    });
    expect(got).toHaveLength(1);
  });

  // ③ 회귀 방지: 표준 sources 가 있으면 그게 이긴다(gemini·naver 경로를 망치지 않는다)
  it("표준 sources 가 있으면 그 경로가 이긴다", () => {
    const standard = mapProviderSources([
      { sourceType: "url", url: "https://standard-wins.co.kr/p" },
    ]);
    expect(standard).toHaveLength(1);
    // 어댑터가 «표준 우선, 없을 때만 원시 body» 순서로 배선돼 있어야 한다.
    // ⚠️ 판정 범위를 **헬퍼 함수 본문 안**으로 좁힌다 — 파일 전체를 훑으면
    //   주석·import 줄이 통과시킨다(📕 N-47 §2 «호출 블록 안만 본다»).
    const helperStart = ADAPTERS_CODE.indexOf("function resolveProviderCited");
    expect(helperStart).toBeGreaterThan(-1);
    const helper = ADAPTERS_CODE.slice(
      helperStart,
      ADAPTERS_CODE.indexOf("function makeGatewayAdapter")
    );
    expect(helper).toContain("standardCited.length > 0");
    expect(helper).toContain("extractPerplexitySources");
    // 표준이 먼저 오는 순서를 못박는다(뒤집히면 다른 엔진 출처가 덮인다).
    expect(helper.indexOf("standardCited")).toBeLessThan(
      helper.indexOf("extractPerplexitySources")
    );
  });

  // ④ 「함수는 있는데 안 쓰고 있다」 방지 — import + 실제 호출 인자까지 본다.
  it("어댑터가 원시 응답 body 를 파서에 실제로 넘긴다", () => {
    // generateText 결과에서 response 를 꺼내 쓰고 있어야 한다.
    expect(ADAPTERS_CODE).toMatch(/response:\s*providerResponse/);
    // ⭐ 배선은 **어댑터 → 헬퍼 → 파서** 로 이어진다. 세 고리를 각각 못박는다
    //   (한 고리만 보면 «함수는 있는데 안 쓰는» 사고를 놓친다 — 📕 N-46 cost.ts 유형).
    // ① 어댑터가 원시 body 를 헬퍼에 넘긴다
    expect(ADAPTERS_CODE).toMatch(
      /resolveProviderCited\(\s*sources,\s*providerResponse\?\.body\s*\)/
    );
    // ② 헬퍼가 그 body 를 파서에 넘긴다
    const helperStart = ADAPTERS_CODE.indexOf("function resolveProviderCited");
    const helper = ADAPTERS_CODE.slice(
      helperStart,
      ADAPTERS_CODE.indexOf("function makeGatewayAdapter")
    );
    expect(helper).toMatch(/extractPerplexitySources\(\s*rawBody\s*\)/);
    // ③ 그 결과가 실제로 citedSources 로 흘러간다
    expect(ADAPTERS_CODE).toMatch(/const providerCited = resolveProviderCited/);
    // 🔴 N-48: 본문 URL 폴백을 끊었으므로 `citedSources` 는 **provider 것만** 쓴다.
    //   예전엔 `providerCited.length > 0 ? … : extractCitedSources(…)` 였다.
    //   폴백이 되살아나면 가짜 출처가 다시 들어오므로 여기서 못박는다.
    expect(ADAPTERS_CODE).toMatch(/const citedSources = providerCited;/);
    expect(ADAPTERS_CODE).not.toMatch(/:\s*extractCitedSources\(/);
  });
});
