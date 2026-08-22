/**
 * 「진실의 거울」 — `Tracking` → 화면 입력 어댑터 (2026-08-17 세션N-37 · v4 탭7).
 *
 * 🔴 **왜 어댑터가 필요한가**: 같은 화면이 web 에는 있는데 앱에는 없었다.
 *   web 판(`apps/web/.../truth-mirror.tsx`)은 `AuditJob.result` 의 `engineResponses` 를
 *   읽고, 앱은 `Tracking` 행을 읽는다 — **형상이 다르다.**
 *
 * ⭐ 왜 이 화면을 앱에 옮기는가: 경쟁사 4곳 실측에서 **Otterly 만 유사 기능**을 갖고 있다
 *   (`reference_geo_competitor_screens_4` §가져올것 ⑥). 우리 무기다.
 *
 * 🔴🔴 **v4 가 경고한 함정 — `Tracking` 에는 `isStub` 이 없다.**
 *   web 판은 `isStub` 으로 *"AI 가 우리를 모른다"* 와 *"아직 측정 안 함"* 을 갈랐다.
 *   앱에는 그 필드가 **아예 없다**(스키마 실측). → **만들어내지 않는다.**
 *   대신 실제로 있는 것만 쓴다:
 *     · `errorMessage != null` → **측정 실패**(모른다가 아니다 — 별도 고지)
 *     · 행 자체가 없는 엔진 → **측정 대상이 아니었다**(화면에 등장시키지 않는다)
 *   ⚠️ 없는 축을 지어내면 그게 날조다. 구분이 하나 줄어든 것을 **숨기지 않고 그대로** 둔다.
 *
 * 🔴 **채널을 지목하지 않는다** — `citedSources` 는 Tracking 에 있지만, 이 화면은
 *   "AI 가 뭐라 했나"를 보여주는 자리다. 출처 분석은 `/sources` 가 담당한다(중복 금지).
 */

/** 어댑터 입력 — `scopedLatestRunTracking()` 행의 부분집합. */
/**
 * 🔴 브리핑은 **질의 축이 다르다**(N-45 · #4-b). 「같은 질문에 몇 곳이 답했나」를
 *   세는 분모에서는 빼야 한다. 📕 `브리핑_본류편입_기획_2026-08-17.md` §2·§5-c
 */
const BRIEFING_ENGINE_ID = "naver-briefing";

export interface TruthMirrorRowInput {
  brandMentioned: boolean;
  engineId: string;
  errorMessage: string | null;
  mentionPosition: number | null;
  rawResponse: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
}

/** 화면이 카드 하나를 그리는 데 필요한 것. */
export interface TruthMirrorEngine {
  brandMentioned: boolean;
  engineId: string;
  /** 측정 실패 사유. 있으면 "모른다"가 아니라 **못 물어봤다**로 표시해야 한다. */
  errorMessage: string | null;
  /** 답변 원문에서 뽑은 발췌. 원문이 없으면 빈 문자열. */
  excerpt: string;
  mentionPosition: number | null;
  sentiment: "positive" | "neutral" | "negative" | null;
}

export interface TruthMirrorData {
  /** 답을 받은 엔진(오류 제외). 화면이 카드로 그린다. */
  engines: TruthMirrorEngine[];
  /** 측정은 됐으나 오류로 답을 못 받은 엔진 수. 분모에서 뺀다. */
  erroredCount: number;
  /** 우리를 말한 엔진 수. `known / measuredCount` 가 이 화면의 분모 축이다.
   *  ⚠️ 이 분모에는 **브리핑이 들어가지 않는다**(질의 축이 달라서 — 아래 참조). */
  knownCount: number;
  measuredCount: number;
}

/** 발췌 길이 — 카드가 스크롤 없이 읽히는 선. web 판과 같은 값. */
const EXCERPT_LIMIT = 280;

/**
 * 답변 원문에서 발췌를 만든다.
 * ⚠️ 마크다운 제거는 화면(클라이언트)에서 한다 — 여기서 하면 `@repo/audit` 를
 *   서버 번들에 끌어와 Storybook 이 깨진다(N-37 에 실제로 겪었다).
 */
function toExcerpt(raw: string | null): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim();
  return trimmed.length > EXCERPT_LIMIT
    ? `${trimmed.slice(0, EXCERPT_LIMIT)}…`
    : trimmed;
}

