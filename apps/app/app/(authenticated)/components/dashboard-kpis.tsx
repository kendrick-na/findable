import type { MetricKey } from "@repo/audit/metric-dictionary";
import { directionHint, METRICS } from "@repo/audit/metric-dictionary";
import { cn } from "@repo/design-system/lib/utils";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  LockIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardData, SentimentSummary } from "../lib/dashboard-data";
import { formatMeasuredAt, positiveRateOf } from "../lib/dashboard-data";
import { KpiSparkline } from "./kpi-sparkline";

// `export` 인 이유: 스토리(`.stories.tsx`)가 `Meta<typeof DashboardKpis>` 로 이 타입을
//   참조한다. 안 내보내면 tsc 가 TS4023("이름을 지을 수 없다")로 막는다.
export interface DashboardKpisProps {
  data: DashboardData;
  /** Growth 이상인가(=isPaid). 잠긴 카드를 "클릭 전에" 표시하는 데만 쓴다. */
  paid: boolean;
}

// ──────────────────────────────────────────────────
// 1단계 히어로 3장 (2026-08-06 세션N-5) — 📕UIUX_대개선_기획서_2026-08-06.md §4-1
//
// 승인 = A안: 운영지표(총 측정 횟수·마지막 측정)는 삭제가 아니라 **회색 한 줄로 강등**.
//   근거 ① 리서치 "KPI를 늘리지 말고 줄일 것"(Stripe 4장·GSC 기본 2개 ON)
//        ② Carbon Presentation 선언 — 이 화면은 탐색이 아니라 "상태·큰그림"
//        ③ 유료 축은 "더 많은 정보"가 아니라 시간·비교·알림(§2 Docker형 실패 회피)
//
// 라벨을 **질문형**으로 쓰는 이유(Trakkr 차용 + 토스 "쉽게 말하기"): 비개발자 고객이
//   "SoV"·"커버리지"를 모른다. 지표명이 아니라 그 지표가 답하는 질문을 적는다.
// ──────────────────────────────────────────────────

// ──────────────────────────────────────────────────
// D6 (2026-08-07 세션N-9) — 히어로 카드를 목적지로 잇는다.
//
// ⚠️ 문서의 "3장 전부 링크"를 그대로 따르지 않았다. 실측으로 두 가지가 갈렸다:
//   ① `/compare`·`/sources` 는 **isPaid(=Growth 이상) 게이트**가 걸려 있고,
//      비유료에게는 LockedSurface 를 보여준다.
//      ⚠️ **정정(2026-08-17 세션N-39)**: 원문은 여기에 *"+ 가짜 예시 데이터(42%·31%·18%)"*
//        라고 적혀 있었으나 그 수치는 **이미 제거됐다**(`compare/page.tsx:19` 참조 —
//        *"실재하지 않는 수치를 막대까지 그려 보여줬다"*). 지금은 잠금만 남았다.
//        → 아래 D6 판단(잠금을 클릭 전에 알린다)은 **그대로 유효**하다.
//      그냥 링크만 걸면 "막다른 카드"를 **미끼**로 바꾸는 셈이다.
//      → 잠금을 **클릭 전에** 카드가 말하게 한다. 근거: 리서치 01:363 AthenaHQ
//        (G2 4.6/5, "mid-market에서 가장 잘 설계됨")가 **"Insights 탭에 자물쇠 아이콘"**.
//        블러/티저는 리서치가 직접 기각했다(05:109-112 "직접 조사한 연구 없다" = 자기모순).
//   ② 등장률 카드의 후보였던 `/history` 는 **하단 "최근 측정 이력" 섹션과 중복**이라
//      링크를 걸지 않았다. 근거: 02:189 "요약 차트 1개 + 아래 상세 표 1개"가
//      GSC 의 지배적 실전 조합 — 같은 화면 안에서 밖으로 내보내면 그 조합이 깨진다.
//
// 게이팅 원칙(05:97): "free 는 aha, paid 는 규모·팀·리스크·파워유저 가치를 잠근다."
//   경쟁사 비교·출처 분석은 유료 쪽이 맞다. 문제는 **잠근 것**이 아니라 **언제 알리냐**였다.
// ──────────────────────────────────────────────────

