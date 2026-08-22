/**
 * "평균 몇 위" 표기 — **단일 진실**.
 *
 * 🔴 왜 패키지로 뺐나 (S7-3차 · 2026-08-12):
 *   같은 결과 페이지 안에서 순위를 **두 가지 방식**으로 말하고 있었다.
 *     · 상단 KPI      → `4번째 · 평균 12개 중 · 19개 응답 평균`  (분모·표본 밝힘)
 *     · 네이버 격차 카드 → `· 평균 3.2위`                        (맨 숫자)
 *   **"3.2위"는 목록이 5개일 때와 50개일 때 뜻이 완전히 다르다.** 한쪽은 분모를
 *   밝히고 한쪽은 감추니, 고객이 두 숫자를 나란히 보면 어느 쪽을 믿어야 할지 모른다.
 *
 * 🔒 규칙: **계산은 한 곳, 표시층만 분리한다.** 화면마다 평균을 다시 내면 언젠가
 *   어긋난다(감사 §10 "3중 복제"와 같은 함정 · `audit-result.tsx:1334` 주석 참조).
 *   이 파일은 **표기만** 담당하고 평균값 자체는 호출부가 넘긴다.
 *
 * ⚠️ **분모가 안 보여도 버그가 아니다** (2026-08-12 라이브 실측):
 *   샘플 회차(`d732a13a…`)는 29개 응답 **전부 `mentionListSize` 가 null** 이라
 *   두 표기 모두 `평균 1.3위` 로만 나온다. 분모는 AI 답변이 **번호 매긴 목록**일 때만
 *   추출되고(`estimateMentionPosition`), **세션N-10 이전 측정분은 소급 적용이 없다**
 *   (`packages/ai/lib/engines/index.ts:162`). 즉 **없으면 감추는 게 정상 동작**이다.
 *   → 화면에서 분모가 안 보인다고 이 파일을 "고치지" 말 것. 고칠 대상은 수집 쪽이다.
 */

export interface RankLabelInput {
  /** 평균 순위(1-base). null 이면 순위를 낼 근거가 없다. */
  averagePosition: number | null;
  /** AI 답변 목록의 평균 크기(분모). null 이면 분모 표기를 생략한다. */
  listSize?: number | null;
  /** 평균에 들어간 응답 수(표본). 0·null 이면 표본 표기를 생략한다. */
  sampleCount?: number | null;
}

/**
 * 짧은 표기 — 카드 안 인라인용(예: 네이버 격차 카드).
 * `평균 3.2위 (12개 중)` · 분모를 모르면 `평균 3.2위`.
 *
 * ⚠️ 분모를 **지어내지 않는다.** 없으면 숫자만 말하고 조용히 넘어간다
 *   (없는 근거를 만들어 붙이는 것이 더 나쁘다).
 */
export function shortRankLabel(
  input: RankLabelInput,
  isKo: boolean
): string | null {
  const { averagePosition, listSize } = input;
  if (averagePosition === null) {
    return null;
  }
  if (listSize === null || listSize === undefined) {
    return isKo ? `평균 ${averagePosition}위` : `avg #${averagePosition}`;
  }
  return isKo
    ? `평균 ${averagePosition}위 (${listSize}개 중)`
    : `avg #${averagePosition} of ~${listSize}`;
}

/**
 * 긴 표기 — KPI 셀의 보조 라벨용(값은 별도 슬롯에 크게 찍히므로 여기엔 순위 숫자를 넣지 않는다).
 * `평균 12개 중 · 19개 응답 평균`
 */
export function detailedRankLabel(
  input: RankLabelInput,
  isKo: boolean
): string {
  const { listSize, sampleCount } = input;
  const parts: string[] = [];

  if (listSize === null || listSize === undefined) {
    parts.push(isKo ? "AI 답변 목록에서 우리 자리" : "POSITION IN AI'S LIST");
  } else {
    parts.push(isKo ? `평균 ${listSize}개 중` : `OF ~${listSize} LISTED`);
  }

  if (sampleCount) {
    parts.push(isKo ? `${sampleCount}개 응답 평균` : `AVG OF ${sampleCount}`);
  }

  return parts.join(" · ");
}
