/**
 * 재측정 알림을 **보낼 만한가** 판정 (투두 #68, 2026-08-08 세션N-11).
 *
 * 🔒 설계 원칙 — "변화가 있을 때만 보낸다":
 *   변화 없는 메일이 반복되면 스팸으로 학습되어, 정작 중요한 알림도 열리지 않는다.
 *   메일이 도착한 것 자체가 "볼 이유가 있다"는 신호여야 한다.
 *   (유료가 이겨야 할 축 = 시간·비교·**알림**. 알림의 상품성은 정확도에서 나온다.)
 *
 * 🔴 거짓 경보를 막는 두 가지 방어:
 *   1. **고장난 회차 제외** — `status=completed` 인데 28엔진이 전부 error 인 job 이
 *      실재한다(2026-07-29 nike.com). 그걸 기준으로 비교하면 "점수 급락" 메일이 나간다.
 *      → 비교 대상은 `isUsableRun` 을 통과한 회차만(`buildAuditHistory` 가 이미 걸러준다).
 *   2. **잡음 무시** — 엔진 응답은 같은 조건에서도 1~2점 흔들린다. 그 정도로 메일을
 *      보내면 "또 별 일 아닌 메일"이 된다 → 임계값 미만은 변화로 보지 않는다.
 *
 * ⚠️ 순수 함수 — DB·시각·env 에 의존하지 않는다(테스트 가능).
 */

/**
 * 알림을 보낼 최소 점수 변화(절대값, 점).
 *
 * 왜 3점인가: GEO 총점은 100점 만점이고 엔진 28개의 언급 여부가 주 성분이라
 *   엔진 1개가 흔들리면 대략 1~2점이 움직인다. 3점이면 "엔진 2개 이상이 바뀌었다"에
 *   해당해 사람이 볼 가치가 있는 최소 단위다.
 * ⚠️ 실측 데이터가 얇다(측정 2회·시계열 1일) → **추정값**이다. 측정이 5~6회 쌓이면
 *   실제 회차간 표준편차를 보고 재조정할 것.
 */
export const DIGEST_MIN_DELTA_POINTS = 3;

export interface DigestCandidate {
  readonly brandName: string;
  /** 직전 대비 변화. 비교 대상이 없으면(첫 측정) null. */
  readonly deltaPoints: number | null;
  /** 이번 측정 총점. 계산 실패면 null. */
  readonly score: number | null;
}

export interface DigestEntry {
  readonly brandName: string;
  readonly deltaPoints: number;
  readonly score: number;
}

/**
 * 후보들 중 **알릴 가치가 있는 것만** 골라, 변화가 큰 순으로 돌려준다.
 * 빈 배열이면 발송하지 않는다(= 조용한 주).
 *
 * @param minDelta 테스트 주입용. 기본값 `DIGEST_MIN_DELTA_POINTS`.
 */
export function selectDigestEntries(
  candidates: readonly DigestCandidate[],
  minDelta: number = DIGEST_MIN_DELTA_POINTS
): DigestEntry[] {
  const entries: DigestEntry[] = [];
  for (const c of candidates) {
    // 첫 측정(비교 대상 없음)은 "변화"가 아니다 — 알림 대상이 아니다.
    if (c.deltaPoints === null || c.score === null) {
      continue;
    }
    if (Math.abs(c.deltaPoints) < minDelta) {
      continue;
    }
    entries.push({
      brandName: c.brandName,
      deltaPoints: c.deltaPoints,
      score: c.score,
    });
  }
  // 큰 변화 우선(미리보기 줄에 가장 중요한 것이 오도록).
  entries.sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints));
  return entries;
}
