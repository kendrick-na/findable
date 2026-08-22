import type { AuditJob } from "@repo/database";

// AuditJob.result 는 Prisma Json?(=unknown). apps/web audit-result.tsx 의
// JobResult 와 동일 구조지만, 대시보드 요약에 필요한 필드만 좁은 형태로 정의하고
// 런타임 가드(typeof / Number.isFinite / Array.isArray)로 안전하게 추출한다.
interface AuditResultShape {
  brandName?: unknown;
  metrics?: {
    sov?: unknown;
    enginesCovered?: unknown;
    enginesWithMention?: unknown;
    // 1단계(2026-08-06 세션N-5): 히어로 3장용. aggregateAudit 이 이미 계산해
    // result.metrics 에 저장하던 값 — 측정·원가·마이그레이션 0.
    averageMentionPosition?: unknown;
    /** 순위의 평균 분모(세션N-10). 도입 전 job 에는 없다 → null 폴백. */
    averageMentionListSize?: unknown;
    sentimentDistribution?: unknown;
  };
}

function toResultShape(result: AuditJob["result"]): AuditResultShape | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  return result as AuditResultShape;
}

// SoV(0~100)를 정수로. 없거나 유한수 아니면 null.
export function extractSov(result: AuditJob["result"]): number | null {
  const shape = toResultShape(result);
  const sov = shape?.metrics?.sov;
  return typeof sov === "number" && Number.isFinite(sov)
    ? Math.round(sov)
    : null;
}

export function extractBrandName(result: AuditJob["result"]): string | null {
  const shape = toResultShape(result);
  const brandName = shape?.brandName;
  return typeof brandName === "string" && brandName.length > 0
    ? brandName
    : null;
}

// enginesCovered / enginesWithMention 는 프롬프트 수만큼 중복 엔진이 들어있으므로
// Set 으로 고유화한 개수를 센다. (audit-result.tsx 와 동일한 처리)
function uniqueCount(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      set.add(item);
    }
  }
  return set.size;
}

export interface EngineCoverage {
  mentioned: number;
  total: number;
}

/** 감성 분포. audit 의 sentimentDistribution 과 동일 축(긍정/중립/부정). */
export interface SentimentSummary {
  negative: number;
  neutral: number;
  positive: number;
  /** 세 값의 합. 0이면 표시하지 않는다(분모 0 방어). */
  total: number;
}

// 평균 언급 순위(1=첫 번째로 언급). 없으면 null → 카드가 "—" 로 표기.
export function extractAverageMentionPosition(
  result: AuditJob["result"]
): number | null {
  const shape = toResultShape(result);
  const position = shape?.metrics?.averageMentionPosition;
  return typeof position === "number" && Number.isFinite(position)
    ? position
    : null;
}

// 순위의 평균 분모(세션N-10). AuditJob 폴백 경로 — 위 Tracking 경로와 **쌍둥이**다.
//   ⚠️ 한쪽만 채우면 세션N-6의 "폴백만 누락" 사고가 그대로 재발한다.
export function extractAverageMentionListSize(
  result: AuditJob["result"]
): number | null {
  const shape = toResultShape(result);
  const size = shape?.metrics?.averageMentionListSize;
  return typeof size === "number" && Number.isFinite(size) && size > 0
    ? size
    : null;
}

// sentimentDistribution 은 result JSON(=unknown)이라 키별로 런타임 가드한다.
function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export function extractSentiment(
  result: AuditJob["result"]
): SentimentSummary | null {
  const shape = toResultShape(result);
  const dist = shape?.metrics?.sentimentDistribution;
  if (!dist || typeof dist !== "object") {
    return null;
  }
  const record = dist as Record<string, unknown>;
  const positive = toCount(record.positive);
  const neutral = toCount(record.neutral);
  const negative = toCount(record.negative);
  const total = positive + neutral + negative;
  // 전부 0이면 "감성 데이터 없음"과 구분이 안 되므로 null(카드가 "—").
  return total === 0 ? null : { positive, neutral, negative, total };
}

export function extractEngineCoverage(
  result: AuditJob["result"]
): EngineCoverage | null {
  const shape = toResultShape(result);
  const metrics = shape?.metrics;
  if (!metrics) {
    return null;
  }
  const total = uniqueCount(metrics.enginesCovered);
  if (total === 0) {
    return null;
  }
  return { mentioned: uniqueCount(metrics.enginesWithMention), total };
}

