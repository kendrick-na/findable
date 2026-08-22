/**
 * 무료진단 히스토리 — "지난번보다 나아졌나" (2026-08-07 세션N-10, 투두 #59).
 *
 * 왜 필요한가: 무료진단은 매번 **점수 하나만** 보여주고 끝났다. 같은 브랜드를 두 번 재도
 * 이전 결과와 이어지지 않아, 개선했는지 나빠졌는지 알 수 없었다.
 * 리서치 결론(유료 축 = **시간·비교·알림**)에서 "시간"의 무료판 맛보기에 해당한다.
 * ⚠️ 단 **무료에 시계열을 다 주면 안 된다** — 유료 축을 갉아먹는다.
 * → 여기서는 **직전 1회와의 비교**만 준다(전체 추세·차트는 대시보드=유료의 몫).
 *
 * 🔒 매칭 키 = **이메일 + 정규화 도메인**. 도메인만으로 매칭하면 안 된다:
 *   실측(2026-08-07) `medicube.co.kr` 한 도메인에 **이메일이 15개**였다.
 *   도메인만 쓰면 남의 진단 결과를 서로에게 보여주게 된다(개인정보 유출).
 *
 * ⚠️ 도메인 표기 흔들림: 실측에 `sulwhasoo.com`(14회)과 `www.sulwhasoo.com`(4회)이
 *   **따로** 저장돼 있다. 입력 zod 가 protocol·trailing slash 는 벗기지만 `www.` 는 남긴다.
 *   → 매칭할 때만 `www.` 를 벗겨 같은 브랜드로 본다.
 *   ⚠️ **저장값은 건드리지 않는다** — `/api/audit` 의 24h 캐시 키가 domain 이라
 *   저장 규칙을 바꾸면 캐시 동작이 함께 바뀐다(범위 밖 부작용).
 */

const WWW_PREFIX_RE = /^www\./;
const PROTOCOL_PREFIX_RE = /^https?:\/\//;
const TRAILING_SLASH_RE = /\/$/;

/**
 * 히스토리 매칭 전용 도메인 정규화.
 * 저장 시점 규칙(protocol·trailing slash·lowercase)에 **`www.` 제거**를 더한 것.
 */
export function normalizeDomainForHistory(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(PROTOCOL_PREFIX_RE, "")
    .replace(TRAILING_SLASH_RE, "")
    .replace(WWW_PREFIX_RE, "");
}

/** 히스토리 비교에 필요한 최소 형태(테스트·순수함수화를 위해 DB 타입과 분리). */
export interface HistoryCandidate {
  createdAt: Date;
  domain: string;
  id: string;
  /** geo 총점. 계산은 호출부가 geoAxisScores 로 이미 끝낸 값을 넘긴다. */
  score: number | null;
  /**
   * 이 측정이 **비교 대상으로 쓸 만한가**. false 면 직전 후보에서 제외한다.
   *
   * 🔴 실측 근거(2026-08-07): `nike.com` 의 2026-07-29 job 은 `status=completed` 인데
   *   **28개 엔진이 전부 error** 라 점수가 0이었다. 이걸 직전으로 잡으면 다음 측정이
   *   "+80점 개선" 으로 표시된다 — 개선한 게 아니라 **지난번이 고장났던 것**이다.
   *   `completed` 는 "파이프라인이 끝났다"는 뜻이지 "잘 측정됐다"가 아니다.
   */
  usable: boolean;
}

export interface AuditHistoryComparison {
  /** 직전 대비 점수 변화(양수=개선). 이전이 없으면 null. */
  deltaPoints: number | null;
  /** 직전 측정 시각(ISO). 없으면 null. */
  previousAt: string | null;
  /** 직전 측정의 jobId — "그때 결과 보기" 링크용. */
  previousJobId: string | null;
  /** 직전 측정 점수. */
  previousScore: number | null;
  /** 이 브랜드를 지금까지 몇 번 쟀나(현재 포함). 1이면 첫 측정. */
  totalRuns: number;
}

/** 이전 측정이 없을 때의 기본값(첫 진단). */
export const EMPTY_HISTORY: AuditHistoryComparison = {
  deltaPoints: null,
  previousAt: null,
  previousJobId: null,
  previousScore: null,
  totalRuns: 1,
};

/**
 * 후보 목록에서 "현재 job 의 직전 측정"을 골라 비교값을 만든다.
 *
 * @param candidates 같은 이메일의 완료 job 들(정렬 무관). 현재 job 포함 가능.
 * @param currentId  현재 보고 있는 jobId.
 * @param currentDomain 현재 job 의 domain(정규화 전 원본).
 *
 * ⚠️ 순수 함수 — DB·시각에 의존하지 않는다(테스트 가능).
 */
export function buildAuditHistory(
  candidates: HistoryCandidate[],
  currentId: string,
  currentDomain: string
): AuditHistoryComparison {
  const key = normalizeDomainForHistory(currentDomain);

  // 같은 브랜드(정규화 도메인 일치)만. 현재 job 도 totalRuns 에는 센다.
  const sameBrand = candidates.filter(
    (c) => normalizeDomainForHistory(c.domain) === key
  );
  const current = sameBrand.find((c) => c.id === currentId);

  // 현재보다 **먼저** 측정된 것 중 가장 최근 = 직전.
  //   ⚠️ "목록의 두 번째"가 아니라 시각 기준으로 고른다 — 현재 job 이 과거 결과를
  //   다시 열어본 것일 수 있어(공유 링크) 목록 순서로 고르면 미래 측정이 "직전"이 된다.
  const currentAt = current?.createdAt.getTime() ?? Number.POSITIVE_INFINITY;
  const earlier = sameBrand
    .filter(
      (c) =>
        c.id !== currentId &&
        c.createdAt.getTime() < currentAt &&
        // 측정이 망가진 회차는 건너뛴다(위 usable 주석 참고). 그 앞의 정상 측정을 찾는다.
        c.usable
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const previous = earlier.at(0);
  if (!previous) {
    return { ...EMPTY_HISTORY, totalRuns: sameBrand.length || 1 };
  }

  const currentScore = current?.score ?? null;
  const deltaPoints =
    currentScore !== null && previous.score !== null
      ? currentScore - previous.score
      : null;

  return {
    deltaPoints,
    previousAt: previous.createdAt.toISOString(),
    previousJobId: previous.id,
    previousScore: previous.score,
    totalRuns: sameBrand.length,
  };
}
