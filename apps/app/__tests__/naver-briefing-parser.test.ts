/**
 * 네이버 AI 브리핑 **파서 방어선** 회귀 테스트 (2026-08-17 세션N-38).
 *
 * 🔴 **왜 지금 만드나**: 이 파서는 사고 3건이 차례로 방어를 덧댄 자리인데
 *   (광고 삼킴 · 생 HTML/JS 노출 · 링크나열 오탐) **단위 테스트가 하나도 없었다.**
 *   있던 것은 실제 네이버를 호출하는 디버그 스크립트뿐이라 CI 에서 회귀를 못 잡는다.
 *   방어 코드가 **지워져도 아무도 모르는** 상태였다.
 *
 * ⚠️ **여기 쓰인 오염 패턴은 지어낸 것이 아니다** — 프로덕션 `AuditJob` 에 실제로
 *   저장된 문자열에서 가져왔다(2026-08-17 DB 조회):
 *
 *     현대   `"현대효과 관련 광고 … 이 광고가 표시된 이유 … 한빛프로이드최면센터"`
 *     설화수 `"AI 브리핑 실험 단계로 정확하지 않을 수 있어요…"` (고지문만)
 *     아누아 같은 고지문
 *     NVIDIA `"… 네이버가 AI를 활용해 제공하는 설명으로 정확하지 않을 수 있어요"`
 *
 * 🔬 **시점 확인**: 위 4건은 **전부 2026-07-30 가드 도입(`1c4bb59`) 이전** 측정이고,
 *   그 이후 마지막 측정(8/1 SK하이닉스)은 깨끗했다. 즉 **파서는 이미 고쳐져 있다.**
 *   이 테스트는 "고치는 것"이 아니라 **다시 깨지지 않게 붙드는 것**이다.
 *
 * @vitest-environment node
 */

import { extractBriefingBlock } from "@repo/ai/lib/engines/naver-briefing-adapter";
import { describe, expect, it } from "vitest";

/** 실제 브리핑 답변처럼 문장형(…다./…요.)이고 100자 이상인 본문. */
const REAL_ANSWER =
  "설화수는 아모레퍼시픽의 프리미엄 한방 화장품 브랜드입니다. " +
  "인삼과 한방 성분을 활용한 안티에이징 라인으로 알려져 있으며, " +
  "대표 제품으로는 자음생 크림과 윤조 에센스가 있습니다. " +
  "백화점과 온라인 공식몰에서 구매할 수 있어요.";

/** 브리핑 블록 + 뒤이어 붙는 SERP 광고 모듈(별도 data-block-id). */
function htmlWithAdAfterBriefing(): string {
  return `<html><body>
    <div data-block-id="ai-briefing-1"><div class="ai_brief">${REAL_ANSWER}</div></div>
    <div data-block-id="power-link-2">
      현대효과 관련 광고 이 광고가 표시된 이유 등록 안내 파워링크
      한빛프로이드최면센터 redsunas.com 최면상담 방송3사 모두 출연한 그곳
    </div>
  </body></html>`;
}

describe("브리핑 파서 — 광고를 답변으로 삼키지 않는다", () => {
  /**
   * 🔴 방어선이 **두 겹**이라 각각 따로 물려야 한다(N-38 실측으로 알아냈다):
   *   ① 블록 경계(`nextBlockAttr`) — 다음 `data-block-id` 앞에서 자른다
   *   ② 텍스트 안전망(`cutAtSerpTail`) — 경계를 못 잡아 **같은 블록 안에** 광고가
   *      섞여 들어온 경우 마커에서 끊는다
   *
   * ⚠️ 처음 이 테스트는 ①만 검사하고 있었다 — ②를 지워도 **통과했다**(가드가 안 물림).
   *   그래서 ②를 직접 겨누는 케이스를 아래에 따로 둔다.
   */
  it("🔴 같은 블록 안에 광고가 섞여도 마커에서 끊는다 (cutAtSerpTail)", () => {
    // 다음 블록 마커가 **없는** HTML — ①이 작동하지 않으므로 ②만이 유일한 방어선이다.
    const html = `<html><body><div data-block-id="ai-briefing-1"><div class="ai_brief">
      ${REAL_ANSWER} 이 광고가 표시된 이유 등록 안내 파워링크 한빛프로이드최면센터 redsunas.com
    </div></div></body></html>`;
    const text = extractBriefingBlock(html)?.text ?? "";
    expect(text).not.toContain("이 광고가 표시된 이유");
    expect(text).not.toContain("파워링크");
    expect(text).not.toContain("한빛프로이드최면센터");
    expect(text).toContain("설화수는 아모레퍼시픽");
  });

  it("🔴 다음 블록(광고)의 문구가 본문에 섞이지 않는다 (블록 경계)", () => {
    const block = extractBriefingBlock(htmlWithAdAfterBriefing());
    expect(block).not.toBeNull();
    const text = block?.text ?? "";
    // 실제로 고객 화면에 나갔던 문자열들 — 하나라도 남으면 그때 사고가 재현된 것이다.
    expect(text).not.toContain("이 광고가 표시된 이유");
    expect(text).not.toContain("파워링크");
    expect(text).not.toContain("한빛프로이드최면센터");
    // 진짜 답변은 남아 있어야 한다(과잉 차단도 실패다).
    expect(text).toContain("설화수는 아모레퍼시픽");
  });

  /**
   * 🔴 위 두 케이스만으로는 **블록 경계 가드가 지워져도 통과한다** — `cutAtSerpTail`
   *   이 대신 막아 주기 때문이다(N-38 뮤테이션 실측). 그러면 경계 가드는 "있으나
   *   검사되지 않는" 상태가 된다.
   *   → **마커가 하나도 없는 다음 블록**을 붙여 경계 가드만 홀로 겨눈다.
   */
  it("🔴 마커 없는 다음 블록도 경계에서 끊긴다 — 경계 가드 단독 검사", () => {
    const html = `<html><body>
      <div data-block-id="ai-briefing-1"><div class="ai_brief">${REAL_ANSWER}</div></div>
      <div data-block-id="web-results-2">
        지식iN 답변 모음입니다. 화장품 추천 목록을 정리했어요.
        아이오페 레티놀 세럼이 요즘 인기가 많습니다.
      </div>
    </body></html>`;
    const text = extractBriefingBlock(html)?.text ?? "";
    // 다음 블록의 내용이 브리핑 답변으로 새면 안 된다(SERP 마커가 없어도).
    expect(text).not.toContain("지식iN");
    expect(text).not.toContain("아이오페");
    expect(text).toContain("설화수는 아모레퍼시픽");
  });

  it("🔴 광고 링크가 citedSources 후보에 섞이지 않는다", () => {
    const html = `<html><body>
      <div data-block-id="ai-briefing-1"><div class="ai_brief">
        ${REAL_ANSWER} <a href="https://www.sulwhasoo.com/">설화수 공식</a>
      </div></div>
      <div data-block-id="power-link-2">
        <a href="https://redsunas.com/">한빛프로이드최면센터</a>
      </div>
    </body></html>`;
    const links = extractBriefingBlock(html)?.links ?? [];
    expect(links.some((l) => l.url.includes("redsunas.com"))).toBe(false);
    expect(links.some((l) => l.url.includes("sulwhasoo.com"))).toBe(true);
  });
});

