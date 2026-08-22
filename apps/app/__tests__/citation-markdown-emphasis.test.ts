/**
 * 🔴🔴 **마크다운 강조가 자사 도메인 제외 필터를 뚫었다** (N-48 · 2026-08-20).
 *
 * ## 프로덕션 실측이 발단
 *
 * ChatGPT 인용에 이런 행이 실제로 있었다:
 * ```
 * https://www.sulwhasoo.com**    ← 도메인이 「www.sulwhasoo.com**」
 * ```
 * AI 가 본문에 `**https://www.sulwhasoo.com**` 처럼 **굵게** 써 보냈고,
 * `TRAILING_PUNCT` 가 `**` 를 안 벗겼다.
 *
 * 🔴 **그래서 자사 도메인 제외가 빗나갔다** — `owned` 비교는 문자열 일치라
 *   `www.sulwhasoo.com**` ≠ `sulwhasoo.com` 이 되어 **자사 홈페이지가 「외부 출처」로
 *   둔갑**했다. N-47 이 막으려던 바로 그 상태다:
 *   *"AI 가 무엇을 보고 우리를 말하는가를 파는 제품이 고객 자기 홈페이지를 근거라고 보여준다."*
 *
 * 📕 N-47 은 백틱(`` ` ``)만 고쳤다. **강조 문자는 여러 개다**(`**`·`*`·`_`·`~`).
 *   한 글자씩 사고가 날 때마다 늘리는 게 아니라 **부류로** 막는다.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { extractCitedSources } from "../../../packages/ai/lib/engines/utils";

const OWNED = "sulwhasoo.com";

describe("본문 폴백 — 마크다운 강조를 벗긴다", () => {
  it("🔴🔴 `**` 로 감싼 자사 도메인이 **제외된다**(원래 버그)", () => {
    const got = extractCitedSources(
      "설화수 공식몰은 **https://www.sulwhasoo.com** 입니다.",
      OWNED
    );
    expect(got).toHaveLength(0);
  });

  it("`*`·`_`·`~` 로 감싼 자사 도메인도 제외된다", () => {
    for (const wrapped of [
      "*https://int.sulwhasoo.com*",
      "_https://us.sulwhasoo.com_",
      "~https://tw.sulwhasoo.com~",
    ]) {
      expect(extractCitedSources(`보기: ${wrapped} 참고`, OWNED)).toHaveLength(
        0
      );
    }
  });

  it("⚠️ 도메인 문자열에 강조 문자가 **남지 않는다**", () => {
    const got = extractCitedSources(
      "경쟁사는 **https://www.laneige.com** 입니다.",
      OWNED
    );
    expect(got).toHaveLength(1);
    expect(got[0]?.domain).toBe("www.laneige.com");
    expect(got[0]?.url).toBe("https://www.laneige.com");
    expect(got[0]?.domain).not.toContain("*");
    expect(got[0]?.url).not.toContain("*");
  });

  it("✅ 외부 URL 은 계속 남는다 — 전면 차단이 아니다(👤 N-47 결정)", () => {
    const got = extractCitedSources(
      "**https://www.sulwhasoo.com** 과 https://namu.wiki/w/설화수 를 참고했습니다.",
      OWNED
    );
    expect(got.map((s) => s.domain)).toEqual(["namu.wiki"]);
  });

  it("⚠️ 본문 중간의 `*` 는 건드리지 않는다(꼬리만 벗긴다)", () => {
    const got = extractCitedSources("https://example.co.kr/a*b/c 참고", OWNED);
    expect(got).toHaveLength(1);
    expect(got[0]?.url).toBe("https://example.co.kr/a*b/c");
  });
});
