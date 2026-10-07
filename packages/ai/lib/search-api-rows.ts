// 검색 API 결과 행(네이버·다음) — LLM 입력 차단 가드 (2026-10-07 👤 대표 결정)
//
// 🔴 이 행들의 **원문(본문·제목·스니펫·URL·인용 도메인)은 어떤 LLM 프롬프트에도 넣지 않는다.**
//
// 근거: 네이버 검색 API 이용약관(2026-09-07 시행)은 검색 결과를 「AI 에 입력하거나 학습,
//   개선, 평가 및 노출 등에 활용」하는 것을 금지한다. 카카오(다음) 검색 약관 제5조 제30호도
//   범위가 넓다. → 판정(mention-verdict)은 이미 규칙 전용이고(2e89d203), 이 파일은
//   **crew·코파일럿 챗·콘텐츠 초안·질문 설계** 등 나머지 LLM 프롬프트 조립 지점이
//   같은 규칙을 한 곳에서 쓰게 하는 공용 가드다.
//
// 허용되는 것: 엔진별 **건수**(측정·실패·노출·정확 노출) — `summarizeSearchApiRows`.
//   글자(제목·스니펫·URL·도메인)는 하나도 담지 않는다.
//
// ⚠️ 의존성 없는 가벼운 모듈로 둔다 — `@repo/audit`·apps 가 LLM SDK 를 싣지 않고도 import 한다.
//   (`@repo/audit/answer-buckets` 의 SEARCH_EXPOSURE_ENGINES 와 같은 집합 — ai 가 audit 를
//    역의존할 수 없어 여기 둔다.)

/** 검색 API 결과 원문을 담는 엔진. `naver-briefing`(AI 브리핑)은 여기 속하지 않는다. */
export const SEARCH_RESULT_ENGINE_IDS: ReadonlySet<string> = new Set([
  "naver",
  "daum",
]);

export function isSearchResultEngine(
  engineId: string | null | undefined
): boolean {
  return (
    engineId !== undefined &&
    engineId !== null &&
    SEARCH_RESULT_ENGINE_IDS.has(engineId)
  );
}

/**
 * LLM 프롬프트를 만들기 **직전에** 반드시 통과시키는 필터 — 네이버·다음 행을 뺀다.
 * 엔진 응답·추적 행·저장된 결과 행 등 `engineId` 를 가진 어떤 행에도 쓴다.
 */
export function withoutSearchApiRows<
  T extends { engineId?: string | null | undefined },
>(rows: readonly T[] | null | undefined): T[] {
  if (!rows) {
    return [];
  }
  return rows.filter((row) => !isSearchResultEngine(row?.engineId));
}

/** 집계 입력 — 글자 필드를 받지 않는다(타입으로도 원문이 새지 않게). */
export interface SearchApiRowLike {
  brandMentioned?: boolean | null;
  engineId?: string | null;
  errorMessage?: string | null;
  isStub?: boolean | null;
  mentionQuality?: string | null;
}

/** 검색 엔진 1곳의 건수 요약. 숫자와 엔진 ID 만 담는다. */
export interface SearchApiRowSummary {
  /** 이름이 검색 결과에 나오고 규칙 판정이 「같은 회사」로 확정한 건수. */
  confirmed: number;
  engineId: string;
  /** 정상 측정 중 브랜드 이름이 검색 결과에 나온 건수. */
  exposed: number;
  /** 오류·스텁으로 측정 못 한 건수. */
  failed: number;
  /** 정상 측정 건수(분모). */
  measured: number;
}

/**
 * 네이버·다음 행을 **엔진별 건수로만** 접는다. 제목·스니펫·URL·도메인은 버린다.
 * 검색 행이 아닌 행은 무시한다.
 */
export function summarizeSearchApiRows(
  rows: readonly SearchApiRowLike[] | null | undefined
): SearchApiRowSummary[] {
  const byEngine = new Map<string, SearchApiRowSummary>();
  for (const row of rows ?? []) {
    const engineId = row?.engineId;
    if (!(engineId && isSearchResultEngine(engineId))) {
      continue;
    }
    const s = byEngine.get(engineId) ?? {
      engineId,
      measured: 0,
      failed: 0,
      exposed: 0,
      confirmed: 0,
    };
    if (row.errorMessage || row.isStub) {
      s.failed += 1;
    } else {
      s.measured += 1;
      if (row.brandMentioned) {
        s.exposed += 1;
        if (row.mentionQuality === "confirmed") {
          s.confirmed += 1;
        }
      }
    }
    byEngine.set(engineId, s);
  }
  return [...SEARCH_RESULT_ENGINE_IDS].flatMap((id) => {
    const s = byEngine.get(id);
    return s ? [s] : [];
  });
}

const SEARCH_ENGINE_LABEL: Record<string, string> = {
  naver: "네이버 검색",
  daum: "다음 검색",
};

/** 건수 요약을 프롬프트용 평문으로. 숫자만 들어간다. */
export function formatSearchApiRowSummary(
  summary: readonly SearchApiRowSummary[]
): string {
  if (summary.length === 0) {
    return "(네이버·다음 검색 측정 없음)";
  }
  return summary
    .map(
      (s) =>
        `- ${SEARCH_ENGINE_LABEL[s.engineId] ?? s.engineId}: 정상 측정 ${s.measured}건 중 이름 노출 ${s.exposed}건 · 같은 회사 확정 노출 ${s.confirmed}건 (측정 실패 ${s.failed}건)`
    )
    .join("\n");
}

/**
 * 인용 도메인 상위 집계 — **검색 행을 뺀 뒤** 센다. 검색 결과 링크의 도메인은
 * 검색 결과의 일부라 LLM 에 넣지 않는다.
 */
export function topCitedDomainsWithoutSearchRows(
  rows:
    | readonly {
        citedSources?: readonly { domain?: string | null }[] | null;
        engineId?: string | null;
      }[]
    | null
    | undefined,
  limit: number
): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of withoutSearchApiRows(rows)) {
    for (const source of row.citedSources ?? []) {
      const domain = source?.domain;
      if (domain) {
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}