export interface SovTrendPoint {
  // 차트 X축 라벨 (YYYY.MM.DD)
  label: string;
  /**
   * D9(2026-08-07): 평균 언급 순위(1=첫 번째). 순위 카드 스파크라인용.
   * ⚠️ 순위가 없는 측정은 **null** — 0으로 깔면 "1등이 됐다"는 정반대 거짓 신호가 된다
   *   (positiveRate 를 null 로 두는 것과 같은 이유).
   * ⚠️ 이 지표는 **낮을수록 좋다** → 그리는 쪽이 `lowerIsBetter` 로 부호를 뒤집는다.
   */
  position: number | null;
  /**
   * 1-5(2026-08-06): 긍정 비율(0~100). 감성 데이터가 없는 측정은 null →
   * Recharts 가 그 지점만 선을 끊는다(0으로 깔면 "부정적으로 변했다"는 거짓 신호가 된다).
   */
  positiveRate: number | null;
  sov: number;
  // 정렬·툴팁용 ISO 타임스탬프
  timestamp: number;
}

/**
 * SentimentSummary → 긍정 비율(%). 없으면 null.
 *
 * 🔴 `export` 인 이유(세션N-34 감사): 같은 식이 **3벌**로 흩어져 있었다 —
 *   여기 · `dashboard-kpis.tsx` 카드 값 · 같은 파일 `sentimentComparison`.
 *   지금은 세 값이 일치하지만, 이 저장소는 **같은 수치 복제로 두 번 사고**를 냈다
 *   (`7/6=117%` · `95% vs 7곳`). 한쪽만 반올림 규칙이 바뀌면 **카드 값과 추세선이 갈린다**.
 */
export function positiveRateOf(
  summary: SentimentSummary | null
): number | null {
  return summary ? Math.round((summary.positive / summary.total) * 100) : null;
}

/** D10: 대시보드에서 고를 수 있는 브랜드(= **측정 기록이 있는** 브랜드만). */
export interface BrandOption {
  id: string;
  name: string;
}

export interface DashboardData {
  /**
   * 순위의 평균 분모(목록 크기) — "평균 N개 중 M번째"(세션N-10).
   * null 이면 분모 없이 순위만 표시한다(도입 전 측정분 · 지어내지 않는다).
   */
  averageMentionListSize: number | null;
  // ── 1단계 히어로 3장 (2026-08-06 세션N-5) ──
  /** 평균 언급 순위(1=첫 번째). null 이면 카드가 "—". */
  averageMentionPosition: number | null;
  /**
   * D10(2026-08-07): 전환 가능한 브랜드 목록(최신 측정순).
   * ⚠️ 등록만 하고 **측정이 없는 브랜드는 넣지 않는다** — 실측상 7종 중 5종이
   * 측정 0건이라, 다 띄우면 골라도 빈 화면만 나온다(84% 이탈 경고와 같은 함정).
   * 2개 미만이면 고를 게 없으므로 호출부가 UI 를 렌더하지 않는다.
   */
  brandOptions: BrandOption[];
  coverage: EngineCoverage | null;
  /**
   * 최신 측정의 도메인. **재측정 버튼에 필요하다**(버튼은 `domain`+`brandName` 을 받는다).
   * 🔴 2026-08-17(N-37) 신설 — 「시간에 따른 변화」가 *"두 번째 측정을 하면 그려드려요"*
   *   라고만 말하고 **버튼을 주지 않았다.** 3주간 아무도 2회차를 안 돌린 이유다
   *   (오늘 1건 돌리니 잠겨 있던 화면 4개가 즉시 열렸다).
   */
  latestBrandDomain: string | null;
  /**
   * 화면이 보고 있는 브랜드의 id(감사 D2 주석 작성 대상).
   * ⚠️ AuditJob 폴백 경로에는 **브랜드 행이 없어** null 이다(무료진단은 Brand 를 만들지 않는다)
   * → 주석 UI 는 이 값이 있을 때만 렌더한다.
   */
  latestBrandId: string | null;
  latestBrandName: string | null;
  latestMeasuredAt: Date | null;
  latestSov: number | null;
  /**
   * 🔴 순위 평균의 **모집단** — 몇 개 응답에서 순위가 나왔나(N-48).
   * 실측: 등장 96건 중 **18건(19%)** 만 순위가 산출된다(나머지는 목록형 답변이 아니다).
   * 이걸 안 밝히면 화면이 19% 를 **전체 대표값처럼** 말한다.
   * ⚠️ AuditJob 폴백 경로는 이 수를 **모른다** → `null` 이고, 화면은 그때 표기를 생략한다
   *   (0 으로 깔면 "0개 응답 평균"이라는 거짓 표기가 된다 — 지어내지 않는다).
   */
  positionSampleCount: number | null;
  /** 직전 측정의 평균 순위. 비교값 폴백 2단계(§4-1)용 — 경쟁사 데이터 없을 때 "지난달 N번째". */
  previousMentionPosition: number | null;
  /**
   * D5(2026-08-07): 직전 측정의 감성. 히어로 3장 중 **감성만** 이전 값이 없어
   * 비교 맥락이 비어 있었다(SoV=델타 배지 · 순위=힌트, 감성=없음).
   * 리서치 `02:91`: *"모든 지표는 항상 이전 기간 비교 — 맥락 없는 절대값 금지"*.
   * 이전 측정이 없으면 null → 카드가 비교 문구를 생략한다.
   */
  previousSentiment: SentimentSummary | null;
  /**
   * "밀리는 질문"(2026-08-07) — **최신 측정 1회분**의 프롬프트별 성적. 약한 순.
   * ⚠️ 여러 run 을 섞지 않는다. 과거 질문이 현재 성적표에 끼면 오독이 된다
   *   (경쟁 지형·인용 출처를 최신 1회로 스코프하는 것과 같은 이유).
   * ⚠️ AuditJob 폴백 경로에는 프롬프트 원장이 없어 **빈 배열**이다.
   */
  promptScores: PromptScore[];
  sentiment: SentimentSummary | null;
  // 직전 completed 대비 변화율(%p). 이전 측정 없으면 null → 배지 생략.
  sovDeltaPoints: number | null;
  totalCount: number;
  trend: SovTrendPoint[];
}

const trendDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// 같은 날 여러 번 측정한 경우에만 쓰는 시각 포맷(24시간, 분 단위).
const trendTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// ko-KR 날짜 포맷("2026. 07. 23.")을 "2026.07.23" 형태로 정규화.
const TRAILING_DOT = /\.$/;

function formatShortDate(date: Date): string {
  return trendDateFormatter
    .format(date)
    .replaceAll(". ", ".")
    .replace(TRAILING_DOT, "");
}

/**
 * 🔴 D3 — X축 라벨의 거짓 정밀도 제거 (2026-08-07 세션N-8)
 *
 * 문제: 라벨이 날짜뿐이라 **같은 날 두 번 측정하면 같은 라벨이 두 번** 찍혔다.
 *   추세선은 서로 다른 점인데 축은 같은 날로 읽혀, "언제 바뀐 건지"를 알 수 없다.
 *   실측(kendrick@indigochild.kr · 메디큐브): 추세 5점 중 **`2026.05.08`이 4번 반복**
 *   — 실제 측정 시각은 06:17 · 06:46 · 06:52 · 07:20 으로 모두 달랐다.
 *   ⚠️ 감사 문서는 이걸 "설화수 13건"으로 적었으나 실측하니 **Tracking 경로엔 충돌 0**
 *   (브랜드당 run 1개씩)이고, 실제 피해는 **AuditJob 폴백 경로**에서 났다.
 *
 * 해법: 날짜를 지우지 않는다(대부분은 날짜만으로 충분하고, 시각까지 넣으면 축이 빽빽해진다).
 *   **같은 날짜가 2회 이상 나올 때만 그 날짜들에 시각을 붙인다.** 하루 1회 측정이
 *   기본인 고객은 라벨이 그대로고, 여러 번 잰 고객만 구분이 생긴다.
 *   ⚠️ D2(이벤트 핀)의 전제 — 축이 거짓이면 핀을 꽂을 자리를 특정할 수 없다.
 */
function labelTrendPoints<T extends { timestamp: number }>(
  points: T[]
): (T & { label: string })[] {
  const dateCount = new Map<string, number>();
  for (const p of points) {
    const d = formatShortDate(new Date(p.timestamp));
    dateCount.set(d, (dateCount.get(d) ?? 0) + 1);
  }
  return points.map((p) => {
    const date = new Date(p.timestamp);
    const short = formatShortDate(date);
    const label =
      (dateCount.get(short) ?? 0) > 1
        ? `${short} ${trendTimeFormatter.format(date)}`
        : short;
    return { ...p, label };
  });
}

function measuredAt(job: AuditJob): Date {
  return job.completedAt ?? job.createdAt;
}

