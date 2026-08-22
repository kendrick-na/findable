/**
 * 실측 오염 데이터 회귀 테스트 (2026-08-10 세션N-13).
 *
 * 위 `sanitize-engine-text.test.ts` 가 규칙을 검증한다면, 여기는
 * **프로덕션 DB 에서 실제로 나온 문자열**이 깨끗해지는지 본다.
 * 케이스는 전부 실측값이다(만든 예시 없음).
 *
 * @vitest-environment node
 */

import { sanitizeEngineText } from "@repo/ai/lib/engines/sanitize";
import { describe, expect, it } from "vitest";

/** 화면에 절대 나가면 안 되는 것들. */
const FORBIDDEN: [string, RegExp][] = [
  ["HTML 엔티티", /&(#x?[0-9a-f]+|amp|lt|gt|quot|nbsp|apos);/i],
  ["HTML 태그", /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i],
  ["미종결 태그", /<[a-z][^>]*$/i],
  ["마크다운 링크", /\]\(https?:\/\//],
];

function assertClean(text: string) {
  for (const [name, re] of FORBIDDEN) {
    // 오염 패턴 4종을 같은 방식으로 검사하는 헬퍼. 규칙은 `it` 밖의 `expect` 를 실수로
    //   보지만, 여기서는 4종을 테스트마다 복붙하지 않기 위한 **의도된 공통 단언**이다
    //   (실패 메시지에 어느 종류가 걸렸는지 실린다).
    // biome-ignore lint/suspicious/noMisplacedAssertion: 위 주석 참고
    expect(re.test(text), `${name} 가 남아 있다: ${text.slice(0, 120)}`).toBe(
      false
    );
  }
}

describe("실측 오염 샘플 (프로덕션 DB)", () => {
  it("🔴 사용자 캡처 — NVIDIA 네이버 브리핑", () => {
    const raw =
      'NVIDIA www.nvidia.com › 20-series 새 창 열림 AI 출처 정보 NVIDIA는 GPU를 발명하고 AI 분야의 기술을 제공하는 글로벌 기업입니다. 자세히 보기 Keep에 저장 RTX. It&#39;s On. 관련문서 더보기 <div class="sds-comps-h';
    const out = sanitizeEngineText(raw);
    assertClean(out);
    expect(out).toContain("It's On."); // 글자는 살아야 한다
    expect(out).toContain("NVIDIA는 GPU를 발명하고");
  });

  it("🔴 daum — 검색 스니펫의 &#34; 인용부호 (실측 257회)", () => {
    const raw =
      '질문은 "유산균 제품 추천해줘&#34;, "인기 있는 라면&#34; 처럼 입력합니다';
    const out = sanitizeEngineText(raw);
    assertClean(out);
    expect(out).toContain('유산균 제품 추천해줘"');
  });

  it("🔴 daum — &#39; 작은따옴표 (실측 610회)", () => {
    const raw =
      "메디큐브 등의 에이전시인 구기운 대표는 &#34;&#39;럭키비키&#39;한 긍정적인 성격&#34;이라고 말했다";
    const out = sanitizeEngineText(raw);
    assertClean(out);
    expect(out).toContain("'럭키비키'한");
  });

  it("🔴 perplexity — 마크다운 링크 (실측 32건)", () => {
    const raw =
      '"화장품 수분 증발 방지" 후기 다수. | [YouTube 1](https://www.youtube.com/watch?v=dW3NAsHMRqg) (2-3주 사용), [Nav';
    const out = sanitizeEngineText(raw);
    assertClean(out);
    expect(out).toContain("YouTube 1");
    expect(out).not.toContain("youtube.com/watch");
  });

  it("🔴 perplexity — 잘린 마크다운 링크 (실측 5건, 응답이 중간에 끊김)", () => {
    const raw =
      "제로 모공 패드 2.0과 연계 시 효과적. | [Tistory 4](https://shopingitem.tistory.com/entry/%ED%94%BC%EB%B6%80";
    const out = sanitizeEngineText(raw);
    assertClean(out);
    expect(out).toContain("Tistory 4");
    expect(out).not.toContain("tistory.com");
  });

  it("🔴 naver-briefing — 이중 인코딩 It&amp;#39;s (실측)", () => {
    const out = sanitizeEngineText("RTX. It&amp;#39;s On. 최신 RTX 게임");
    assertClean(out);
    expect(out).toContain("It's On.");
  });

  it("🔴 perplexity — <br> 태그 (실측 2건)", () => {
    const raw =
      "글로벌 소비자 공략 성공.<br>- TikTok 등 SNS에서 500만 개 이상 판매, 현지화로 히트.";
    const out = sanitizeEngineText(raw);
    assertClean(out);
    expect(out).toContain("TikTok");
    expect(out).toContain("글로벌 소비자 공략 성공.");
  });

  it("정상 한국어 답변은 한 글자도 안 바뀐다", () => {
    const clean =
      "설화수의 베스트셀러 추천 제품으로는 진설크림, 자음생앰플, 순행클렌징오일이 공식 사이트에서 가장 사랑받는 아이템입니다.";
    expect(sanitizeEngineText(clean)).toBe(clean);
  });
});
