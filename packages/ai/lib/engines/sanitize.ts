/**
 * 엔진 응답 텍스트 정제 — **화면에 나가는 모든 텍스트의 단일 진실** (2026-08-10 세션N-13).
 *
 * 🔴 **왜 만들었나(전수감사 실측)**: 저장된 응답 1,779건을 검사했더니
 *   화면에 그대로 나가는 텍스트가 오염돼 있었다.
 *
 *   | 오염 | 건수 | 엔진 |
 *   |---|---|---|
 *   | HTML 엔티티(`&#39;` `&#34;`) | **868회** | daum, naver-briefing |
 *   | 마크다운 링크 잔재 | 32건 | perplexity·hyperclova·gemini·claude |
 *   | 네이버 UI 찌꺼기 | 6건 | naver-briefing |
 *   | HTML 태그(`<br>`) | 2건 | perplexity |
 *
 *   `It&#39;s On` 같은 문자열이 고객 화면에 그대로 렌더됐다.
 *
 * 🔬 **왜 새 라이브러리를 안 썼나**: 실제 등장 엔티티는 **3종뿐**이었다
 *   (`&#39;` 610회 · `&#34;` 257회 · `&amp;` 1회). `html-entities`(2,231개 지원)는
 *   과잉이라 의존성만 늘린다. 대신 **숫자형은 코드포인트로 전량 처리**해 미래 값도 커버한다.
 *
 * 🔴 **순서가 중요하다**: 엔티티 디코딩 → 태그 제거 → 마크다운 정리 → 공백 정리.
 *   예전 `stripHtml` 은 세 가지가 틀렸다 —
 *     ① 태그를 **먼저** 지워 `&lt;b&gt;` 를 처리 못 했고,
 *     ② 엔티티를 **공백으로 치환**해 `It&#39;s` → `It s` 로 글자를 망가뜨렸고,
 *     ③ `/&[a-z]+;/` 라 **숫자형(`&#39;`)을 아예 못 잡았다**(868회 통과).
 */

/** 숫자형 엔티티(`&#39;` `&#x27;`) — 코드포인트로 복원하므로 미래 값도 커버된다. */
const NUMERIC_ENTITY_RE = /&#(x[0-9a-f]+|\d+);/gi;

/**
 * 명명형 엔티티 — 실측 등장분(`&amp;`) + HTML 에서 의미가 있어 반드시 다뤄야 하는 것들.
 * ⚠️ `&amp;` 는 **마지막에** 풀어야 한다. 먼저 풀면 `&amp;lt;` 가 `&lt;` 가 되어
 *   다음 단계에서 `<` 로 바뀌고, 원래 글자였던 것이 태그로 오인된다(이중 인코딩 함정).
 */
const NAMED_ENTITIES: [RegExp, string][] = [
  [/&nbsp;/gi, " "],
  [/&quot;/gi, '"'],
  [/&apos;/gi, "'"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&amp;/gi, "&"],
];

/** HTML 태그. 정제 순서상 엔티티 디코딩 **뒤에** 적용한다. */
const TAG_RE = /<[^>]*>/g;

/**
 * **닫는 태그 바로 뒤에 여는 태그가 오는 경계** — `</b><b>` 처럼 맞붙은 자리.
 *
 * 🔴 **왜 필요한가**(2026-08-10 세션N-14, 카카오 검색 API 라이브 실측):
 *   카카오·네이버는 검색어와 겹치는 부분에만 `<b>` 를 씌우는데, **브랜드명을 토큰 단위로
 *   쪼개서** 각각 감싼다:
 *
 *   > `“마뗑킴·<b>조선</b><b>미녀</b>…소상공인 유망 제품…”`
 *
 *   태그를 **공백으로** 치환하면(`TAG_RE` 의 기본 동작) `조선 미녀` 가 되어
 *   **브랜드명 "조선미녀" 가 통째로 사라진다.**
 *   실측: `조선미녀` 검색 결과 **10건 중 9건**에서 브랜드가 이렇게 소실됐다
 *   (설화수·메디큐브·올리브영은 한 덩어리라 0건 — 그래서 지금껏 안 보였다).
 *
 *   영향은 표시에 그치지 않는다. `detectBrandMention`·`estimateShareOfVoice` 가
 *   **정제된 텍스트로 판정**하므로, 브랜드가 실려 있는 문서를 **미언급으로 오판**해
 *   점수를 낮추고 있었다(=daum 언급률이 유독 낮았던 원인 중 하나).
 *
 * ⚠️ **공백 치환 자체는 바꾸면 안 된다** — `A<br>B` 를 `AB` 로 붙이면 단어가 뭉친다.
 *   그래서 태그를 **일괄로** 지우는 대신, **맞붙은 태그 경계만** 먼저 없앤다.
 *   원래 공백이 있던 자리(`</b> <b>`)는 캡처해서 **그대로 보존**한다.
 */