// jobs 는 page.tsx 에서 createdAt desc 로 조회된다는 전제.
// completed 측정만으로 KPI·추세를 구성한다.
export function buildDashboardData(jobs: AuditJob[]): DashboardData {
  const completed = jobs.filter((job) => job.status === "completed");

  // desc 로 들어온 completed 중 SoV 가 유효한 것들
  const completedWithSov = completed
    .map((job) => ({ job, sov: extractSov(job.result) }))
    .filter(
      (entry): entry is { job: AuditJob; sov: number } => entry.sov !== null
    );

  const latestJob = completed[0] ?? null;
  const coverage = latestJob ? extractEngineCoverage(latestJob.result) : null;
  const latestBrandName = latestJob ? extractBrandName(latestJob.result) : null;
  const latestMeasuredAt = latestJob ? measuredAt(latestJob) : null;

  // 🔴 브랜드 필터 (2026-08-06 화면확인 세션) — **비교·추세는 같은 브랜드끼리만.**
  //   실측 사고: 한 이메일에 브랜드 9종(설화수·클로드·SK하이닉스·기아…)이 섞여 있는데
  //   필터가 없어 "클로드 86% ↑7%p"의 7%p가 **직전 SK하이닉스(79)와의 차이**였다.
  //   순위 힌트도 "지난 측정 1.3번째에서 0.3 올랐어요"가 클로드 vs SK하이닉스 비교였고,
  //   추세선은 브랜드 9종의 SoV가 한 선으로 이어져 그래프 자체가 거짓이었다.
  //   → Tracking 경로(buildTrackingDashboardData)는 처음부터 `run.brandId === latest.brandId`로
  //     같은 필터를 걸고 있었다. **같은 의도의 두 구현 중 폴백만 빠져 있던 것**이라 여기서 맞춘다.
  //   브랜드명이 없는 구(舊) job 은 비교 대상에서 제외한다(정체 불명끼리 비교 금지).
  const sameBrand =
    latestBrandName === null
      ? []
      : completedWithSov.filter(
          ({ job }) => extractBrandName(job.result) === latestBrandName
        );

  const latest = sameBrand[0] ?? null;
  const previous = sameBrand[1] ?? null;

  const latestSov = latest?.sov ?? null;
  const sovDeltaPoints = latest && previous ? latest.sov - previous.sov : null;

  // 추세: 같은 브랜드만, 오래된→최신 순으로 정렬 (asc)
  //   라벨은 정렬 후 `labelTrendPoints`가 붙인다 — 같은 날 중복일 때만 시각 표기(D3).
  const trend: SovTrendPoint[] = labelTrendPoints(
    sameBrand
      .map(({ job, sov }) => ({
        timestamp: measuredAt(job).getTime(),
        sov,
        positiveRate: positiveRateOf(extractSentiment(job.result)),
        // D9: Tracking 경로와 **쌍둥이**로 채운다(세션N-6 "폴백만 누락" 사고 방지).
        position: extractAverageMentionPosition(job.result),
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
  );

  // 히어로 3장: 최신 completed job 의 metrics 에서 추출. 평균 순위는 **같은 브랜드의**
  // 직전 측정과 비교해 "지난 측정 대비" 폴백(§4-1 2단계)을 만든다.
  const previousJob = previous?.job ?? null;

  return {
    // D10: AuditJob 폴백 경로에는 **Brand 행이 없다**(무료진단은 Brand 를 만들지 않는다).
    //   브랜드 id 가 없으면 전환 대상을 식별할 수 없으므로 목록도 비운다 —
    //   latestBrandId 를 null 로 두는 것(바로 아래)과 같은 이유다.
    brandOptions: [],
    // "밀리는 질문": AuditJob 폴백에는 **프롬프트 원장(Tracking)이 없다** → 빈 배열.
    //   brandOptions 를 비우는 것과 같은 이유(식별할 원장이 없으면 지어내지 않는다).
    promptScores: [],
    totalCount: jobs.length,
    latestSov,
    sovDeltaPoints,
    coverage,
    // AuditJob 폴백에는 Brand 행이 없다(무료진단은 Brand 를 만들지 않는다) → 주석 UI 비표시.
    latestBrandId: null,
    // 폴백 경로엔 Brand 행이 없지만 **도메인은 job 에 있다** → 재측정 버튼은 줄 수 있다.
    latestBrandDomain: latestJob?.domain ?? null,
    latestBrandName,
    latestMeasuredAt,
    trend,
    averageMentionPosition: latestJob
      ? extractAverageMentionPosition(latestJob.result)
      : null,
    averageMentionListSize: latestJob
      ? extractAverageMentionListSize(latestJob.result)
      : null,
    // 🔴 **AuditJob 결과에는 순위 표본 수가 없다**(`AuditMetrics` 에 그 필드가 없다).
    //   → `null` 로 두고 화면이 표기를 **생략**한다. 0 으로 깔면 "0개 응답 평균"이라는
    //   거짓 표기가 되고, 아무 수나 넣으면 지어내는 것이다.
    //   📕 이 파일 자신의 경고: *"세션N-6 의 「쌍둥이 구현 중 폴백만 누락」 사고가
    //     정확히 이 파일에서 났다"* → 그래서 **명시적으로** null 을 적는다(빠뜨림과 구분).
    positionSampleCount: null,
    previousMentionPosition: previousJob
      ? extractAverageMentionPosition(previousJob.result)
      : null,
    // D5: 감성도 직전 측정과 비교한다. ⚠️ 아래 Tracking 경로와 **같이** 채울 것 —
    //   세션N-6의 "쌍둥이 구현 중 폴백만 누락" 사고가 정확히 이 파일에서 났다.
    previousSentiment: previousJob
      ? extractSentiment(previousJob.result)
      : null,
    sentiment: latestJob ? extractSentiment(latestJob.result) : null,
  };
}

// ──────────────────────────────────────────────────
// P5 8-d (2026-07-30): Tracking 소스 집계 — 대시보드 읽기 전환의 본체.
//
// Tracking 은 org 측정의 (프롬프트 × 엔진) 행 단위 원장이다. 같은 측정 1회의 모든 행은
// persistAuditTracking 이 동일한 trackedAt(=AuditJob.completedAt)을 찍는다 → (brandId,
// trackedAt)으로 묶으면 "측정 1회(run)"가 복원된다.
//
// aggregateAudit(@repo/ai) 정합:
//   · SoV = 언급 행 수 / 성공 행 수. Tracking 은 D5(실패/stub 제외)로 성공 행만 저장하므로
//     "언급 행 / 전체 행"이 곧 aggregateAudit 의 sov 와 같은 식이다.
//   · 커버리지 = 고유 엔진 기준(extractEngineCoverage 의 Set 고유화와 동일). 단 Tracking 에는
//     오류 엔진 행이 없어 분모가 "성공 엔진"이 된다 — 세션F geo-score 재설계(인지 분모에서
//     오류 엔진 제외)와 같은 방향이라 의도된 차이.
// ──────────────────────────────────────────────────

/** scopedTracking 반환 행 중 집계에 쓰는 최소 형태(구조적 타이핑, app lib 역의존 회피). */
export interface TrackingRowInput {
  brand: { name: string; domain: string };
  brandId: string;
  brandMentioned: boolean;
  engineId: string;
  /**
   * 순위의 분모 = 그 답변 번호 목록의 총 항목 수(세션N-10, 2026-08-07).
   * ⚠️ 도입 전 행은 null → "N개 중" 표기는 값이 있는 행에서만 한다.
   */
  mentionListSize?: number | null;
  // 1단계(2026-08-06): 히어로 3장. Tracking 테이블의 실제 컬럼 그대로.
  //   ⚠️ mentionPosition 은 언급 행에서도 파싱 실패하면 null (실측 54행 중 26행만 존재)
  //   → 평균 계산에서 반드시 제외한다. 0으로 깔면 순위가 실제보다 좋게 왜곡된다.
  mentionPosition?: number | null;
  /** "밀리는 질문"(2026-08-07). 없으면 그 행은 프롬프트 집계에서 빠진다. */
  prompt?: { text: string } | null;
  promptId?: string;
  sentiment?: string | null;
  trackedAt: Date;
}

/**
 * "밀리는 질문" 한 줄 — 프롬프트별 성적.
 *
 * 📕 리서치 `01:130-132` (Peec AI, **VERIFIED**):
 *   "active prompts view shows position, sentiment, and visibility % per prompt …
 *   so you can see at a glance **where you're winning and where you're not**"
 *   → "이게 밀리는 질문 리스트다. **업계 1군은 이걸 메인에 둔다**."
 *   채택률 8/15 인데 우리에겐 없었다 = 벤치마크 최대 공백.
 */
export interface PromptScore {
  /** 이 질문에서 우리를 언급한 엔진 수. */
  hit: number;
  /** 평균 언급 순위. 순위를 못 딴 질문은 null(0으로 깔지 않는다). */
  position: number | null;
  text: string;
  /** 이 질문을 물어본 엔진 수(= 분모). */
  total: number;
}

/**
 * 최신 측정 1회분 행 → 프롬프트별 성적(약한 순).
 * 정렬은 **등장률 오름차순** — 리서치가 요구한 건 "어디서 지고 있나"라 못한 질문이 먼저다.
 * 동률이면 분모가 큰 쪽(더 많이 물어본 질문)을 앞에 둔다.
 */
function foldPromptScores(rows: TrackingRowInput[]): PromptScore[] {
  const groups = new Map<string, TrackingRowInput[]>();
  for (const row of rows) {
    const text = row.prompt?.text;
    if (!text) {
      continue; // 프롬프트 원문이 없으면 성적표에 쓸 수 없다
    }
    const group = groups.get(text);
    if (group) {
      group.push(row);
    } else {
      groups.set(text, [row]);
    }
  }

  const scores: PromptScore[] = [];
  for (const [text, group] of groups) {
    // 순위는 언급 행에서도 파싱 실패하면 null → 평균 분모에서 제외(0으로 깔면 왜곡).
    const positions = group
      .map((r) => r.mentionPosition)
      .filter((p): p is number => typeof p === "number" && p > 0);
    scores.push({
      hit: group.filter((r) => r.brandMentioned).length,
      position:
        positions.length === 0
          ? null
          : Math.round(
              (positions.reduce((a, b) => a + b, 0) / positions.length) * 10
            ) / 10,
      text,
      total: group.length,
    });
  }

  return scores.sort((a, b) => {
    const rateA = a.hit / a.total;
    const rateB = b.hit / b.total;
    return rateA === rateB ? b.total - a.total : rateA - rateB;
  });
}

interface TrackingRun {
  averageMentionListSize: number | null;
  averageMentionPosition: number | null;
  /** 재측정 버튼용(N-37) — 표시용 `brandName` 과 별개로 원본 도메인을 들고 간다. */
  brandDomain: string;
  brandId: string;
  brandName: string;
  coverage: EngineCoverage;
  measuredAt: Date;
  /** 순위 평균이 **몇 개 응답**으로 나온 수인가(N-48). 0 이면 순위가 아예 없다. */
  positionSampleCount: number;
  sentiment: SentimentSummary | null;
  sov: number;
}

/**
 * 언급 순위 평균. **null 인 행은 분모에서도 제외**한다(실측 54행 중 26행만 순위 보유).
 * 소수 1자리 반올림 = aggregateAudit(@repo/ai engines/index.ts:194)과 동일 규칙 →
 * Tracking 경로와 AuditJob 폴백 경로가 같은 숫자를 낸다.
 */
function averagePosition(rows: TrackingRowInput[]): number | null {
  const positions = rows
    .map((r) => r.mentionPosition)
    .filter(
      (p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0
    );
  if (positions.length === 0) {
    return null;
  }
  const sum = positions.reduce((a, b) => a + b, 0);
  return Math.round((sum / positions.length) * 10) / 10;
}

/**
 * 🔴🔴 **순위 평균이 몇 개 응답으로 나온 수인가**(N-48 · 2026-08-20 실측).
 *
 * ## 왜 필요한가 — 화면이 19% 를 100% 처럼 말하고 있었다
 * 프로덕션 실측: 최신 측정 **등장 96건 중 순위가 산출된 것 18건(19%)**.
 * 그런데 카드는 「4개 중 1.3번째」라고만 써서 **전체 대표값처럼** 읽힌다.
 *
 * | 엔진 | 등장 | 순위 산출 |
 * |---|---:|---:|
 * | Claude·Perplexity·네이버·다음 | 46 | **0** (목록형 답변이 아니라 구조적 불가) |
 * | Gemini·ChatGPT·HyperCLOVA X | 50 | 18 |
 *
 * ⚠️ `averagePosition` 은 **null 을 제외**하고 평균한다(0으로 깔면 순위가 좋게 왜곡되므로
 * 그게 옳다). 문제는 **제외했다는 사실을 화면이 말하지 않는 것**이다.
 * 📕 이 저장소 최다 사고 *"못 잰 것을 0이라 부르기"* 의 사촌 —
 *   **못 잰 것을 조용히 빼고 남은 것으로 단정하기.**
 *
 * ⭐ 옆의 등장률 카드는 이미 「질문 4개 기준」으로 모집단을 밝힌다. **같은 문법**을 준다.
 * 📕 재설계안 v4 §403 이 규정한 표기 `평균 N개 중 · M개 응답 평균` 의 **M** 이 이것이다.
 */
function positionSampleCount(rows: TrackingRowInput[]): number {
  return rows.filter(
    (r) =>
      typeof r.mentionPosition === "number" &&
      Number.isFinite(r.mentionPosition) &&
      r.mentionPosition > 0
  ).length;
}

/**
 * 순위의 평균 **분모**(목록 크기). "평균 N개 중 M번째" 표기용 — 세션N-10.
 * 위 `averagePosition` 과 같은 규칙(소수 1자리·null 제외)을 쓴다.
 * ⚠️ 분모가 있는 행만 센다. 도입 전 행이 섞여 있어도 그 행들은 조용히 빠진다
 *   (0으로 깔면 "0개 중 1번째"라는 거짓 표기가 된다).
 */
function averageListSize(rows: TrackingRowInput[]): number | null {
  const sizes = rows
    .map((r) => r.mentionListSize)
    .filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
    );
  if (sizes.length === 0) {
    return null;
  }
  const sum = sizes.reduce((a, b) => a + b, 0);
  return Math.round((sum / sizes.length) * 10) / 10;
}

/** Tracking.sentiment(enum 문자열) 분포 집계. 값이 하나도 없으면 null. */
// 🔴 `export` 인 이유(세션N-34): 「지금 할 일」 화면의 감성 섹션이 **이 함수를 그대로 쓴다.**
//   같은 집계를 복제하면 두 화면이 다른 숫자를 말하게 된다(같은 수치 2벌 금지 —
//   이 저장소가 인지율 3벌·분모 3벌로 반복해 겪은 함정).
export function summarizeSentiment(
  rows: TrackingRowInput[]
): SentimentSummary | null {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const row of rows) {
    if (row.sentiment === "positive") {
      positive += 1;
    } else if (row.sentiment === "neutral") {
      neutral += 1;
    } else if (row.sentiment === "negative") {
      negative += 1;
    }
  }
  const total = positive + neutral + negative;
  return total === 0 ? null : { positive, neutral, negative, total };
}

/** rows(어느 순서든)를 측정 run 단위로 접어 최신순으로 반환. */
function foldTrackingRuns(rows: TrackingRowInput[]): TrackingRun[] {
  const groups = new Map<string, TrackingRowInput[]>();
  for (const row of rows) {
    const key = `${row.brandId}|${row.trackedAt.getTime()}`;
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const runs: TrackingRun[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const mentionedRows = group.filter((r) => r.brandMentioned);
    const engines = new Set(group.map((r) => r.engineId));
    const mentionedEngines = new Set(mentionedRows.map((r) => r.engineId));
    runs.push({
      brandId: first.brandId,
      // 재측정 버튼이 `domain` 을 받는다(N-37). 표시용 이름과 별개로 원본을 들고 간다.
      brandDomain: first.brand.domain,
      brandName: first.brand.name || first.brand.domain,
      measuredAt: first.trackedAt,
      sov: Math.round((mentionedRows.length / group.length) * 100),
      coverage: { mentioned: mentionedEngines.size, total: engines.size },
      averageMentionPosition: averagePosition(group),
      averageMentionListSize: averageListSize(group),
      // 🔴 순위 평균의 **모집단**. 없으면 화면이 19% 를 전체처럼 말한다(위 함수 주석).
      positionSampleCount: positionSampleCount(group),
      sentiment: summarizeSentiment(group),
    });
  }
  return runs.sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime());
}

/**
 * Tracking 행 → DashboardData. 행이 없으면 null(호출부가 AuditJob 폴백 — dual-write 가
 * 백업 소스라는 설계 그대로, 무료 email 진단만 있는 유저도 대시보드가 비지 않는다).
 *
 * KPI·추세는 **브랜드 하나**로 좁힌다: 대시보드 헤더가 "{브랜드}의 가시성 요약"이라
 * 브랜드가 섞인 선/델타는 오독을 만든다(기존 AuditJob 판의 알려진 결함).
 * totalCount 만 org 전체 측정 횟수.
 *
 * @param selectedBrandId D10(2026-08-07): 볼 브랜드. 없거나 이 org 의 측정 브랜드가
 *   아니면 가장 최근 측정 브랜드로 되돌린다(기존 동작 = 기본값).
 */
export function buildTrackingDashboardData(
  rows: TrackingRowInput[],
  selectedBrandId?: string
): DashboardData | null {
  const runs = foldTrackingRuns(rows);
  if (runs.length === 0) {
    return null;
  }

  // D10(2026-08-07): 어떤 브랜드를 볼지 **고를 수 있다**.
  //   기존엔 `runs[0]`(가장 최근 측정)로 고정돼, 다른 브랜드 데이터가 있어도
  //   화면에 닿을 방법이 없었다. 실측: 한 org 가 브랜드 7종 보유·그중 2종 측정됨
  //   (나이키 34행 · 엔비디아 20행) — 엔비디아는 **볼 수가 없었다**.
  //   ⚠️ 선택값이 이 org 의 측정된 브랜드가 아니면(삭제·오타·타org id) 조용히 최신으로
  //   되돌린다. rows 자체가 scopedTracking 으로 org 필터를 이미 통과했으므로
  //   여기서 찾히지 않는 id 는 곧 "내 것이 아니다" — 404 대신 안전한 기본값이 맞다.
  const latest =
    (selectedBrandId
      ? runs.find((run) => run.brandId === selectedBrandId)
      : undefined) ?? runs[0];

  const brandRuns = runs.filter((run) => run.brandId === latest.brandId);
  const previous = brandRuns[1] ?? null;

  // 라벨은 `labelTrendPoints`가 붙인다 — 같은 날 중복일 때만 시각 표기(D3).
  //   ⚠️ 두 경로(AuditJob 폴백·Tracking)가 **같은 규칙**을 써야 한다.
  //   세션N-6의 "쌍둥이 구현 중 폴백만 누락" 사고가 정확히 이 파일에서 났다.
  const trend: SovTrendPoint[] = labelTrendPoints(
    brandRuns
      .map((run) => ({
        timestamp: run.measuredAt.getTime(),
        sov: run.sov,
        positiveRate: positiveRateOf(run.sentiment),
        // D9: run 단위 평균 순위는 이미 계산돼 있다(averagePosition) — 실어 나르기만 하면 된다.
        position: run.averageMentionPosition,
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
  );

  // D10: 측정된 브랜드만, 최신 측정순으로 중복 제거(runs 는 이미 최신순).
  const brandOptions: BrandOption[] = [];
  const seenBrands = new Set<string>();
  for (const run of runs) {
    if (!seenBrands.has(run.brandId)) {
      seenBrands.add(run.brandId);
      brandOptions.push({ id: run.brandId, name: run.brandName });
    }
  }

  // "밀리는 질문": 보고 있는 브랜드의 **최신 측정 1회분**만(= latest run 의 trackedAt).
  //   여러 run 을 섞으면 과거 질문이 현재 성적표에 끼어 오독이 된다.
  const latestRunMs = latest.measuredAt.getTime();
  const promptScores = foldPromptScores(
    rows.filter(
      (row) =>
        row.brandId === latest.brandId &&
        row.trackedAt.getTime() === latestRunMs
    )
  );

  return {
    brandOptions,
    promptScores,
    // 🔴 순위 평균의 모집단(N-48) — 최신 런에서 순위가 나온 응답 수.
    positionSampleCount: latest.positionSampleCount,
    // 🔴 D10 이 드러낸 결함: 여기가 `runs.length`(**org 전체** 측정 횟수)였다.
    //   브랜드가 하나뿐인 것처럼 보이던 때는 티가 안 났지만, 전환 UI 가 생기면서
    //   화면이 "이 브랜드 이야기"가 되자 거짓말이 됐다 — 엔비디아(실측 **1회** 측정)를
    //   골랐는데 하단에 `측정 2회`(나이키 1 + 엔비디아 1)로 표시되고,
    //   같은 화면의 순위 카드는 `비교는 2회차 측정부터 보여드려요`라 **자기모순**이었다.
    //   → 보고 있는 브랜드의 측정 횟수로 바꾼다.
    totalCount: brandRuns.length,
    latestSov: latest.sov,
    sovDeltaPoints: previous ? latest.sov - previous.sov : null,
    coverage: latest.coverage,
    // Tracking 경로에는 실제 Brand 가 있다 → 주석 작성 가능(감사 D2).
    latestBrandId: latest.brandId,
    latestBrandDomain: latest.brandDomain,
    latestBrandName: latest.brandName,
    latestMeasuredAt: latest.measuredAt,
    trend,
    averageMentionPosition: latest.averageMentionPosition,
    averageMentionListSize: latest.averageMentionListSize,
    // 같은 브랜드의 직전 측정과 비교(brandRuns 기준) — 브랜드가 섞이면 오독이 된다.
    previousMentionPosition: previous?.averageMentionPosition ?? null,
    // D5: 감성도 같은 브랜드의 직전 측정과 비교(위 AuditJob 폴백과 쌍둥이).
    previousSentiment: previous?.sentiment ?? null,
    sentiment: latest.sentiment,
  };
}

// 상대 시간(예: "3일 전"). 7일 초과면 YYYY.MM.DD.
export function formatMeasuredAt(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 1) {
    return "방금 전";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }
  const diffDays = Math.round(diffHours / 24);
  if (diffDays <= 7) {
    return `${diffDays}일 전`;
  }
  return formatShortDate(date);
}