// 브랜드 KPI 카드 한 장. shadcn Card 대신 .findable-card 로 통일.
//   §9-2(b): 값·힌트에 min-w-0 — 한국어 힌트가 길어 좁은 폭에서 넘친다.
//   word-break:keep-all(§9)이 한국어 줄바꿈을 어렵게 만들어 오버플로 위험을 키우므로
//   힌트는 줄바꿈을 허용한다(자르지 않음 — 비교 맥락이 사라지면 카드 의미가 없다).
const KpiCard = ({
  label,
  value,
  hint,
  badge,
  tier,
  sparkline,
  comparison,
  directionNote,
  href,
  locked,
  lockedNote,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  badge?: ReactNode;
  tier?: string;
  /** 1-6 스파크라인. 추세가 2점 미만이면 호출부가 null 을 넘겨 자리도 차지하지 않는다. */
  sparkline?: ReactNode;
  /**
   * D5: 이전 기간 비교 한 줄. 힌트와 **자리를 나눈다** — 감성 카드는 힌트가 이미
   * 구성(긍정 5 · 보통 28 · 부정 0 · 총 33건)을 쓰고 있어, 변화까지 한 줄에 넣으면
   * 한국어에서 줄이 두 번 접힌다. 구성과 변화는 다른 정보다.
   * (순위 카드는 구성 정보가 없어 힌트 자리를 비교 문장에 통째로 쓴다 — 그건 그대로 둔다.)
   */
  comparison?: string;
  /**
   * 🔴 방향 표식(세션N-34 지표 사전). 순위처럼 **낮을수록 좋은** 지표에만 붙는다.
   * 값의 출처는 `METRICS[key].direction` 하나 — 화면이 방향을 따로 판단하지 않는다.
   *
   * 왜 필요한가: 순위 카드는 스파크라인에 이미 `lowerIsBetter` 를 넘기고 있었다.
   * 즉 **코드는 방향을 아는데 화면은 그걸 말하지 않았다** — `3위`가 좋은 건지
   * 나쁜 건지 고객이 알 수 없었다(재설계안 v4 §4-a-2 축2).
   */
  directionNote?: string | null;
  /** 목적지. 없으면 카드는 지금까지처럼 링크가 아니다(등장률 카드가 그렇다). */
  href?: string;
  /** 목적지가 현재 플랜에서 잠겨 있는가. 링크는 그대로 걸되 **미리 알린다**. */
  locked?: boolean;
  /** 잠금 안내 한 줄. 예: "경쟁사 비교는 Growth부터". */
  lockedNote?: string;
}) => {
  const body = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {label}
        </p>
        {/* 어포던스는 라벨 줄 **오른쪽 끝**에 — 숫자(주인공)와 자리를 다투지 않는다.
            잠김이면 자물쇠, 열려 있으면 화살표. 둘 다 장식이라 aria-hidden. */}
        {href ? (
          <span
            aria-hidden="true"
            className="shrink-0 text-[color:var(--findable-ink-tertiary,#7e8289)] transition-colors group-hover:text-[color:var(--findable-primary,#ff7a4d)]"
          >
            {locked ? (
              <LockIcon className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <span className="font-semibold text-3xl text-[color:var(--findable-ink,#f7f8f8)] tabular-nums">
          {value}
        </span>
        {/* §D2: "숫자 + 티어 라벨이 맨 숫자를 이긴다" — 원시 점수만 주면
            보는 사람이 "좋은 게 뭔지"를 스스로 기억해야 한다. */}
        {tier ? (
          <span className="mb-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
            {tier}
          </span>
        ) : null}
        {/* 방향 표식은 티어 **옆** — 티어가 이미 "좋은 게 뭔지"를 말하는 자리라
            방향도 같은 줄에서 읽히는 편이 맞다. 티어보다 한 단계 옅게 둬서
            숫자 → 티어 → 방향 순으로 읽히게 한다(카드 주인공은 숫자). */}
        {directionNote ? (
          <span className="mb-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {directionNote}
          </span>
        ) : null}
        {badge}
      </div>
      <p className="min-w-0 text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
        {hint}
      </p>
      {/* D5: 이전 기간 비교. 구성(힌트) 바로 아래 — "지금 이렇고, 지난번보단 이렇다"의 순서.
          하락에도 색을 쓰지 않는다(§9-2 GSC 안티패닉: 나쁜 소식에 빨강은 이탈을 부른다). */}
      {comparison ? (
        <p className="min-w-0 text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
          {comparison}
        </p>
      ) : null}
      {/* 잠금 안내는 힌트 **아래**, 힌트보다 더 옅게. 이 카드의 숫자는 이미 유효하고
          잠긴 건 "더 깊이 보기"뿐이다 — 카드 전체가 잠긴 것처럼 보이면 거짓말이 된다. */}
      {locked && lockedNote ? (
        <p className="min-w-0 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
          {lockedNote}
        </p>
      ) : null}
      {/* 스파크라인은 힌트 **아래** — 숫자·티어·힌트(글자 정보)를 먼저 읽히고
          모양은 마지막에 배경으로 준다(카드의 주인공은 숫자다). */}
      {sparkline}
    </>
  );

  const shell = "findable-card flex min-w-0 flex-col gap-3 p-5";

  if (!href) {
    return <div className={shell}>{body}</div>;
  }

  // 카드 전체가 클릭 영역(Fitts) — 작은 화살표만 누르게 하지 않는다.
  //   `group` 은 위 어포던스의 hover 색을 카드 전체 hover 에 묶기 위한 것.
  return (
    <Link
      className={cn(
        shell,
        "group transition-colors hover:border-[color:var(--findable-primary,#ff7a4d)]/40"
      )}
      href={href}
    >
      {body}
    </Link>
  );
};

// 등장률 티어. 임계값은 www 결과페이지 scoreTierLabel(audit-result.tsx:266)과 달리
//   **등장률(0~100%) 눈금**이다 — GEO 총점과 혼동 금지(세션N-2 sovLabel 사고).
function visibilityTier(sov: number): string {
  if (sov >= 60) {
    return "잘 보이는 편";
  }
  if (sov >= 30) {
    return "보통";
  }
  if (sov > 0) {
    return "거의 안 보임";
  }
  return "아직 안 보임";
}

// 순위 티어. 1에 가까울수록 좋다(낮을수록 상위).
function positionTier(position: number): string {
  if (position <= 1.5) {
    return "가장 먼저";
  }
  if (position <= 3) {
    return "앞쪽";
  }
  return "뒤쪽";
}

// ──────────────────────────────────────────────────
// D8 (2026-08-07 세션N-9) — 감성 3분할 스택바.
//
// 고치는 것: 주 숫자가 `긍정 15%` 하나뿐이라 **"나머지 85%는 부정인가?"** 로 읽힌다.
//   실측(최신 측정 34건): 중립 28 · 긍정 5 · **부정 0**. 완전히 다른 이야기인데
//   숫자 하나가 오독을 만든다. 감사 D8 근거 = *"분모가 보여야 임의적이지 않게 느껴짐"*.
//
// ⚠️ 부정이 0건이라 실제로는 2분할로 그려진다. 그래도 만드는 이유:
//   이건 D4(기간 칩)처럼 "데이터가 없어 기능이 무의미한" 경우가 아니라
//   **이미 있는 분모를 안 보여주던 표현 결함**이다. 부정이 생기면 그대로 3분할이 된다.
//
// 색: 긍정=단청(추세 차트 긍정 계열과 동일) · 중립=hairline-strong · 부정=danger.
//   §9 색 규율 — 같은 지표가 두 화면 요소에서 다른 색이면 색이 의미를 잃는다.
//   ⚠️ 부정에 danger(빨강)를 쓰는 건 "하락에 빨강 금지"(GSC 안티패닉)와 다른 사안이다.
//   여기서 빨강은 **변화의 방향**이 아니라 **범주 이름**이다(부정 감성 그 자체).
const SentimentBar = ({ summary }: { summary: SentimentSummary }) => {
  const segments = [
    {
      color: "var(--findable-dancheong, oklch(0.58 0.110 195))",
      count: summary.positive,
      key: "positive",
    },
    {
      color: "var(--findable-hairline-strong, #34343a)",
      count: summary.neutral,
      key: "neutral",
    },
    {
      // 실존 토큰 `--signal-bad`. (`--findable-danger`·`--findable-warn` 은 정의가 없는
      //  토큰이었고 CSS 폴백으로 연명 중이었다 — 2026-08-07 전수 검사로 2곳 모두 교체함.)
      color: "var(--signal-bad, oklch(0.65 0.24 25))",
      count: summary.negative,
      key: "negative",
    },
  ].filter((s) => s.count > 0); // 0인 범주는 칸을 차지하지 않는다(가짜 두께 방지)

  return (
    <div
      aria-label={`긍정 ${summary.positive}, 보통 ${summary.neutral}, 부정 ${summary.negative} (총 ${summary.total}건)`}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--findable-surface-2,#141516)]"
      role="img"
    >
      {segments.map((s) => (
        <div
          key={s.key}
          style={{
            background: s.color,
            width: `${(s.count / summary.total) * 100}%`,
          }}
        />
      ))}
    </div>
  );
};

// 감성 티어. D8 스택바가 **비중**을 보여주기 시작하면서 기존 로직의 어긋남이 드러났다:
//   부정이 1건이든 33건 전부든 똑같이 "부정 섞임"이었다(negative > 0 하나로만 갈림).
//   부정 100%인데 "섞임"은 사실과 다르다 — 스택바가 새빨간데 라벨만 순한 셈.
//   → 비중으로 판정한다. 임계값 3할은 "소수 의견"과 "지배적 경향"의 경계로 잡았다.
//   ⚠️ 라벨은 사실 서술에 그친다(§9 안티패닉 — 겁주는 말로 확대하지 않는다).
// 🔴 `export` 인 이유: 테스트가 **이 함수 자체**를 검사하게 하려고.
//   테스트에 판정 로직을 복제하면 둘이 조용히 갈라진다(같은 수치 2벌 금지).
export function sentimentTier(summary: SentimentSummary): string {
  if (summary.total === 0) {
    return "—";
  }
  const negativeRate = summary.negative / summary.total;
  const positiveRate = summary.positive / summary.total;
  if (negativeRate >= 0.3) {
    return "부정 많음";
  }
  if (summary.negative > 0) {
    return "부정 섞임";
  }
  // 🔴 세션N-34: 여기가 **부정 쪽과 대칭이 아니었다.** 부정은 위에서 이미
  //   *"1건이든 전부든 똑같이 섞임"* 이라는 이유로 비중 판정으로 고쳐졌는데,
  //   긍정만 `positive > 0` 하나로 갈려 **1건만 있어도 「우호적」** 이 됐다.
  //   실측(브랜드 3개 전량): 긍정 비중 **14% · 15% · 12%** 인데 셋 다 「우호적」.
  //   실제로는 **85% 이상이 중립**이다 — 화면이 상태를 좋게 반올림하고 있었다.
  //   → 같은 3할 경계를 긍정에도 적용한다(새 임계값을 발명하지 않는다).
  if (positiveRate >= 0.3) {
    return "우호적";
  }
  // ⚠️ 긍정이 있어도 소수면 **중립이 지배적**이라고 말한다.
  //   AI 답변에서 중립은 "나쁘지 않다"가 아니라 **"밋밋해서 안 골라진다"** 이고
  //   그게 개선 대상이다(web `sentimentHint` 가 S7-4차에 정한 해석과 같은 방향).
  return "중립적";
}

// 히어로 3장 + 운영지표 한 줄(A안). 값이 없으면 "—" 로 안전 표기.
/**
 * 🔴🔴 **순위 평균의 모집단을 밝히는 문구**(N-48 · 2026-08-20 프로덕션 실측).
 *
 * ## 왜 필요한가 — 화면이 19% 를 전체처럼 말하고 있었다
 * 실측: 최신 측정 **등장 96건 중 순위가 산출된 것 18건(19%)**.
 * Claude·Perplexity·네이버·다음은 목록형 답변이 아니라 **구조적으로 0** 이고,
 * `averagePosition` 은 그 null 들을 **제외**하고 평균한다(0 으로 깔면 순위가 실제보다
 * 좋게 왜곡되므로 제외가 옳다).
 *
 * 🔴 문제는 **제외했다는 사실을 화면이 말하지 않은 것**이다 — 「4개 중 1.3번째」만 보면
 *   7개 엔진 전체의 대표값으로 읽힌다. 실제로는 2~3개 엔진 이야기다.
 *   📕 이 저장소 최다 사고 *"못 잰 것을 0이라 부르기"* 의 사촌 —
 *     **못 잰 것을 조용히 빼고 남은 것으로 단정하기.**
 *
 * ⭐ 바로 앞의 「질문 N개 기준」과 **같은 문법·같은 자리**에 둔다(문법이 갈라지지 않게).
 * ⚠️ 폴백 경로는 이 수를 **모른다**(`null`) → 표기를 **생략**한다.
 *   0 으로 깔면 「0개 응답 평균」이라는 거짓이 된다 — 지어내지 않는다.
 */
function rankBasisNote(sampleCount: number | null): string {
  if (sampleCount === null || sampleCount <= 0) {
    return "";
  }
  return ` · 순위는 ${sampleCount}개 응답 평균`;
}

export const DashboardKpis = ({ data, paid }: DashboardKpisProps) => {
  const {
    latestSov,
    sovDeltaPoints,
    coverage,
    totalCount,
    latestMeasuredAt,
    averageMentionPosition,
    averageMentionListSize,
    // 순위 평균의 모집단(N-48) — 아래 캡션에서 「순위는 N개 응답 평균」으로 밝힌다.
    positionSampleCount,
    previousMentionPosition,
    previousSentiment,
    // 모집단 표기용 — 최신 1회분 질문 수(§ 아래 모집단 주석 참조).
    promptScores,
    sentiment,
    trend,
  } = data;

  /*
   * 측정 기록은 있는데(`totalCount > 0`) **히어로 3장이 전부 값이 없는** 경우.
   * 세 값은 서로 다른 경로에서 오지만(등장률=`latestSov` · 순위=`averageMentionPosition`
   * · 감성=`sentiment`) **셋 다 없으면** 사용자가 볼 수 있는 결과가 하나도 없다는 뜻이다.
   * ⚠️ `totalCount > 0` 을 반드시 함께 본다 — 측정 자체가 0회인 신규 조직은
   *   "결과를 읽지 못했다"가 아니라 그냥 **아직 안 한 것**이라 이 문구가 틀린 말이 된다.
   * ⚠️ `coverage` 도 함께 본다(**이 문구가 만드는 새 모순 방지**). `coverage` 는
   *   `completed[0]` 에서 바로 나오는데 `latestSov` 는 *브랜드명 일치*까지 통과해야 한다
   *   → 브랜드명 없는 구(舊) job 이 최신이면 `sameBrand` 가 비어 `latestSov` 만 null 이 된다.
   *   그때 이 문구를 붙이면 **"7곳에서 등장 · 볼 수 있는 결과가 없어요"** 가 되어
   *   내가 고치려던 것과 같은 종류의 자기모순이 된다. 등장 정보가 있으면 볼 게 있는 것이다.
   */
  const hasNoUsableResult =
    totalCount > 0 &&
    coverage === null &&
    latestSov === null &&
    averageMentionPosition === null &&
    sentiment === null;

  // 1-6 스파크라인 계열. trend 는 오래된→최신 asc(두 소스 경로 공통) + **같은 브랜드만**
  //   (2026-08-06 브랜드 필터 수정) → 그대로 쓰면 된다.
  //   감성은 측정마다 null 이 섞이므로 제외한다 — 0으로 깔면 "부정적으로 변했다"는
  //   거짓 신호가 되는 것이 1-5(connectNulls={false})와 같은 이유다.
  const sovSeries = trend.map((point) => point.sov);
  const positiveSeries = trend
    .map((point) => point.positiveRate)
    .filter((rate): rate is number => rate !== null);
  // D9(2026-08-07): 순위 스파크라인. 3장 중 2장만 있어 리듬이 깨져 있었다(감사 D9).
  //   감성과 같은 이유로 null 을 **걸러낸다** — 0으로 깔면 "1등이 됐다"는 정반대 신호가 된다.
  //   ⚠️ 순위는 낮을수록 좋으므로 그리는 쪽에 `lowerIsBetter` 를 준다(부호 반전 → 위=개선).
  const positionSeries = trend
    .map((point) => point.position)
    .filter((position): position is number => position !== null);

  // 순위 카드 주숫자(세션N-10). 분모가 있으면 "N개 중 M번째", 없으면 순위만.
  //   ⚠️ 분모 없는 과거 측정분에 "N개 중"을 지어내지 않는다.
  let positionValue = "—";
  if (averageMentionPosition !== null) {
    positionValue =
      averageMentionListSize === null
        ? `${averageMentionPosition}번째`
        : `${averageMentionListSize}개 중 ${averageMentionPosition}번째`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          badge={
            sovDeltaPoints !== null && sovDeltaPoints !== 0 ? (
              <SovDeltaBadge delta={sovDeltaPoints} />
            ) : undefined
          }
          hint={
            coverage
              ? // 🔴 2026-08-16 — `N곳에 물어` 는 **시도(attempted)** 처럼 읽힌다.
                //   실제 `coverage.total` 은 Tracking 행이 **실제로 쌓인 엔진 수**(=measured)다
                //   (dashboard-data.ts:556 `new Set(group.map(r=>r.engineId))`).
                //   응답 못 받은 엔진은 애초에 행이 없어서 이 수에 안 들어간다.
                //   web 은 이미 `측정한 AI N곳` 이라고 쓴다 → 같은 값을 두 앱이 다르게 부르던 것.
                `측정한 AI ${coverage.total}곳 중 ${coverage.mentioned}곳이 우리를 말했어요`
              : // 🔴 **값이 있으면 빈 상태 문구를 쓰지 않는다** (N-46 · 스크린샷이 잡음).
                //   값(`latestSov` ← `metrics.sov`)과 힌트(`coverage` ← `metrics.enginesCovered`)가
                //   **서로 다른 필드**를 본다. `enginesCovered` 만 비면 `coverage=null` 이 되어
                //   **「62%」 옆에 「측정하면 …보여드려요」** 가 떴다.
                //   📕 N-45 온보딩 4단계와 같은 유형(조건부 값 + 무조건 설명).
                latestSov === null
                ? "측정하면 AI가 우리를 아는지 보여드려요"
                : "이번 회차는 AI별 집계가 없어 비율만 보여드려요"
          }
          // 🔴 **라벨을 값의 축에 맞춘다** (N-46 · 👤 Ⓐ안 · 라이브 실측으로 확정).
          //   라벨은 `recognition`(엔진 축 · **곳**)인데 값은 `sov`(응답 축 · **%**)였다.
          //   라이브에서 *"AI가 우리를 아나? **95%**"* 밑에 *"7곳 중 **7곳**"*(=100%)이 붙어
          //   **고객이 검산하면 안 맞는다**. 📕 N-30 *"축이 다른 두 숫자를 나란히 두면
          //   검산하려 든다"*. 두 숫자 다 맞고, **한 카드에 둔 것**이 틀렸다.
          //   → 큰 숫자를 `sov` 로 유지하고 **질문을 sov 의 질문으로** 바꾼다.
          //     밑줄(7곳 중 7곳)은 엔진 축 그대로 두어 **서로 보완**하게 만든다.
          label={METRICS.sov.question}
          sparkline={
            <KpiSparkline
              color="var(--findable-primary, #ff7a4d)"
              values={sovSeries}
            />
          }
          tier={latestSov === null ? undefined : visibilityTier(latestSov)}
          value={latestSov === null ? "—" : `${latestSov}%`}
        />

        {/* 순위 → /compare. 순위는 본질적으로 **경쟁 개념**이라(몇 번째 = 누구 다음)
            "그래서 누구한테 밀리나"가 바로 다음 질문이 된다. */}
        <KpiCard
          // 🔴 방향은 지표 사전이 단독으로 정한다 — 화면이 "낮을수록 좋음"을
          //   직접 써넣으면 사전과 갈라질 수 있다(같은 수치 2벌 금지와 같은 규율).
          directionNote={directionHint("rank")}
          hint={positionHint(averageMentionPosition, previousMentionPosition)}
          href="/compare"
          label={METRICS.rank.question}
          locked={!paid}
          lockedNote="경쟁사 비교는 Growth부터 열려요"
          sparkline={
            <KpiSparkline
              // 중립색(ink-subtle). §9 색 규율 — 등장률=primary·긍정=dancheong 은
              //   추세 차트에서 그 지표를 뜻하는 색으로 이미 굳었다. 순위는 차트에
              //   계열이 없어 배정된 색이 없으므로, 새 색을 만들지 않고 중립으로 둔다
              //   (색을 늘리면 "색=지표"라는 규율이 흐려진다).
              color="var(--findable-ink-subtle, #8a8f98)"
              // 순위는 **낮을수록 좋다** → 부호 반전해 "위로 가면 개선"을 3장에서 통일.
              lowerIsBetter
              values={positionSeries}
            />
          }
          tier={
            averageMentionPosition === null
              ? undefined
              : positionTier(averageMentionPosition)
          }
          value={positionValue}
        />

        {/* 🔴 감성 → `/actions` (세션N-34 재연결).
            예전엔 `/sources` 로 갔는데 **그 화면엔 감성이 한 줄도 없다**(`grep sentiment` 0건).
            즉 무료로 보여준 숫자를 눌렀더니 **딴 주제(출처 링크)의 결제 벽**이 떴다
            = 카드가 한 약속을 목적지가 배신하는 링크였다(v4 §탭5 *"재연결 필요"*).
            감성 데이터 자체는 **무료**다(`summarizeSentiment` · plan 게이트 없음) →
            `locked` 도 뗀다. "좋게 말하나?"의 다음 질문은 "그래서 뭘 고치나?"라
            처방이 있는 「지금 할 일」이 정직한 목적지다. */}
        <KpiCard
          comparison={
            sentiment
              ? sentimentComparison(sentiment, previousSentiment)
              : undefined
          }
          hint={sentimentHint(sentiment)}
          href="/actions"
          label={METRICS.sentiment.question}
          sparkline={
            <div className="flex flex-col gap-2">
              {/* D8: 스택바가 스파크라인 **위**. 스파크라인은 "시간에 따른 변화"고
                  스택바는 "지금의 구성"이다 — 힌트(긍정 5 · 보통 28)가 방금 말한
                  분해를 바로 아래에서 그림으로 받는 편이 읽는 순서에 맞다. */}
              {sentiment ? <SentimentBar summary={sentiment} /> : null}
              <KpiSparkline
                // 단청(teal) — 추세 차트의 긍정 비율 계열과 **같은 색**을 쓴다.
                // 같은 지표가 두 화면 요소에서 다른 색이면 색이 의미를 잃는다(§9 색 규율).
                color="var(--findable-dancheong, oklch(0.58 0.110 195))"
                values={positiveSeries}
              />
            </div>
          }
          tier={sentiment ? sentimentTier(sentiment) : undefined}
          // 🔴 비율 계산은 `positiveRateOf`(단일 진실) — 여기서 다시 나누지 않는다.
          //   같은 식이 3벌이면 한쪽 반올림만 바뀌어도 **카드 값과 추세선이 갈린다**.
          value={
            sentiment === null ? "—" : `긍정 ${positiveRateOf(sentiment)}%`
          }
        />
      </div>

      {/* A안 — 운영지표는 성과와 같은 자리를 차지하지 않는다(Apple Deference:
          "UI는 콘텐츠와 경쟁하지 않는다"). 정보는 유지하고 위계만 내린다.

          🔴 **모집단 명시**(2026-08-17 세션N-40) — 위 히어로 3장의 퍼센트·순위가
            **무엇을 분모로 한 값인지** 이 줄이 유일하게 답한다.
            경쟁사 실측(프레임 47장): 모집단을 그 자리에 적는 곳은 Otterly
            (`Report based on 25 prompts`)·Scrunch(`20/500`) **2곳**이고
            우리만 **없었다**(v4 §2-c 자기진단과 일치).
            ⚠️ 질문 수는 `promptScores`(최신 1회분) 길이 = 실제 측정된 질문 수다.
              **0이면 아무것도 쓰지 않는다** — AuditJob 폴백 경로엔 프롬프트 원장이
              없어 빈 배열이고(`dashboard-data.ts` 주석), 그때 "질문 0개 기준"은
              측정이 없다는 뜻이 아니라 **원장이 없다는 뜻**이라 오독을 만든다. */}
      {/* 🔴 **측정 횟수와 카드가 서로 다른 말을 하지 않게 한다**(N-43 스크린샷 사고).
            `totalCount` 는 **전체 job 수**인데(`dashboard-data.ts` `jobs.length`)
            히어로 3장의 값은 *completed + sov 있음 + 브랜드명 일치* 를 다 통과해야 생긴다
            (`latestSov`). 그래서 측정이 전부 실패하거나 브랜드명 추출이 빗나가면
            화면이 **"측정 34회"** 라고 말하면서 카드는 전부 **"측정하면 …보여드려요"** 였다.
            → 횟수를 **숨기지 않는다**(측정을 돌린 건 사실이다). 대신 **값이 없다는 사실을
              그 자리에서 말한다** — 없는 성과를 좋게 포장하지 않는 것과 같은 규율이다. */}
      <p className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-sm">
        측정 {totalCount}회
        {latestMeasuredAt ? ` · ${formatMeasuredAt(latestMeasuredAt)}` : ""}
        {coverage
          ? ` · 측정한 AI ${coverage.total}곳 중 ${coverage.mentioned}곳에서 등장`
          : ""}
        {promptScores.length > 0 ? ` · 질문 ${promptScores.length}개 기준` : ""}
        {rankBasisNote(positionSampleCount)}
        {hasNoUsableResult
          ? " · 아직 볼 수 있는 결과가 없어요(측정이 완료되지 않았거나 결과를 읽지 못했어요)"
          : ""}
      </p>

      <MetricGlossary />
    </div>
  );
};

/**
 * 지표 뜻풀이 — v4 완료기준 *"화면에서 답 못 할 질문 0"* 의 마지막 구멍.
 *
 * 🔴 **왜 필요했나**: `metric-dictionary.ts` 는 지표 5종의 **평문 정의**(`description`)를
 *   갖고 있는데 **어느 화면도 그걸 렌더하지 않았다**(grep 0건 — 화면이 쓰는 건
 *   `label`·`question`·`directionHint` 뿐). 즉 사전은 있는데 고객은 못 읽었다.
 *   특히 `등장 ≠ 인용` 구분은 사전이 명시적으로 경고하는 혼동인데도 화면에 없었다.
 *
 * 🔴 **왜 툴팁(ⓘ)이 아닌가** — 원래 계획은 카드마다 ⓘ 툴팁이었다. 착수하고 보니 둘 다 막혔다:
 *   ① **카드 3장 중 2장이 `<Link>`** 다(순위→`/compare`·감성→`/actions`).
 *      링크 안에 툴팁 트리거(버튼)를 넣으면 **중첩 인터랙티브**가 되어 키보드·스크린리더가 깨진다.
 *   ② **툴팁은 터치에 없다.** hover 가 없는 모바일이 정작 화면이 가장 긴 곳이다.
 *   → `<details>` 는 네이티브라 **터치·키보드·스크린리더가 전부 공짜로** 되고 JS 0줄이다.
 *
 * ⭐ **접힌 상태로 둔 이유**: 대시보드 축소(모바일 4,312px)가 다음 과제다. 3장 카드에
 *   정의를 상시 노출하면 **줄이려는 총량을 늘린다**. 접으면 ~24px 만 쓴다.
 *   ⚠️ 사전 주석은 *"툴팁이 아니라 본문에 쓸 수 있는 문장"* 이라고 적혀 있다 — 그 취지는
 *   **숨기지 말라**가 아니라 *"툴팁에만 의존하지 말라"* 다. `<details>` 는 hover 없이
 *   **누구나 펼칠 수 있는 본문**이라 그 취지를 지킨다.
 *
 * ⚠️ 정의 문장을 여기 복제하지 않는다 — 사전이 단일 진실이다(같은 값 2벌 금지).
 */
const MetricGlossary = () => (
  <details className="group">
    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs hover:text-[color:var(--findable-ink-subtle,#8a8f98)]">
      {/* marker 제거는 list-none + ::-webkit-details-marker 양쪽이 필요하다 */}
      <span className="[&::-webkit-details-marker]:hidden">
        이 숫자들, 무슨 뜻인가요?
      </span>
      <ChevronDown
        aria-hidden="true"
        className="size-3 transition-transform group-open:rotate-180"
      />
    </summary>
    <dl className="mt-3 flex flex-col gap-2 border-[color:var(--findable-hairline,#26292e)] border-l-2 pl-3">
      {GLOSSARY_KEYS.map((key) => (
        <div className="flex flex-col gap-0.5" key={key}>
          <dt className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
            {METRICS[key].label}
            {/* 방향은 사전이 단독으로 정한다 — 화면이 "낮을수록 좋음"을 직접 쓰지 않는다 */}
            {directionHint(key) ? (
              <span className="ml-1.5 text-[color:var(--findable-ink-tertiary,#7e8289)]">
                {directionHint(key)}
              </span>
            ) : null}
          </dt>
          <dd className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs leading-relaxed">
            {METRICS[key].description}
          </dd>
        </div>
      ))}
    </dl>
  </details>
);

/**
 * 뜻풀이에 넣는 지표 순서 = **카드가 놓인 순서**(등장률 → 순위 → 감성) 다음에
 * 카드엔 없지만 혼동이 큰 2종(우리를 아는 AI · 인용).
 * ⚠️ 사전의 `MetricKey` 5종 전부를 덮는다 — 빠뜨리면 "사전엔 있는데 화면엔 없는" 상태가
 *   다시 생긴다. 사전에 키가 추가되면 여기도 같이 늘어나야 한다(테스트가 그걸 문다).
 */
const GLOSSARY_KEYS = [
  "sov",
  "rank",
  "sentiment",
  "recognition",
  "citation",
] as const satisfies readonly MetricKey[];

// 비교값 폴백 3단계(기획서 §4-1) — 리서치 3중 요구("맥락 없는 절대값 금지").
//   경쟁사 평균은 Tracking.rawResponse 파싱이 필요해 대시보드 소스에 없다
//   (실측: 브랜드 2/7만 보유) → 여기서는 2·3단계만 구현한다.
//   1단계(경쟁사 평균)는 /compare 가 이미 렌더링 중.
function positionHint(
  position: number | null,
  previous: number | null
): string {
  if (position === null) {
    return "AI가 우리를 언급하면 순위를 알려드려요";
  }
  if (previous === null) {
    return "비교는 2회차 측정부터 보여드려요";
  }
  const diff = Math.round((previous - position) * 10) / 10;
  if (diff === 0) {
    return `지난 측정과 같아요 (${previous}번째)`;
  }
  // 순위는 낮을수록 좋다 — diff>0 이면 개선.
  return diff > 0
    ? `지난 측정 ${previous}번째에서 ${diff} 올랐어요`
    : `지난 측정 ${previous}번째에서 ${Math.abs(diff)} 내렸어요`;
}

// D5(2026-08-07): 감성만 이전 기간 비교가 없었다(SoV=델타 배지 · 순위=힌트 문장).
//   리서치 `02:91`: *"모든 지표는 항상 이전 기간 비교 — 맥락 없는 절대값 금지"*.
//   ⚠️ 배지(SoV 방식)가 아니라 **문장**으로 붙인다: 카드 하나에 스택바(D8)까지 들어가
//   요소가 이미 많고, 순위 카드가 쓰는 방식과 맞추는 편이 3장의 리듬을 지킨다.
//   ⚠️ 하락에 빨강을 쓰지 않는다(§9-2 GSC 안티패닉) — 문장으로만 서술.
// `export` — 테스트가 **실제 함수**를 검사하게 한다(복제하면 갈라진다).
export function sentimentComparison(
  current: SentimentSummary,
  previous: SentimentSummary | null
): string {
  if (!previous) {
    // 순위 카드와 같은 안내(positionHint) — 3장의 어투를 맞춘다.
    return "비교는 2회차 측정부터 보여드려요";
  }
  // 🔴 카드 값과 **같은 함수**로 낸다 — 여기만 따로 계산하면
  //   "긍정 40%" 옆에 "지난번보다 +3%p" 가 서로 안 맞는 날이 온다.
  const previousRate = positiveRateOf(previous) ?? 0;
  const diff = (positiveRateOf(current) ?? 0) - previousRate;
  if (diff === 0) {
    return `지난 측정과 같아요 (긍정 ${previousRate}%)`;
  }
  return diff > 0
    ? `지난 측정 긍정 ${previousRate}%에서 ${diff}%p 올랐어요`
    : `지난 측정 긍정 ${previousRate}%에서 ${Math.abs(diff)}%p 내렸어요`;
}

function sentimentHint(summary: SentimentSummary | null): string {
  if (!summary) {
    return "측정하면 AI가 우리를 어떻게 말하는지 보여드려요";
  }
  // D8: 부정이 0이어도 **적는다**. 주 숫자가 `긍정 15%` 하나뿐이면
  //   "나머지 85%는 부정인가?"로 읽히는데 실제로는 전부 중립인 경우가 있다
  //   (실측: 중립 28 · 긍정 5 · 부정 0). 0을 생략하면 그 오독을 못 막는다.
  //   총 건수까지 붙여 분모를 명시한다 — 감사 D8 *"분모가 보여야 임의적이지 않다"*.
  const parts = [
    `긍정 ${summary.positive}`,
    `보통 ${summary.neutral}`,
    `부정 ${summary.negative}`,
  ];
  return `${parts.join(" · ")} · 총 ${summary.total}건`;
}

// 델타 배지. §9-2 + 리서치: 하락에 빨강을 쓰지 않는다.
//   🎯 GSC는 하락에 색상 경고를 **아예 안 쓴다**(의도적 안티패닉 설계). 0점 고객이 많은
//   제품에서 온통 빨강이면 재방문하지 않는다. 색맹의 99%가 적녹이라 접근성 문제도 겹친다.
//   → 상승만 초록으로 강조하고, 하락은 **중립 회색 + 화살표 + 텍스트**로 사실만 전달.
//   (Atlassian: 상태색은 비색상 신호 병기 필수 — 화살표·부호가 색 없이도 방향을 말한다)
const SovDeltaBadge = ({ delta }: { delta: number }) => {
  const positive = delta > 0;
  const rounded = Math.abs(Math.round(delta * 10) / 10);
  return (
    <span
      className={cn(
        "mb-1 inline-flex items-center gap-0.5 rounded-full border border-transparent px-2 py-0.5 font-medium text-xs",
        positive
          ? "bg-emerald-500/12 text-emerald-400"
          : "bg-[color:var(--findable-surface-3,#18191a)] text-[color:var(--findable-ink-subtle,#8a8f98)]"
      )}
    >
      {positive ? (
        <ArrowUpRight aria-hidden="true" className="size-3" />
      ) : (
        <ArrowDownRight aria-hidden="true" className="size-3" />
      )}
      <span className="tabular-nums">
        {positive ? "+" : "−"}
        {rounded}%p
      </span>
    </span>
  );
};