const ADJACENT_TAG_BOUNDARY_RE = /<\/[a-z][^>]*>(\s*)<[a-z][^>]*>/gi;
/** 창 경계에서 잘린 미종결 태그 꼬리(`<div class="sds-…`) — 통째로 버린다. */
const UNTERMINATED_TAG_TAIL_RE = /<[^>]*$/;
const WHITESPACE_RE = /[^\S\n]+/g;
const BLANK_LINES_RE = /\n{3,}/g;

/**
 * 마크다운 링크 `[표시문구](url)` → `표시문구`.
 *
 * 🔬 실측 32건(perplexity·hyperclova·gemini·claude). LLM 이 답변에 링크를 섞어 보내는데
 *   화면은 평문으로 렌더하므로 URL 이 그대로 노출된다. **표시 문구만 남긴다.**
 *   ⚠️ 인용 출처는 `citedSources` 에 따로 저장되므로 여기서 URL 을 버려도 정보 손실이 없다.
 */
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
/** 표시문구 없이 URL 만 있는 형태 `[](url)`. */
const BARE_MARKDOWN_LINK_RE = /\[\s*\]\((https?:\/\/[^)\s]+)\)/g;
/**
 * **잘린** 마크다운 링크 — 닫는 `)` 가 없다.
 *
 * 🔬 실측 5건(perplexity): 응답이 길이 제한에 잘려
 *   `[Tistory 4](https://shopingitem.tistory.com/entry/%ED%94%84…` 로 끝난다.
 *   위 정규식은 `)` 를 요구해 못 잡고, **URL 이 화면 끝에 그대로 노출**된다.
 *   → 표시 문구만 남기고 잘린 URL 은 버린다.
 */
const TRUNCATED_MARKDOWN_LINK_RE = /\[([^\]]+)\]\(https?:\/\/[^)\s]*$/;

/**
 * 이중 인코딩(`&amp;#39;`) 해소를 위한 최대 반복 횟수.
 *
 * 🔬 실측(2026-08-10): naver-briefing 응답에 `It&amp;#39;s On` 이 실재했다
 *   — 네이버 HTML 이 이미 인코딩된 문자열을 한 번 더 인코딩해 보낸다.
 *   1패스만 하면 `&#39;` 가 남아 **화면에 코드가 그대로 보인다**.
 * ⚠️ 상한을 두는 이유: 사용자 원문이 진짜로 `&amp;amp;` 를 담고 있을 수 있어
 *   무한히 풀면 **원문을 훼손**한다. 실측상 2중이 최대라 3이면 충분하다.
 */
const MAX_DECODE_PASSES = 3;
/** 아직 풀 게 남았는가(반복 종료 판정). */
const ANY_ENTITY_RE = /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/i;

function decodeOnce(input: string): string {
  let text = input.replace(NUMERIC_ENTITY_RE, (_m, code: string) => {
    const n = code.toLowerCase().startsWith("x")
      ? Number.parseInt(code.slice(1), 16)
      : Number.parseInt(code, 10);
    // 제어문자·비정상 코드포인트는 버린다(그대로 넣으면 화면이 깨진다).
    if (!Number.isFinite(n) || n < 0x20 || n > 0x10_ff_ff) {
      return "";
    }
    try {
      return String.fromCodePoint(n);
    } catch {
      return "";
    }
  });
  for (const [re, ch] of NAMED_ENTITIES) {
    text = text.replace(re, ch);
  }
  return text;
}

/** HTML 엔티티를 실제 문자로 되돌린다(치환이 아니라 **디코딩**). 이중 인코딩도 푼다. */
export function decodeHtmlEntities(input: string): string {
  let text = input;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    const next = decodeOnce(text);
    // 더 안 바뀌거나 남은 엔티티가 없으면 종료(불필요한 패스로 원문을 건드리지 않는다).
    if (next === text || !ANY_ENTITY_RE.test(next)) {
      return next;
    }
    text = next;
  }
  return text;
}

/**
 * 화면에 내보낼 수 있는 상태로 정제한다.
 *
 * 순서: 엔티티 디코딩 → 미종결 태그 꼬리 제거 → 태그 제거 → 마크다운 링크 평문화 → 공백 정리.
 */
export function sanitizeEngineText(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return (
    decodeHtmlEntities(input)
      .replace(UNTERMINATED_TAG_TAIL_RE, "")
      // 🔴 태그를 공백으로 지우기 **전에** 맞붙은 태그 경계를 없앤다.
      //   `<b>조선</b><b>미녀</b>` → `<b>조선미녀</b>` → `조선미녀`
      //   (순서가 뒤바뀌면 이미 `조선 미녀` 가 되어 되돌릴 수 없다.)
      .replace(ADJACENT_TAG_BOUNDARY_RE, "$1")
      .replace(TAG_RE, " ")
      .replace(BARE_MARKDOWN_LINK_RE, "")
      .replace(MARKDOWN_LINK_RE, "$1")
      // 잘린 링크는 **완전한 링크를 처리한 뒤** 마지막에(그전엔 문장 끝이 아닐 수 있다).
      .replace(TRUNCATED_MARKDOWN_LINK_RE, "$1")
      .replace(WHITESPACE_RE, " ")
      .replace(BLANK_LINES_RE, "\n\n")
      .trim()
  );
}
