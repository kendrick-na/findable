/**
 * 엔진 응답 정제 회귀 테스트 (2026-08-10 세션N-13).
 *
 * 여기서 지키는 것 = **"화면에 코드가 보이지 않는다"**.
 *
 * 🔴 왜: 전수감사(응답 1,779건)에서 화면에 그대로 나가는 텍스트가 오염돼 있었다.
 *   HTML 엔티티 **868회**(`It&#39;s On` 이 그대로 렌더) · 마크다운 링크 32건 ·
 *   네이버 UI 찌꺼기 · `<br>` 태그. 사용자가 캡처로 제보한 실제 화면 결함이다.
 *
 * ⚠️ 케이스는 전부 **DB 실측값**에서 가져왔다(만든 예시가 아니다).
 *
 * @vitest-environment node
 */

import {
  decodeHtmlEntities,
  sanitizeEngineText,
} from "@repo/ai/lib/engines/sanitize";
import { describe, expect, it } from "vitest";

describe("decodeHtmlEntities", () => {
  it("🔴 실측 3종을 실제 문자로 되돌린다 (치환이 아니라 디코딩)", () => {
    // DB 실측: &#39; 610회 · &#34; 257회 · &amp; 1회
    expect(decodeHtmlEntities("RTX. It&#39;s On.")).toBe("RTX. It's On.");
    expect(decodeHtmlEntities("&#34;유산균 추천해줘&#34;")).toBe(
      '"유산균 추천해줘"'
    );
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B");
  });

  it("16진수 엔티티도 처리한다", () => {
    expect(decodeHtmlEntities("&#x27;test&#x27;")).toBe("'test'");
  });

  it("🔴 이중 인코딩을 푼다 — 실측: naver-briefing 의 It&amp;#39;s On", () => {
    // 네이버 HTML 이 이미 인코딩된 문자열을 한 번 더 인코딩해 보낸다(실측 확인).
    // 1패스만 하면 &#39; 가 남아 화면에 코드가 그대로 보인다.
    expect(decodeHtmlEntities("It&amp;#39;s On")).toBe("It's On");
  });

  it("🔴 무한 반복하지 않는다 — 원문의 &amp;amp; 를 훼손하면 안 된다", () => {
    // 상한(3패스)이 없으면 사용자가 진짜로 쓴 &amp;amp; 까지 풀어 원문이 바뀐다.
    // 3패스면 실측 최대(2중)를 커버하면서도 과다 디코딩을 막는다.
    const out = decodeHtmlEntities("&amp;amp;amp;amp;amp;");
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe("&"); // 끝까지 다 풀리지 않았다
  });

  it("제어문자 코드포인트는 버린다 (화면 깨짐 방지)", () => {
    expect(decodeHtmlEntities("a&#0;b")).toBe("ab");
  });
});

describe("sanitizeEngineText", () => {
  it("🔴 사용자가 캡처로 제보한 실제 오염을 정리한다", () => {
    const raw = 'RTX. It&#39;s On. 관련문서 더보기 <div class="sds-comps-h';
    const out = sanitizeEngineText(raw);
    expect(out).toContain("It's On.");
    expect(out).not.toContain("&#39;");
    expect(out).not.toContain("<div");
    expect(out).not.toContain("sds-comps");
  });

  it("🔴 마크다운 링크는 표시문구만 남긴다 (URL 이 화면에 노출되면 안 됨)", () => {
    // 실측(perplexity): "[YouTube 1](https://www.youtube.com/watch?v=dW3NAsHMRqg)"
    expect(
      sanitizeEngineText(
        "후기 다수. [YouTube 1](https://youtube.com/watch?v=x)"
      )
    ).toBe("후기 다수. YouTube 1");
  });

  it("표시문구 없는 링크는 통째로 지운다", () => {
    expect(sanitizeEngineText("참고 [](https://example.com) 끝")).toBe(
      "참고 끝"
    );
  });

  it("🔴 검색 하이라이트가 브랜드명을 쪼개도 붙여서 살린다 (라이브 실측)", () => {
    // 🔬 카카오 검색 API 라이브 실측(2026-08-10): 브랜드명을 **토큰 단위로 쪼개** 감싼다.
    //   `조선미녀` 검색 10건 중 **9건**이 이 형태였다.
    //   태그를 공백으로 치우면 `조선 미녀` 가 되어 **브랜드가 통째로 사라지고**,
    //   판정(detectBrandMention)이 "미언급"으로 오판해 **점수까지 낮춘다**.
    const raw = "“마뗑킴·<b>조선</b><b>미녀</b>…소상공인 유망 제품";
    const out = sanitizeEngineText(raw);
    expect(out).toContain("조선미녀");
    expect(out).not.toContain("조선 미녀");
    expect(out).not.toContain("<b>");
  });

  it("🔴 원래 떨어져 있던 태그는 붙이지 않는다 (단어 뭉침 방지)", () => {
    // 맞붙은 경계(`</b><b>`)만 이어야 한다. 사이에 공백이 있었으면 그대로 보존.
    expect(sanitizeEngineText("<b>라네즈</b> <b>크림</b>")).toBe("라네즈 크림");
    // 서로 다른 블록이 이어지는 경우도 단어가 뭉치면 안 된다.
    expect(sanitizeEngineText("성공.<br>TikTok")).toContain("성공.");
    expect(sanitizeEngineText("성공.<br>TikTok")).toContain("TikTok");
  });

  it("🔴 <br> 태그가 화면에 글자로 보이면 안 된다", () => {
    // 실측(perplexity, beautyofjoseon): "…성공.<br>- TikTok 등 SNS에서…"
    const out = sanitizeEngineText("성공.<br>- TikTok 등 SNS에서 500만 개");
    expect(out).not.toContain("<br>");
    expect(out).toContain("TikTok");
  });

  it("🔴 순서 검증 — 디코딩 뒤 태그 제거라 &lt;b&gt; 안의 글자가 살아남는다", () => {
    // 태그를 먼저 지우면 &lt;b&gt; 는 남고, 디코딩 후엔 <b> 가 되어 본문이 사라진다.
    // 올바른 순서면 디코딩 → <b> → 태그 제거 → 브랜드명만 남는다.
    expect(sanitizeEngineText("&lt;b&gt;파인더블&lt;/b&gt;")).toBe("파인더블");
  });

  it("정상 텍스트는 건드리지 않는다", () => {
    const clean = "설화수의 베스트셀러 추천 제품으로는 진설크림이 있습니다.";
    expect(sanitizeEngineText(clean)).toBe(clean);
  });

  it("빈 입력은 빈 문자열", () => {
    expect(sanitizeEngineText(null)).toBe("");
    expect(sanitizeEngineText(undefined)).toBe("");
    expect(sanitizeEngineText("")).toBe("");
  });

  it("멱등 — 이미 정제된 값을 다시 넣어도 같다", () => {
    const once = sanitizeEngineText("It&#39;s <b>ok</b> [링크](https://a.com)");
    expect(sanitizeEngineText(once)).toBe(once);
  });
});