describe("브리핑 파서 — 네이버 고지문은 답변이 아니다", () => {
  // 🔴 실측: 설화수·아누아는 **고지문만** 저장돼 있었다. 그게 "답변"으로 화면에 나가면
  //   고객은 자기 브랜드 설명 대신 네이버 면책조항을 읽는다.
  const BOILERPLATES = [
    "AI 브리핑 실험 단계로 정확하지 않을 수 있어요.",
    "네이버가 AI를 활용해 제공하는 설명으로 정확하지 않을 수 있어요.",
  ];

  it.each(BOILERPLATES)("고지문이 본문에서 제거된다: %s", (boilerplate) => {
    const html = `<html><body><div data-block-id="ai-briefing-1">
      <div class="ai_brief">${boilerplate} ${REAL_ANSWER}</div>
    </div></body></html>`;
    const text = extractBriefingBlock(html)?.text ?? "";
    expect(text).not.toContain(boilerplate);
    expect(text).toContain("설화수는 아모레퍼시픽");
  });

  it("🔴 고지문 말고 내용이 없으면 **미노출**로 판정한다", () => {
    // 고지문을 지운 뒤 100자 미만 → null. 이걸 "노출"로 세면 등장률 분모가 오염된다.
    const html = `<html><body><div data-block-id="ai-briefing-1">
      <div class="ai_brief">AI 브리핑 실험 단계로 정확하지 않을 수 있어요.</div>
    </div></body></html>`;
    expect(extractBriefingBlock(html)).toBeNull();
  });
});

describe("브리핑 파서 — 링크 나열·생 HTML 을 답변으로 오인하지 않는다", () => {
  it("🔴 문장형 서술이 없는 링크 제목 나열은 미노출", () => {
    // 네이버가 브리핑 자리에 커뮤니티 글 목록을 띄우는 경우(2026-07-30 사고).
    const html = `<html><body><div data-block-id="ai-briefing-1"><div class="ai_brief">
      설화수 자음생크림 후기 모음 설화수 윤조에센스 가격비교 설화수 세트 추천 목록
      설화수 백화점 매장 위치 안내 설화수 쿠폰 정보 설화수 신제품 소식 정리 링크
    </div></div></body></html>`;
    expect(extractBriefingBlock(html)).toBeNull();
  });

  it("🔴 script 안의 JS 원문이 본문으로 새지 않는다", () => {
    // 실사고: JSON 안 검색어가 본문에 섞여 **언급 판정까지** 오염됐다.
    const html = `<html><body><div data-block-id="ai-briefing-1"><div class="ai_brief">
      <script>window.__DATA__={"query":"설화수 효과","adUnit":"powerlink"};</script>
      ${REAL_ANSWER}
    </div></div></body></html>`;
    const text = extractBriefingBlock(html)?.text ?? "";
    expect(text).not.toContain("__DATA__");
    expect(text).not.toContain("adUnit");
    expect(text).toContain("설화수는 아모레퍼시픽");
  });

  it("네이버 UI 버튼 이름이 답변에 섞이지 않는다", () => {
    const html = `<html><body><div data-block-id="ai-briefing-1"><div class="ai_brief">
      ${REAL_ANSWER} Keep에 저장 새 창 열림 관련문서 더보기
    </div></div></body></html>`;
    const text = extractBriefingBlock(html)?.text ?? "";
    for (const label of ["Keep에 저장", "새 창 열림", "관련문서 더보기"]) {
      expect(text).not.toContain(label);
    }
  });
});

describe("브리핑 파서 — 블록이 아예 없으면 미노출", () => {
  it("ai-briefing 마커가 없으면 null (추천형 질의에서 정상 발생)", () => {
    const html = `<html><body><div data-block-id="web-results">
      <p>${REAL_ANSWER}</p>
    </div></body></html>`;
    expect(extractBriefingBlock(html)).toBeNull();
  });
});