/**
 * 한 엔진이 여러 프롬프트에 답했으면 **대표 1건**으로 접는다.
 *
 * 🔴 고르는 규칙(자의적이지 않게): ① 우리를 말한 답변 우선 → ② 그 중 순위가 앞선 것 →
 *   ③ 원문이 긴 것. *"AI 가 우리를 아는가"* 를 보는 화면이라 **아는 증거를 대표로** 세운다.
 *   ⚠️ 아무거나 첫 행을 쓰면 같은 데이터로도 화면이 매번 달라진다(재현 불가).
 */
function pickRepresentative(rows: TruthMirrorRowInput[]): TruthMirrorRowInput {
  return [...rows].sort((a, b) => {
    if (a.brandMentioned !== b.brandMentioned) {
      return a.brandMentioned ? -1 : 1;
    }
    const ap = a.mentionPosition ?? Number.POSITIVE_INFINITY;
    const bp = b.mentionPosition ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) {
      return ap - bp;
    }
    return (b.rawResponse?.length ?? 0) - (a.rawResponse?.length ?? 0);
  })[0];
}

/**
 * `Tracking` 행 → 진실의 거울 입력.
 *
 * @returns 답변이 하나도 없으면 `null`(화면이 섹션 자체를 렌더하지 않는다 —
 *   빈 카드를 그리면 *"AI 가 아무 말도 안 했다"* 는 거짓 신호가 된다).
 */
export function buildTruthMirrorData(
  rows: TruthMirrorRowInput[]
): TruthMirrorData | null {
  if (rows.length === 0) {
    return null;
  }

  const byEngine = new Map<string, TruthMirrorRowInput[]>();
  for (const row of rows) {
    const list = byEngine.get(row.engineId);
    if (list) {
      list.push(row);
    } else {
      byEngine.set(row.engineId, [row]);
    }
  }

  const engines: TruthMirrorEngine[] = [];
  let erroredCount = 0;
  for (const [engineId, group] of byEngine) {
    // 🔴 오류는 "모른다"가 아니다 — 그 엔진의 **모든** 행이 실패했을 때만 실패로 센다
    //   (한 프롬프트만 실패하고 다른 건 답했으면 그 엔진은 답한 것이다).
    const answered = group.filter((r) => !r.errorMessage);
    if (answered.length === 0) {
      erroredCount += 1;
      continue;
    }
    const rep = pickRepresentative(answered);
    engines.push({
      brandMentioned: rep.brandMentioned,
      engineId,
      errorMessage: null,
      excerpt: toExcerpt(rep.rawResponse),
      mentionPosition: rep.mentionPosition,
      sentiment: rep.sentiment,
    });
  }

  if (engines.length === 0) {
    return null;
  }

  // 분모 = **답을 받은 엔진 수**(오류 제외). `reference_findable_traps` 의 분모 축 규율.
  engines.sort((a, b) => {
    if (a.brandMentioned !== b.brandMentioned) {
      return a.brandMentioned ? -1 : 1;
    }
    return a.engineId.localeCompare(b.engineId);
  });

  /**
   * 🔴 **브리핑은 분모에서 뺀다**(N-45 · #4-b B-5).
   * 📕 기획서 §5-c: *"분모를 섞지 않는다 — 브리핑 1/1 을 7엔진 등장률 평균에 넣으면
   *   축이 섞인다"* · §2: *"질문이 다르므로 분모도 다르다"*.
   *
   * 브리핑은 **다른 질문**(효과·후기·장단점)을 던진다. 「측정한 AI 8곳 중 N곳」처럼
   * 같은 분모에 세우면 *"AI 8곳에 같은 걸 물었다"* 로 읽힌다 — 사실이 아니다.
   * 📕 N-30 *"축이 다른 두 숫자를 나란히 두면 검산하려 든다"*.
   *
   * ⚠️ **화면에서 빼는 게 아니다** — 카드는 그대로 나오고 자기 축(질의 안내)을 단다.
   *   빠지는 건 **숫자 문장의 분모**뿐이다.
   */
  const mainAxis = engines.filter((e) => e.engineId !== BRIEFING_ENGINE_ID);

  return {
    engines,
    erroredCount,
    knownCount: mainAxis.filter((e) => e.brandMentioned).length,
    measuredCount: mainAxis.length,
  };
}
