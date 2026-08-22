/**
 * 저장된 옛 회차의 화면 오염 해소 회귀 테스트 (2026-08-10 세션N-14).
 *
 * 🔴 **왜 필요했나 — 라이브 화면 실측에서 발견**
 *   세션N-13 이 `sanitize.ts` 로 오염을 잡은 건 **저장 시점**이라, 그 전에 저장된
 *   회차에는 손이 닿지 않았다. 그래서 투두에는 "195건 → 0건"으로 적혀 있었지만,
 *   실제 라이브 화면(`www.findable.co.kr/audit/<id>`)을 캡처해 보니
 *   **5개 중 4개 페이지에 아직 엔티티가 그대로 보이고 있었다.**
 *   DB 실측: `AuditJob` **49건**이 아직 오염 상태.
 *
 * ⚠️ **저장 데이터는 고치지 않는다**(소급 변경 = 점수·시계열이 흔들린다).
 *   대신 **표시 직전**인 `stripMarkdown` 에서 푼다. `excerpt` 를 화면에 그리는
 *   모든 경로가 이 함수를 지나므로 한 곳이면 전 화면이 해소된다.
 *
 * ⚠️ 케이스는 전부 **라이브 화면에서 그대로 긁어온 실제 문자열**이다(만든 예시 아님).
 *
 * @vitest-environment node
 */

import { stripMarkdown } from "@repo/audit/strip-markdown";
import { describe, expect, it } from "vitest";

/** 화면에 이게 보이면 실패 — 고객이 코드를 읽게 된다. */
const ENTITY_RE = /&#\d+;|&#x[0-9a-f]+;|&quot;|&amp;|&lt;|&gt;|&nbsp;/i;

describe("stripMarkdown — 저장된 옛 회차의 HTML 엔티티", () => {
  it("🔴 SK하이닉스 화면에 실제로 보이던 문자열이 정리된다", () => {
    // 라이브 실측(www.findable.co.kr/audit/d732a13a-…)
    const raw =
      "삼성전자·SK하이닉스, 2분기 합산 이익 150조 &#39;역대급 신기록&#39; 외 핫이슈";
    const out = stripMarkdown(raw);
    expect(out).toBe(
      "삼성전자·SK하이닉스, 2분기 합산 이익 150조 '역대급 신기록' 외 핫이슈"
    );
    expect(out).not.toMatch(ENTITY_RE);
  });

  it("🔴 기아·무신사·claude.ai 화면의 `&#34;` 가 큰따옴표로 복원된다", () => {
    // 기아 실측
    expect(
      stripMarkdown("&#34;근처 맛집 추천해 줘&#34;와 같은 복잡한 질문")
    ).toBe('"근처 맛집 추천해 줘"와 같은 복잡한 질문');
    // 무신사 실측
    expect(
      stripMarkdown(
        "&#34;스킨로션 추천해줘&#34;…AI 쇼핑 너도나도 &#39;봇물&#39;"
      )
    ).toBe("\"스킨로션 추천해줘\"…AI 쇼핑 너도나도 '봇물'");
    // claude.ai 실측
    expect(stripMarkdown("&#34;요약해줘&#34;, &#34;제목 뽑아줘&#34;")).toBe(
      '"요약해줘", "제목 뽑아줘"'
    );
  });

  it("🔴 이중 인코딩(`&amp;#39;`)도 풀린다 — DB 실측 1건 존재", () => {
    expect(stripMarkdown("It&amp;#39;s On")).toBe("It's On");
  });

  it("🔴 디코딩으로 드러난 HTML 태그가 화면에 글자로 남지 않는다", () => {
    // `&lt;b&gt;` 는 디코딩되면 `<b>` 가 된다 → 그물이 없으면 태그가 그대로 보인다.
    const out = stripMarkdown("&lt;b&gt;조선미녀&lt;/b&gt; 선크림");
    expect(out).toBe("조선미녀 선크림");
    expect(out).not.toContain("<b>");
  });

  it("기존 마크다운 처리는 그대로 동작한다 (회귀 방지)", () => {
    expect(stripMarkdown("**굵게** 그리고 [링크](https://a.com)")).toBe(
      "굵게 그리고 링크"
    );
    expect(stripMarkdown("## 제목")).toBe("제목");
    expect(stripMarkdown("- 항목")).toBe("• 항목");
    // 표 → 평문
    expect(stripMarkdown("| 제품 | 가격 |\n|---|---|\n| A | 1만 |")).toContain(
      "제품 · 가격"
    );
  });

  it("빈 값·정상 텍스트는 건드리지 않는다", () => {
    expect(stripMarkdown("")).toBe("");
    expect(stripMarkdown("평범한 한국어 문장입니다.")).toBe(
      "평범한 한국어 문장입니다."
    );
    // 엔티티처럼 생겼지만 아닌 것(수식)은 훼손하지 않는다.
    expect(stripMarkdown("A & B 그리고 5 < 10")).toBe("A & B 그리고 5 < 10");
  });
});
