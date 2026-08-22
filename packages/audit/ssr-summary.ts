/**
 * 진단 결과 **요약부**(서버 렌더용) 구성 — S5 · 2026-08-11 세션N-19.
 *
 * ## 🔴 왜 패키지로 뺐나
 * 요약을 그리는 화면은 `apps/web` 인데 **거기엔 테스트 러너가 없다**(vitest 미설치).
 * 개인정보 유출 금지·"잰 것만 말한다" 같은 **규칙은 반드시 테스트로 고정**해야 하므로
 * 순수 함수만 이 패키지로 빼고 `apps/app/__tests__` 에서 검증한다
 * (같은 저장소의 `measurement-coverage`·`digest-filter` 가 이미 이 패턴이다).
 *
 * ## 🔒 개인정보 — 이 함수는 이메일을 **받지도, 내보내지도 않는다**
 * 이 요약은 서버에서 **쿼리스트링과 무관하게 항상** 렌더된다. 반면 기존 "공유 뷰에서
 * 이메일 숨김" 판정은 `window.location.search` 를 읽는 **클라이언트** 로직이라
 * 서버에서는 쓸 수 없다. → **구조적으로 유출이 불가능하게** 입력에서 배제했다.
 *
 * ## 🔴 숫자를 새로 계산하지 않는다
 * 저장된 값을 **그대로** 옮긴다. 여기서 산식을 만들면 클라이언트 화면과 숫자가 갈리고,
 * 그건 S0 에서 고친 "숫자가 서로를 반박하는" 결함의 재발이다.
 *
 * ⚠️ 필드명은 **라이브 API 응답으로 실측**했다(2026-08-11 · 추정 아님):
 *   `brandName` · `metrics.sov` · `metrics.enginesCovered`(**중복 포함 응답 목록**) ·
 *   `metrics.enginesWithMention` · `geoActions[].title`.
 *   ⛔ `geoScore`·`metrics.recognitionRate` 는 **실측 회차에 없었다**(null) → 쓰지 않는다.
 */

/** 요약에 쓰는 필드만 좁힌 타입. 이 외 필드는 일부러 보지 않는다. */
export interface SsrSummaryInput {
  domain: string;
  result: unknown;
  status: string;
}

export interface SsrSummary {
  /** 처방 제목들. 비어 있을 수 있다. */
  actionTitles: string[];
  brand: string;
  domain: string;
  /** 우리를 언급한 고유 엔진 수. */
  engineMentioned: number;
  /** 측정된 고유 엔진 수. 0이면 요약을 만들지 않는다. */
  engineTotal: number;
  /** 등장률(0~100). 저장값이 없으면 null — **0으로 대체하지 않는다**. */
  sov: number | null;
}

interface ResultShape {
  brandName?: unknown;
  geoActions?: unknown;
  metrics?: {
    enginesCovered?: unknown;
    enginesWithMention?: unknown;
    sov?: unknown;
  } | null;
}

/** 고유 개수. `enginesCovered` 는 응답 목록이라 같은 엔진이 여러 번 들어 있다. */
function uniqueCount(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return new Set(value.filter((v): v is string => typeof v === "string")).size;
}

/**
 * 요약을 만든다. **만들 수 없으면 `null`** — 호출부는 그때 아무것도 렌더하지 않는다.
 *
 * `null` 을 주는 경우(전부 의도된 것):
 *  - 아직 완료 전(폴링 중 화면은 클라이언트가 그린다)
 *  - `result` 가 없거나 형태가 아님
 *  - 🔴 **측정된 엔진이 0개** — 규칙 "잰 것만 말한다". 0을 점수처럼 내보내면
 *    "못 잼"을 "0점"이라 부르는 기존 결함(measurement-coverage 가 막은 것)의 재발이다.
 */
export function buildSsrSummary(job: SsrSummaryInput): SsrSummary | null {
  if (job.status !== "completed") {
    return null;
  }
  const result = job.result as ResultShape | null;
  if (!result || typeof result !== "object") {
    return null;
  }

  const engineTotal = uniqueCount(result.metrics?.enginesCovered);
  if (engineTotal === 0) {
    return null;
  }

  const rawSov = result.metrics?.sov;
  const brandName =
    typeof result.brandName === "string" ? result.brandName.trim() : "";
  const actionTitles = Array.isArray(result.geoActions)
    ? result.geoActions
        .filter((a) => {
          // 🐛 스크린샷 눈확인에서 잡음(2026-08-11): "지금 할 일" 이라는 제목 아래에
          //   **할 일이 아닌 것**이 섞여 있었다 — 실측 `kind` 값:
          //     `avoid` = *"이건 하지 마세요 — 효과가 없거나 역효과입니다"*
          //     `rank_strategy` = *"이미 1순위 — 지금은 방어가 낫습니다"*
          //   둘 다 **행동 지시가 아니라 판단·경고**다. 제목과 내용이 어긋나면
          //   "버튼 이름 = 실제 동작" 규칙(Apple Responsibility)과 같은 종류의 결함이다.
          //   → 요약에는 **실제로 할 일만** 담는다. 제외한 항목은 아래 상세 화면에
          //     그대로 다 보인다(정보를 지운 게 아니라 요약의 정의를 지킨 것).
          if (!(a && typeof a === "object")) {
            return false;
          }
          const kind = (a as { kind?: unknown }).kind;
          return kind !== "avoid" && kind !== "rank_strategy";
        })
        .map((a) =>
          typeof (a as { title?: unknown }).title === "string"
            ? ((a as { title: string }).title ?? "").trim()
            : ""
        )
        .filter((t) => t.length > 0)
    : [];

  return {
    actionTitles,
    brand: brandName || job.domain,
    domain: job.domain,
    engineMentioned: uniqueCount(result.metrics?.enginesWithMention),
    engineTotal,
    sov: typeof rawSov === "number" ? rawSov : null,
  };
}
