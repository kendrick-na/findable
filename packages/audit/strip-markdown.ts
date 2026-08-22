// 마크다운 토큰 스트립 — audit 답변 excerpt 미리보기용 (P1-f, 2026-07-27)
//
// 문제: LLM 답변 excerpt를 whitespace-pre-line으로 직접 출력하면 `**bold**`·`##`·
// `[text](url)` 같은 마크다운 기호가 raw로 노출됨(파서 없음). excerpt는 짧은
// 미리보기라 실제 서식 렌더(react-markdown)보다, 기호만 제거한 깨끗한 평문이 적합.
// (XSS 표면 없음. 전체 답변 풀뷰가 생기면 그때 react-markdown 검토.)
//
// 🔴 **2026-08-10 세션N-14 — 여기서 HTML 엔티티도 푼다.**
//   세션N-13 이 `sanitize.ts` 로 오염을 잡은 건 **저장 시점**이라, 그 전에 저장된
//   회차에는 손이 닿지 않았다. 라이브 화면 실측 결과 **AuditJob 49건**에 아직
//   `&#39;` `&#34;` 가 남아 있고, 실제로 고객 화면에 이렇게 렌더되고 있었다:
//
//     "2분기 합산 이익 150조 &#39;역대급 신기록&#39; 외 핫이슈"   ← SK하이닉스
//     "&#34;근처 맛집 추천해 줘&#34;와 같은 복잡한 질문"           ← 기아
//
//   저장 데이터를 고치는 방법(마이그레이션)은 **소급 변경**이라 금지돼 있다
//   (점수·시계열이 흔들린다). 그래서 **표시 직전인 여기서** 푼다 —
//   `excerpt` 를 화면에 그리는 모든 경로가 이 함수를 통과하므로 한 곳이면 충분하고,
//   저장된 값은 1바이트도 바뀌지 않는다.
//
// ⚠️ 디코딩은 `@repo/ai` 의 `decodeHtmlEntities` 를 **재사용**한다. 여기에 정규식을
//   새로 짜면 정제 규칙이 두 벌이 되어 "화면과 점수가 다른" 계열 사고가 난다
//   (이중 인코딩 3패스 처리도 그쪽에 이미 들어 있다).

import { decodeHtmlEntities } from "@repo/ai/lib/engines/sanitize";

const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK_RE = /\[([^\]]+)\]\([^)]*\)/g;
const BOLD_ITALIC_RE = /(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1/g;
const HEADING_RE = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_RE = /^\s{0,3}>\s?/gm;
const LIST_BULLET_RE = /^\s*[-*+]\s+/gm;
const HR_RE = /^\s{0,3}(?:[-*_]\s?){3,}$/gm;
const STRIKETHROUGH_RE = /~~(\S(?:.*?\S)?)~~/g;
const MULTI_BLANK_RE = /\n{3,}/g;

// 표 처리(결함감사 2026-07-30 §8): 파서가 없어 `| 제품 | 가격대 |`·`|---|---|`가
// raw로 노출됐음. 구분선 행은 삭제, 셀 행은 "셀 · 셀 · 셀" 평문으로 변환.
// ⚠️ 행 끝은 [ \t]*만 허용 — \s*$는 개행까지 삼켜 위/아래 행이 한 줄로 붙는다.
const TABLE_SEPARATOR_ROW_RE =
  /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm;
const TABLE_ROW_RE = /^[ \t]*\|(.+)\|[ \t]*$/gm;
// 절단된 excerpt 꼬리 등에서 짝 잃은 강조 토큰(`**GeForce RT`)이 남는 경우 잔여 제거.
const DANGLING_EMPHASIS_RE = /(\*{1,3}|_{2,3})/g;

/**
 * 엔티티를 푼 **뒤에** 드러날 수 있는 HTML 태그.
 *
 * 🔬 실측(2026-08-10): 저장된 회차에 `&lt;` 는 **0건**이라 지금은 해당 없다.
 *   그래도 두는 이유 — 디코딩을 새로 넣었으므로 `&lt;b&gt;` 가 들어오면 이제
 *   `<b>` 로 **복원**된다. 그때 이 그물이 없으면 화면에 태그가 글자로 보인다
 *   (세션N-13 이 잡았던 바로 그 결함의 재발 경로다).
 * ⚠️ 태그 사이 경계는 `sanitize.ts` 와 달리 **공백으로 벌리지 않는다** — excerpt 는
 *   이미 정제를 거친 텍스트라 `<b>조선</b><b>미녀</b>` 같은 분할이 남아 있지 않다.
 */
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;

/**
 * 마크다운 기호를 제거해 평문으로 만든다(내용은 보존).
 * 링크·이미지는 표시 텍스트만 남기고, 강조/제목/인용/구분선 기호는 제거.
 */
export function stripMarkdown(input: string): string {
  if (!input) {
    return input;
  }
  return (
    // 🔴 **엔티티를 가장 먼저 푼다.** 순서가 뒤바뀌면 `&#42;&#42;굵게&#42;&#42;` 처럼
    //   인코딩된 마크다운을 못 잡고, `&lt;b&gt;` 도 태그로 복원되지 않는다
    //   (`sanitize.ts` 가 실측으로 확립한 순서와 동일하게 맞춘다).
    decodeHtmlEntities(input)
      // 디코딩으로 드러난 태그를 지운다(코드펜스보다 먼저 — 태그는 서식이 아니다).
      .replace(HTML_TAG_RE, "")
      .replace(CODE_FENCE_RE, (m) => m.replace(/```/g, "").trim())
      .replace(IMAGE_RE, "")
      .replace(LINK_RE, "$1")
      .replace(INLINE_CODE_RE, "$1")
      .replace(BOLD_ITALIC_RE, "$2")
      .replace(STRIKETHROUGH_RE, "$1")
      .replace(TABLE_SEPARATOR_ROW_RE, "")
      .replace(TABLE_ROW_RE, (_m, cells: string) =>
        cells
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
          .join(" · ")
      )
      .replace(HEADING_RE, "")
      .replace(BLOCKQUOTE_RE, "")
      .replace(HR_RE, "")
      .replace(LIST_BULLET_RE, "• ")
      // 짝 맞는 강조는 위에서 이미 언랩됨 — 여기 남은 *·**는 절단 등으로 짝을 잃은 토큰.
      .replace(DANGLING_EMPHASIS_RE, "")
      .replace(MULTI_BLANK_RE, "\n\n")
      .trim()
  );
}
