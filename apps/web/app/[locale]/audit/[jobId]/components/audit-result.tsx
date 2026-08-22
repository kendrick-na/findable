"use client";

// Audit 결과 페이지 — research 12·13·14·15 통합 3차 재설계
//
// 핵심 변경:
//   1. 다크 모드 우선 (bg-zinc-950) + 메쉬 그라디언트 BG (페이지 레벨)
//   2. McKinsey Action Title — 헤드라인이 숫자 아닌 완전한 한 문장 결론
//   3. Score Donut conic-gradient 글로우 + motion 카운트업
//   4. KPI 4 tile (Profound 패턴) — 큰 숫자 + 그라디언트 텍스트
//   5. Monday Action — spotlight hover (Vercel·Aceternity 패턴)
//   6. Top Actions — stagger reveal + rank 1 글로우
//   7. Engine Tabs — layoutId 슬라이드 (Linear 패턴)
//   8. Citation 칩 — Perplexity 패턴 (favicon + %)
//   9. 메타 라벨 — 차분한 국문 라벨(text-xs font-medium, 2026-07-30 slop 제거)
//  10. 한국어 본문 line-height 1.7, 본문 단색 zinc

import { analytics } from "@repo/analytics";
import { BRIEFING_FAIL_PREFIX } from "@repo/ai/lib/engines/briefing-failure";
import {
  type CrewTriggerOutcome,
  trackAuditCompleted,
  trackCrewTriggered,
  trackReportViewed,
} from "@repo/analytics/funnel";
import { objectParticle } from "@repo/audit/actions";
import {
  geoAxisScores,
  type ScoreTier,
  scoreTier,
  TIER_LABEL_EN,
  TIER_LABEL_KO,
} from "@repo/audit/geo-score";
import {
  countMeasurementCoverage,
  isMeasurementFailure,
} from "@repo/audit/measurement-coverage";
import { detailedRankLabel } from "@repo/audit/rank-label";
import { inferBrandSize } from "@repo/audit/revenue-impact";
import { stripMarkdown } from "@repo/audit/strip-markdown";
import { Button } from "@repo/design-system/components/ui/button";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  Loader2,
  Mail,
  MessageCircle,
  RotateCw,
  Search,
  Sparkles,
  Target,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CompetitorBenchmark } from "./competitor-benchmark";
import { CopilotChat } from "./copilot-chat";
import { NaverVsAiGap } from "./naver-vs-ai-gap";
import { RevenueImpactCard } from "./revenue-impact-card";
import { TruthMirror } from "./truth-mirror";

interface Props {
  jobId: string;
  locale: string;
}

// ──────────────────────────────────────────────────────────────────
// 타입 (orchestrator AnalystOutput·StrategistOutput과 일치)
// ──────────────────────────────────────────────────────────────────

type Severity = "red" | "amber" | "green";
type CrewStatus =
  | "not_requested"
  | "queued"
  | "processing"
  | "completed"
  | "failed";
type BriefingStatus = "not_requested" | "processing" | "completed" | "failed";

interface Finding {
  detail: string;
  severity: Severity;
  title: string;
  whyItMatters: string;
}
interface AnalystOutput {
  dataGaps: string[];
  executiveSummary: string;
  findings: Finding[];
  observation: string;
}
interface ActionItem {
  channel: string;
  effort: number;
  expectedTimeframe: string;
  impact: number;
  princetonStrategy: string;
  rank: number;
  rationale: string;
  steps: string[];
  title: string;
}
interface StrategistOutput {
  executiveSummary: string;
  mondayActionOne: {
    title: string;
    whyThisOne: string;
    expectedOutcome: string;
  };
  topActions: ActionItem[];
}
interface AnalystReport {
  agentId: "minji" | "alex" | "sujin";
  displayName: string;
  durationMs: number;
  emoji: string;
  errorMessage: string | null;
  output: AnalystOutput | null;
  rawText: string | null;
  role: string;
}
interface StrategistReport {
  agentId: "junho";
  displayName: string;
  durationMs: number;
  emoji: string;
  errorMessage: string | null;
  output: StrategistOutput | null;
  rawText: string | null;
  role: string;
}
interface CrewReport {
  analysts?: AnalystReport[]; // 신 구조 (재설계 후)
  isStub: boolean;
  reports?: unknown[]; // 옛 구조 호환 (구 jobId)
  strategist?: StrategistReport; // 신 구조
  totalDurationMs: number;
}
interface JobMetrics {
  /** 순위가 나온 목록들의 평균 크기(분모). 세션N-10 이전 job 엔 없음. */
  averageMentionListSize?: number | null;
  averageMentionPosition: number | null;
  /**
   * 상대 위치 0~1. **geoAxisScores 로 그대로 넘어가 competition 채점에 쓰인다** —
   * 이 필드를 여기서 빠뜨리면 화면 점수만 옛 식으로 계산돼 메일·OG와 어긋난다
   * (세션N-8이 잡은 화면↔메일 32점 불일치와 같은 계열의 사고).
   */
  averageRelativePosition?: number | null;
  enginesCovered: string[];
  enginesWithMention: string[];
  errors: Array<{ engineId: string; message: string }>;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sov: number;
  stubCount: number;
  topCitedDomains: Array<{ domain: string; count: number }>;
}
interface JobResult {
  brandName: string;
  /**
   * 내 브랜드 표기 변형 — 경쟁사 집계에서 「아모레퍼시픽」과 「Amorepacific」 을
   * 하나로 합치는 데 쓴다. 🔴 구 job 엔 없다(러너가 N-45 부터 싣는다) → optional.
   */
  brandVariants?: string[];
  /** 브리핑 측정에 채택된 검색 질의(전수감사 §A-5). 구 job 엔 없음. */
  briefingPrompt?: string;
  briefingStatus?: BriefingStatus;
  domain: string;
  engineResponses: Array<{
    engineId: string;
    brandMentioned: boolean;
    mentionPosition: number | null;
    sentiment: "positive" | "neutral" | "negative" | null;
    sov: number | null;
    durationMs: number;
    isStub: boolean;
    errorMessage: string | null;
    excerpt: string;
  }>;
  // 세션K-2 액션 레이어. 러너가 이미 result 에 적재하므로(runner.ts) 여기서
  // 읽어 쓰는 것만으로 추가 AI 호출·원가 0. 구 jobId 엔 없어서 optional.
  geoActions?: GeoActionView[];
  /**
   * 시장 분해(2026-08-02 세션M). 구 job 엔 없어서 optional —
   * 없으면 기존 통합 점수만 보여준다(회귀 0).
   */
  marketScope?: "korea" | "global" | "both";
  marketScopeReason?: string;
  metrics: JobMetrics;
  promptsCount: number;
  regions?: RegionScoreView[];
  /**
   * 고객이 등록한 경쟁사 — ⛔ **거르는 목록이 아니라 표기 병합 사전**(👤 승인 ⓐ).
   * 로그인 측정에만 있다(무료 진단은 `brandId` 가 없다) · 구 job 엔 없다 → optional.
   */
  registeredCompetitors?: Array<{ aliases?: string[]; name: string } | string>;
  topRecommendations: string[];
}
/** packages/audit/runner.ts RegionScore 와 동일 모양(클라 컴포넌트라 타입만 재선언). */
interface RegionScoreView {
  enginesMeasured: number;
  label: string;
  mentionRate: number;
  region: "korea" | "global";
  score: number;
}

/** packages/audit/actions.ts GeoAction 과 동일 모양(클라 컴포넌트라 타입만 재선언). */
interface GeoActionView {
  evidence: string;
  how: string;
  kind: string;
  priority: 1 | 2 | 3;
  source?: string;
  title: string;
}
interface JobResponse {
  completedAt: string | null;
  createdAt: string;
  crewCompletedAt: string | null;
  crewResult: CrewReport | null;
  crewStartedAt: string | null;
  crewStatus: CrewStatus;
  domain: string;
  // 세션L L-1: 결과 소유권 연결(같은 이메일로 가입해야 결과가 이어짐) 안내용.
  emailDomain?: string | null;
  emailMasked?: string | null;
  errorMessage: string | null;
  /**
   * 투두 #59(2026-08-07) — 같은 이메일·같은 브랜드의 **직전 측정** 비교.
   * ⚠️ 무료에는 "직전 1회"만 준다. 전체 추세·차트는 유료(대시보드) 축이다
   *   (리서치 결론: 유료가 이겨야 할 축 = 시간·비교·알림).
   * 첫 측정이면 전부 null·totalRuns=1 → 배지가 아예 렌더되지 않는다.
   */
  history?: {
    deltaPoints: number | null;
    previousAt: string | null;
    previousJobId: string | null;
    previousScore: number | null;
    totalRuns: number;
  } | null;
  jobId: string;
  language: string;
  pdfUrl: string | null;
  result: JobResult | null;
  status: "queued" | "processing" | "completed" | "failed";
}

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  "chatgpt-web": "ChatGPT (Web)",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  hyperclova: "HyperCLOVA X",
  naver: "Naver",
  "naver-briefing": "Naver AI 브리핑",
  daum: "Daum",
};
const CHANNEL_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  reddit: "Reddit",
  naver_blog: "네이버 블로그",
  naver_cafe: "네이버 카페",
  naver_jisikin: "네이버 지식인",
  tistory: "티스토리",
  brunch: "브런치",
  youtube: "유튜브",
  owned_site: "자사 사이트",
  amazon: "Amazon",
  // B2B·기술 채널 (2026-08-02) — 업종 편향 수정으로 crew가 실제 도출 가능해짐
  press_release: "보도자료",
  industry_media: "업계 전문매체",
  official_docs: "공식 문서",
  review_platform: "리뷰·비교 플랫폼",
  developer_community: "개발자 커뮤니티",
  case_study: "도입 사례",
  ir_disclosure: "IR·공시",
  other: "기타",
};

// ──────────────────────────────────────────────────────────────────
// SoV 점수 → Severity (Lighthouse: 0.9 / 0.5 boundary, research 12)
// ──────────────────────────────────────────────────────────────────

function sovSeverity(sov: number): Severity {
  if (sov >= 70) {
    return "green";
  }
  if (sov >= 40) {
    return "amber";
  }
  return "red";
}

// GEO **총점**(0~100) 4등급 라벨. 4단계 구분은 HubSpot(research 13) 차용.
//
// ⚠️ 이름 정정(2026-08-03 세션N): 원래 `sovLabel(sov)` 였으나 **호출부는 처음부터
//   GEO 총점을 넘기고 있었다**(값은 맞고 이름만 거짓). SoV 는 총점에서 **10점 배점뿐**이라
//   여기에 SoV(0~100%)를 넣으면 등급이 전혀 달라진다 — 즉 이름을 믿고 SoV 를 넣는 순간
//   등급이 전면 오류가 된다. 같은 SoV↔총점 혼동이 과거 OG 이미지를 이미 한 번 깨뜨렸다
//   (📕 app/api/og/audit/[jobId]/route.tsx 의 결함감사 §OG 주석).
//   → 동작은 그대로 두고 이름·주석만 계약에 맞게 바로잡는다. **반드시 총점을 넘길 것.**
//
// ✅ 임계값 3중 복제 해소 (2026-08-07 세션N-8, 감사 10번) — 76/51/26은 이제
//   `@repo/audit/geo-score`의 `SCORE_TIERS` **한 곳**에만 있다. 화면·메일·OG가
//   `scoreTier()`를 공유하므로 하나만 바꿔 어긋나는 일이 구조적으로 불가능하다.
//   ⚠️ 임계값을 바꿔야 하면 `geo-score.ts`를 고칠 것. 여기서 다시 비교하지 말 것.
//   실측(세션N): 임계값 자체는 정상 — 인지100%·감성 절반긍정이면 80점=리더 도달 가능.
// 🔴 티어가 **무슨 뜻인지** 한 줄 (2026-08-06 세션N-7)
//   거절사유: *"품의에 올릴 게 '73점'인데 73점이 좋은 건지 나쁜 건지 화면 어디에도 없다.
//   '경쟁 가능' 딱지 하나로 예산 위원회를 통과 못 한다."*
//   근거 ① 리서치 02번: Profound는 *"43.8%, 339위"*로 **항상 순위를 병기**한다
//        — "숫자만으론 좋은지 나쁜지 모른다"가 15개 툴 교차 결론.
//        ② Ahrefs가 DR을 *"우리 DB 내 다른 사이트 대비"*로 프레이밍하는 수법 —
//        **닫힌 일관 인덱스**로 설명하면 "툴마다 점수가 다르다"는 반박을 피한다.
//        ③ Moz 반면교사: *"기저 척도를 UI가 알려주지 않으면 사용자 혼란"*.
//   ⚠️ 동종 백분위·경쟁사 평균은 **아직 데이터가 없다**(실고객 0명, 표본 대부분 자기 테스트).
//   없는 비교군을 지어내지 않고, **점수의 정의 자체**를 풀어 쓴다(구간이 무엇을 의미하는지).
//   실고객 데이터가 쌓이면 여기에 "상위 N%"를 추가하는 것이 다음 단계.
//   🔬 자기정정(같은 세션): 첫 문안은 *"AI 절반 이상이 우리를 알지만"* 처럼 **인지 축**으로
//     설명했는데, 총점은 5축 합이라 **인지 축과 어긋난다**. 실측 반례가 바로 이 화면이었다 —
//     클로드는 총점 73(=경쟁 가능)인데 인지 축은 **85%**다. "절반 이상"이 거짓이 된다.
//     합성 점검에서도 총점55·인지100%, 총점80·인지50% 처럼 모순 구간이 다수 나왔다.
//     → 문구는 **총점이 뜻하는 것**(5개 항목 종합 수준)만 말하고, 개별 축 수치는 언급하지 않는다.
const TIER_MEANING_KO: Record<ScoreTier, string> = {
  leader: "5개 항목이 고르게 좋아요. 지금 자리를 지키는 게 관건이에요",
  competitive: "기본은 갖췄고, 약한 항목을 올리면 리더 구간이에요",
  emerging: "약한 항목이 여럿이에요. 그래서 올리기도 가장 쉬운 구간이에요",
  critical: "대부분 항목이 낮아요. 어디부터 손볼지 아래에서 알려드려요",
};

const TIER_MEANING_EN: Record<ScoreTier, string> = {
  leader: "Strong across all five factors — now it's about holding position",
  competitive:
    "Fundamentals are in place; lift the weak factors to reach leader range",
  emerging:
    "Several weak factors — which also makes this the easiest range to improve",
  critical: "Most factors are low. See below for where to start",
};

/**
 * 직전 측정 대비 배지 (투두 #59, 2026-08-07).
 *
 * 표시 규칙:
 *   · 첫 측정(비교 대상 없음) → **아무것도 안 띄운다**. "첫 측정입니다" 같은 빈 상태는
 *     정보가 0인데 자리만 차지한다(감사 4번 "빈 카드" 교훈).
 *   · 하락에 **빨강을 쓰지 않는다** — GSC 안티패닉·토스 심사기준(세션N-7에서 web 에 이식한 규율).
 *     오른 건 초록, 내린 건 중립 회색으로 사실만 말한다.
 *   · 변화 0이면 "그대로"로 명시한다(배지를 숨기면 "비교를 안 했나?"가 된다).
 */
function PreviousRunBadge({
  history,
  isKo,
}: {
  history: JobResponse["history"];
  isKo: boolean;
}) {
  const delta = history?.deltaPoints;
  if (!history || delta === null || delta === undefined) {
    return null;
  }

  // ⚠️ 하락(delta<0)에 danger 색을 주지 않는다(위 주석). 중립 회색.
  const tone = delta > 0 ? "text-emerald-300/90" : "text-zinc-400";
  const t = previousRunCopy(delta, history, isKo);

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className={`font-medium text-xs ${tone}`}>{t.headline}</span>
      <span className="text-[11px] text-zinc-400">{t.sub}</span>
    </div>
  );
}

/** 배지 문구 — 컴포넌트에서 분기를 빼 복잡도를 낮춘다(파일 전체 복잡도 예산). */
function previousRunCopy(
  delta: number,
  history: NonNullable<JobResponse["history"]>,
  isKo: boolean
): { headline: string; sub: string } {
  const sign = delta > 0 ? "+" : "";
  if (isKo) {
    return {
      headline:
        delta === 0 ? "지난번과 같아요" : `지난번보다 ${sign}${delta}점`,
      sub: `이전 ${history.previousScore}점 · ${history.totalRuns}번째 측정`,
    };
  }
  return {
    headline:
      delta === 0 ? "Same as last time" : `${sign}${delta} vs last time`,
    sub: `was ${history.previousScore} · run #${history.totalRuns}`,
  };
}

function scoreTierMeaning(totalScore: number, isKo: boolean): string {
  const tier = scoreTier(totalScore);
  return isKo ? TIER_MEANING_KO[tier] : TIER_MEANING_EN[tier];
}

function scoreTierLabel(totalScore: number, isKo: boolean): string {
  const tier = scoreTier(totalScore);
  return isKo ? TIER_LABEL_KO[tier] : TIER_LABEL_EN[tier];
}

// ──────────────────────────────────────────────────────────────────
// 5축 점수 분해 (HubSpot 원본 가중치 — research 13 라인 24-32)
//   Sentiment 40 + Presence 20 + Recognition 20 + SoV 10 + Competition 10
// ──────────────────────────────────────────────────────────────────

// ⚠️ M1(2026-08-07 세션N-8) — 5축은 **평평하지 않다.**
//   `geo-score.ts:114·127`: sentiment = raw × recognitionRate · presence = raw × recognitionRate.
//   즉 60/100점(감성40+노출20)이 인지도에 **곱해지는 종속 축**인데, 화면은 5개를 나란히
//   나열해 고객이 *"감성을 고치면 오르겠네"* 로 읽었다 → **처방 방향이 정반대로 안내됐다.**
//   실측(계산식 대입): 감성 원점수는 인지 30%·54%·85%·100% 브랜드가 모두 30~33/40으로
//   거의 같은데, 화면엔 9 / 17 / 27 / 33 으로 찍혔다. **차이를 만든 건 전부 인지도였다.**
//   피해가 가장 큰 쪽이 **인지도 낮은 중소 브랜드 = 우리 타깃**이다(인지 100% 대기업은 왜곡 0).
//   → A안(2단 구조: 인지를 선행 축으로) + B안(실효 상한 병기) 병행. 사용자 승인 2026-08-07.
//   ⚠️ **점수 계산은 1도 안 바꾼다** — total·메일·OG·권역점수 전부 기존 값 유지(F11식 단절 없음).
interface AxisScore {
  /** 인지도에 곱해지는 종속 축인가(감성·노출). 실효 상한 병기 + 2단 구조 배치에 사용 */
  dependsOnRecognition?: boolean;
  /** 실효 만점 = max × recognitionRate. 종속 축에만 존재 */
  effectiveMax?: number;
  hint: string;
  key: "sentiment" | "presence" | "recognition" | "sov" | "competition";
  labelEn: string;
  labelKo: string;
  max: number;
  score: number;
}

// 화면 배치 = 인과 순서(driver → dependents → independents).
//   멤버 순서는 lint `useSortedInterfaceMembers` 강제라 알파벳순이며, 의미 순서와 무관하다.
interface FiveAxisView {
  /** 5축 전부 — 합계 계산·기존 호출부 호환 */
  all: AxisScore[];
  /** 인지도에 종속된 축(감성·노출) */
  dependents: AxisScore[];
  /** 선행 축(인지) — 아래 두 축의 상한을 정한다 */
  driver: AxisScore;
  /** 인지도와 무관한 독립 축(비중·경쟁) */
  independents: AxisScore[];
  /** 인지 비율 0~1 (표시용) */
  recognitionRate: number;
}

function fiveAxisScores(metrics: JobMetrics, isKo: boolean): FiveAxisView {
  // 채점 로직은 @repo/audit/geo-score 단일 진실(리드메일·OG와 동일 숫자).
  //   recognitionRate·Cap 도 거기서 받는다 — 여기서 다시 계산하면 감사 §10(임계값 3중 복제)
  //   과 같은 사고가 난다.
  const {
    sentiment,
    presence,
    recognition,
    sov: sovAxis,
    competition,
    recognitionRate,
    sentimentCap,
    presenceCap,
  } = geoAxisScores(metrics);

  // 🔴 2026-08-11 (세션N-17) — 라벨·힌트가 **척도를 잘못 말하고 있었다**.
  //   실측: `recognitionRate = enginesWithMention.length / usableResponses`(geo-score.ts:170-173)
  //   = **응답 단위**(29회 물어 몇 번 나왔나)인데, 힌트는 "AI가 몇 곳인지"(=엔진 단위)라고 말했다.
  //   그 결과 같은 화면에서 헤드라인 「8곳이 모두」·KPI 「8/8」·「100%」(전부 엔진 단위) 와
  //   이 막대 「80%」(응답 단위)가 **서로 모순돼 보였다**. 숫자는 둘 다 맞다 — 척도가 다를 뿐이다.
  //   → 계산은 건드리지 않고 **라벨이 척도를 정확히 말하게** 고친다(표시층 해결).
  const driver: AxisScore = {
    key: "recognition",
    labelKo: "얼마나 자주 우리를 말하나",
    labelEn: "Mention frequency",
    score: recognition,
    max: 20,
    //   🔬 분모 확인: `usableResponses = metrics.enginesCovered.length` 이고 이 배열은
    //   **응답 1건당 1원소**다(화면의 "총 29회 측정"이 같은 값 — :1408). 엔진 종류 수는
    //   `enginesCoveredUnique.length`(=8) 로 별개다. 즉 이 축의 분모는 **응답 수(29)** 가 맞다.
    hint: isKo
      ? `${metrics.enginesCovered.length}번 물어서 우리가 나온 비율`
      : `Share of ${metrics.enginesCovered.length} answers that mentioned you`,
  };

  const dependents: AxisScore[] = [
    {
      key: "sentiment",
      labelKo: "좋게 말하나",
      labelEn: "Sentiment",
      score: sentiment,
      max: 40,
      effectiveMax: sentimentCap,
      dependsOnRecognition: true,
      hint: isKo ? "AI가 우리를 좋게 말하는지" : "How AI describes you",
    },
    {
      key: "presence",
      labelKo: "노출 품질",
      labelEn: "Presence",
      score: presence,
      max: 20,
      effectiveMax: presenceCap,
      dependsOnRecognition: true,
      hint: isKo
        ? "인용 출처가 얼마나 다양한가"
        : "3rd-party coverage diversity",
    },
  ];

  const independents: AxisScore[] = [
    {
      key: "sov",
      labelKo: "우리 비중",
      labelEn: "Share of Voice",
      score: sovAxis,
      max: 10,
      hint: isKo
        ? "AI 답변에서 우리가 차지한 몫"
        : "Category conversation share",
    },
    {
      key: "competition",
      labelKo: "경쟁 위치",
      labelEn: "Competition",
      score: competition,
      max: 10,
      hint: isKo ? "경쟁사보다 먼저 나오는지" : "Position vs competitors",
    },
  ];

  return {
    driver,
    dependents,
    independents,
    recognitionRate,
    all: [driver, ...dependents, ...independents],
  };
}

function totalFiveAxis(view: FiveAxisView): number {
  return view.all.reduce((sum, a) => sum + a.score, 0);
}

// McKinsey Action Title — 데이터 → 한 문장 결론 (research 14)
// 2026-07-30 결함감사 §1: 고정 카피("절반 이상에서 누락")가 SoV 85 같은 실데이터와
// 정면 모순을 냈음 → 실제 수치만 말하는 문장으로 재설계. 오류 엔진은 분모에서 제외.
function mckinseyHeadline(
  brandName: string,
  metrics: JobMetrics,
  isKo: boolean,
  /** 🔴 측정 성공 엔진 수 — `countMeasurementCoverage`(단일 진실)에서 받는다.
   *  세션N-28: 여기서 `− errored` 로 **직접 계산**하던 것이 화면의 다른 숫자와 어긋났다
   *  (헤드라인 "6곳" vs KPI "7/7" vs 진실거울 "7곳"). 계산을 한 곳으로 모은다. */
  measuredEngines?: number
): string {
  const mentioned = new Set(metrics.enginesWithMention).size;
  const measured = Math.max(
    measuredEngines ?? new Set(metrics.enginesCovered).size - metrics.stubCount,
    1
  );
  const missing = Math.max(measured - mentioned, 0);
  const sov = Math.round(metrics.sov);

  // 🔴 "이번 주 1건 액션으로" 제거 (2026-08-06 세션N-7)
  //   그 시점에 실제 액션 수를 **모른다**(액션은 crew 분석을 눌러야 생기고, 우측 카드는 비어 있다).
  //   app 대시보드는 같은 문제를 이미 인정하고 `N건`에서 N을 뺐다(기획서 1-4:
  //   *"없는 숫자를 지어내지 않고 행동을 말한다"*) → **web에도 같은 규칙 적용**.
  //   ⚠️ 지키지 못할 약속은 토스 심사 탈락 기준(모호·허위 CTA)이자 다크패턴 자가진단 항목이다.
  // 문체도 해요체로 통일 — 세션N-5가 따옴표 리터럴만 세서 이 템플릿들을 놓쳤다.
  if (isKo) {
    if (sov >= 70 && missing === 0) {
      return `${brandName}, 측정한 AI ${measured}곳이 모두 우리를 말해요. 이제 어떻게 말하는지, 순위를 지키는 게 관건이에요.`;
    }
    if (sov >= 70) {
      return `${brandName}, 점유율은 상위권(${sov}%)이지만 AI ${measured}곳 중 ${missing}곳은 아직 우리를 인용하지 않아요.`;
    }
    if (sov >= 40) {
      return `${brandName}, AI 답변 점유율은 ${sov}%예요. 나머지 ${100 - sov}%는 경쟁 브랜드가 가져가고 있어요.`;
    }
    return `${brandName}, AI 검색에서 거의 보이지 않아요. 아래에서 무엇부터 손볼지 알려드려요.`;
  }
  if (sov >= 70 && missing === 0) {
    return `${brandName} is cited by all ${measured} measured AI engines. Now it's about protecting rank and narrative.`;
  }
  if (sov >= 70) {
    return `${brandName} holds a top share (${sov}%), yet ${missing} of ${measured} AI engines still don't cite you.`;
  }
  if (sov >= 40) {
    return `${brandName} holds ${sov}% of AI answers — competitors take the other ${100 - sov}%.`;
  }
  return `${brandName} is nearly invisible in AI search. See below for what to fix first.`;
}

// ──────────────────────────────────────────────────────────────────
// 메인 진입점
// ──────────────────────────────────────────────────────────────────

export function AuditResultView({ jobId, locale }: Props) {
  const isKo = locale.startsWith("ko");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auditCapturedRef = useRef(false);
  // 🔴 `report_viewed` 는 **세션당 1회**만 센다. 폴링(live)과 재방문(revisit) 두 경로가
  //   있어 ref 를 공유해야 같은 조회가 두 번 집계되지 않는다.
  const reportViewedRef = useRef(false);
  // 폴링 루프 제어. 완료 후 멈춘 폴링을 on-demand 트리거(브리핑 등)가 재개할 수 있게
  // 실행 중인 타이머·취소 플래그를 ref로 들고 있는다.
  const pollControlRef = useRef<{
    active: boolean;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>({ active: false, timeoutId: null });

  const runPoll = useCallback(() => {
    const control = pollControlRef.current;
    // 이미 폴링 루프가 돌고 있으면 중복 기동하지 않는다.
    if (control.active) {
      return;
    }
    control.active = true;
    let consecutiveErrors = 0;
    // 백엔드 작업이 processing에 갇혀도(크래시·타임아웃 미처리) 무한 폴링하지 않도록
    // 경과 시간 상한을 둔다. briefing maxDuration 300s + 여유 = 7분.
    const startedAt = Date.now();
    const MAX_POLL_MS = 7 * 60 * 1000;

    async function poll() {
      try {
        const response = await fetch(`/api/audit/${jobId}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        const data = (await response.json()) as JobResponse;
        if (!pollControlRef.current.active) {
          return;
        }
        consecutiveErrors = 0;
        setJob(data);

        // 🔴 세션N-25 — 이 이벤트는 **완료 시점에 발화하는데 이름이 `audit_started`**
        //   였다. 퍼널을 그리면 *"시작"* 칸에 완료 수가 들어가 **시작·완료가 같은 숫자로
        //   보이고 그 구간의 이탈이 0으로 읽힌다** = 계측이 있는데 거짓말을 한다.
        //   → 완료는 `audit_completed`(공용 `funnel.ts`)로 보낸다.
        //   ⚠️ 같은 순간을 두 이벤트로 보내지 않는다 — 이름만 바꾼다(중복 집계 금지).
        //   ⚠️ 기존 대시보드가 `audit_started` 를 보고 있었다면 이름이 바뀌므로
        //      **PostHog 인사이트를 함께 고쳐야 한다**(코드가 조용히 숫자를 바꾸지 않게 기록).
        if (
          !auditCapturedRef.current &&
          data.status === "completed" &&
          data.result
        ) {
          auditCapturedRef.current = true;
          const enginesCovered = new Set(
            data.result.metrics?.enginesCovered ?? []
          ).size;
          trackAuditCompleted({
            domain: data.domain,
            enginesCovered,
            durationSec: Math.round((Date.now() - startedAt) / 1000),
          });
          // 🔴 세션N-39 — **생산(측정 완료)과 소비(사람이 봄)는 다른 사건이다.**
          //   여기까지 온 사람은 결과가 실제로 그려지는 걸 본다 → `live`.
          //   ⚠️ 재방문·링크 공유는 이 폴링 분기에 **안 들어온다**(이미 completed 라
          //     폴링이 돌지 않는다) → 아래 별도 effect 가 `revisit` 으로 센다.
          if (!reportViewedRef.current) {
            reportViewedRef.current = true;
            trackReportViewed({
              domain: data.domain,
              enginesCovered,
              mode: "live",
            });
          }
          // 진단 품질 지표는 별도 이벤트로 유지한다(퍼널 단계와 성능 지표는 다른 질문).
          analytics.capture("audit_result_quality", {
            jobId,
            domain: data.domain,
            language: data.language,
            sov: data.result.metrics?.sov,
            enginesWithMention: new Set(
              data.result.metrics?.enginesWithMention ?? []
            ).size,
            enginesCovered,
          });
        }

        const isProcessing =
          data.status === "queued" ||
          data.status === "processing" ||
          data.crewStatus === "queued" ||
          data.crewStatus === "processing" ||
          data.result?.briefingStatus === "processing";
        if (isProcessing && Date.now() - startedAt < MAX_POLL_MS) {
          pollControlRef.current.timeoutId = setTimeout(poll, 4000);
        } else {
          // 진행 중 작업이 없거나 상한 초과 → 루프 종료. 이후 트리거가 다시 runPoll() 가능.
          // (상한 초과 시 마지막 setJob 값이 processing으로 남아 카드가 "측정 중"을
          //  유지하지만 폴링은 멈춘다. 사용자는 새로고침으로 재확인 가능.)
          pollControlRef.current.active = false;
        }
      } catch (err) {
        if (!pollControlRef.current.active) {
          return;
        }
        consecutiveErrors += 1;
        // 일시적 에러는 최대 3회까지 재시도, 4회 연속 실패 시 화면에 에러 표시
        if (consecutiveErrors >= 4) {
          pollControlRef.current.active = false;
          setError(err instanceof Error ? err.message : String(err));
        } else {
          // exponential backoff: 4s → 8s → 16s
          pollControlRef.current.timeoutId = setTimeout(
            poll,
            4000 * 2 ** (consecutiveErrors - 1)
          );
        }
      }
    }
    void poll();
  }, [jobId]);

  // 브리핑 트리거 성공 시: 낙관적으로 briefingStatus=processing 반영 + 폴링 재개.
  const handleBriefingTriggered = useCallback(() => {
    setJob((prev) =>
      prev?.result
        ? { ...prev, result: { ...prev.result, briefingStatus: "processing" } }
        : prev
    );
    runPoll();
  }, [runPoll]);

  useEffect(() => {
    pollControlRef.current.active = false;
    runPoll();
    const control = pollControlRef.current;
    return () => {
      control.active = false;
      if (control.timeoutId) {
        clearTimeout(control.timeoutId);
      }
    };
  }, [runPoll]);

  // 🔴 **재방문 경로**(세션N-39). 이미 `completed` 인 결과를 열면 폴링 분기가
  //   한 번도 돌지 않아 위 `live` 집계가 발화하지 않는다 —
  //   즉 **링크 공유·북마크로 들어온 조회가 통째로 안 세어지고 있었다.**
  //   ⚠️ 결과가 **실제로 그려지는 경우만** 센다: 실패(`failed`)·결과없음(`!result`)은
  //     아래 분기에서 다른 화면을 내므로 「봤다」가 아니다($pageview 와의 차이가 여기다).
  //   ⚠️ `reportViewedRef` 를 live 와 공유해 같은 조회를 두 번 세지 않는다.
  //   🔬 **live 와 경합하지 않는 이유**: 폴링이 완료를 받으면 같은 tick 안에서
  //     `reportViewedRef` 를 먼저 세우고 그 다음 `setJob` 이 리렌더를 만든다.
  //     이 effect 는 리렌더 **후**에 돌므로 ref 가 이미 true 다 → live 가 이긴다.
  //     (재방문은 애초에 그 분기를 안 타므로 여기서만 발화한다.)
  useEffect(() => {
    if (reportViewedRef.current || !job?.result || job.status !== "completed") {
      return;
    }
    reportViewedRef.current = true;
    trackReportViewed({
      domain: job.domain,
      enginesCovered: new Set(job.result.metrics?.enginesCovered ?? []).size,
      mode: "revisit",
    });
  }, [job]);

  if (error) {
    return <ErrorState isKo={isKo} message={error} />;
  }
  if (!job) {
    return <LoadingState message={isKo ? "결과 불러오는 중…" : "Loading…"} />;
  }
  if (job.status === "queued" || job.status === "processing") {
    return (
      <ProcessingState
        domain={job.domain}
        locale={locale}
        status={job.status}
      />
    );
  }
  if (job.status === "failed") {
    return <FailedState job={job} locale={locale} />;
  }
  if (!job.result) {
    return <NoDataState isKo={isKo} />;
  }

  return (
    <>
      <CompletedView
        job={job}
        locale={locale}
        onBriefingTriggered={handleBriefingTriggered}
        result={job.result}
      />
      <ViralBar job={job} locale={locale} />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// ViralBar — sticky bottom (HubSpot 이메일 게이트 + 카톡 공유, research 13)
// ──────────────────────────────────────────────────────────────────

/*
 * 리드 제출 후 화면에 띄울 문구 — **서버가 실제로 보냈는지**로 가른다.
 *
 * 🔴 세션N-26: 예전에는 언제나 *"곧 메일로 보내드려요"* 였다. 발송이 실패해도
 *   (서버는 `emailSent:false` 로 정직하게 답했다) 같은 문구가 떠서 고객이
 *   **오지 않을 메일을 기다렸다.** 지키지 못할 약속을 하지 않는다.
 * ⚠️ 실패를 "에러"로 말하지 않는다 — 리드 저장은 됐고, **이 화면 자체가 리포트**다.
 *   고객이 지금 할 수 있는 것(여기서 보기)을 알려주는 편이 정확하고 덜 불안하다.
 */
export function getLeadResultMessage(
  emailSent: boolean,
  isKo: boolean
): string {
  if (emailSent) {
    return isKo
      ? "전체 리포트를 곧 메일로 보내드려요."
      : "Full report is on its way to your inbox.";
  }
  return isKo
    ? "메일 발송에 실패했어요. 전체 리포트는 이 화면에서 그대로 보실 수 있어요."
    : "We couldn't send the email. The full report is right here on this page.";
}

function ViralBar({ job, locale }: { job: JobResponse; locale: string }) {
  const isKo = locale.startsWith("ko");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // 서버가 메일을 **실제로** 보냈는가. 화면 문구를 이 값으로 가른다(계측 전용 아님).
  const [emailSent, setEmailSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/audit/${job.jobId}/lead`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, source: "viral_bar" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        emailSent?: boolean;
      };
      if (!res.ok) {
        setSubmitError(data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      // PLG 깔때기 핵심 KPI — 풀 리포트 이메일 게이트 통과
      analytics.capture("lead_submitted", {
        jobId: job.jobId,
        source: "viral_bar",
        domain: job.domain,
        emailSent: data.emailSent ?? false,
      });
      // 🔴 세션N-26 — **서버가 아는 진실을 화면이 무시하고 있었다.**
      //   예전에는 `emailSent` 를 **계측에만** 쓰고, 화면은 언제나
      //   *"전체 리포트를 곧 메일로 보내드려요"* 라고 말했다. 그래서 발송이
      //   실패해도(`resend.emails.send` 예외 → 서버가 `emailSent:false` 로 정직하게 답함)
      //   고객은 **오지 않을 메일을 기다렸다.**
      //   ⚠️ 리드 저장 자체는 성공이라 `ok:true` 다 — 그래서 "실패 화면"이 아니라
      //      **무엇이 됐고 무엇이 안 됐는지**를 구분해 말한다.
      setEmailSent(data.emailSent ?? false);
      setSubmitted(true);
      setSubmitting(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function shareKakao() {
    // 🔴 공유 링크에 `shared=1` 표식 (2026-08-06 세션N-7)
    //   사고: 이 페이지는 **비로그인 접근 가능**한데 하단에 신청자 이메일(마스킹)이 있었다.
    //   카카오톡으로 공유하면 **받은 제3자가 남의 이메일 일부를 본다**
    //   (다크패턴 자가진단: *"사용자가 의도한 것보다 더 많이 공유하게 되는가?"*).
    //   경쟁사 공유링크(Profound·AthenaHQ)는 점수만 담고 신청자 PII를 담지 않는다.
    //   ✅ 세션N-26: 서버측 소유자 판별이 들어갔다 — API 가 **소유자에게만**
    //   `emailMasked` 를 준다. 이 표식은 이제 그 위에 덧대는 2차 방어다.
    const url =
      typeof window !== "undefined"
        ? (() => {
            const u = new URL(window.location.href);
            u.searchParams.set("shared", "1");
            return u.toString();
          })()
        : "";
    const m = job.result?.metrics;
    let score = 0;
    let brandName = "";
    let domain = "";
    if (m) {
      // 🔴 공유 점수도 **원본 metrics(응답 단위)** 로 채점 (2026-08-07 세션N-8).
      //   세션N-7은 이 자리의 `stubCount` 고유화 누락을 고쳐 HeroSection과 맞췄는데,
      //   그때 맞춘 기준(dedup)이 애초에 틀린 쪽이었다(위 :1150 주석 참조 — 71건 중 58건 불일치).
      //   화면이 원본 기준으로 바뀌었으므로 **공유 점수도 같이 따라와야** 한다.
      //   안 그러면 N-7이 없애려던 "공유된 점수 ≠ 화면에 보인 점수"가 그대로 재발한다.
      score = totalFiveAxis(fiveAxisScores(m, isKo));
    }
    if (job.result) {
      brandName = job.result.brandName ?? "";
      domain = job.result.domain ?? "";
    }

    // PostHog 이벤트 — 카카오톡 공유 클릭 (sdk vs clipboard 구분)
    analytics.capture("share_kakao_clicked", {
      jobId: job.jobId,
      score,
      domain,
    });

    const fallbackToClipboard = () => {
      const text = isKo
        ? `내 GEO 점수 ${score}점 받았어요! · Findable\n${url}`
        : `My GEO score is ${score}/100 · Findable\n${url}`;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(text);
        alert(
          isKo
            ? "링크를 복사했어요. 카카오톡에 붙여넣어 주세요."
            : "Link copied. Paste into KakaoTalk."
        );
      }
    };

    const jsKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!jsKey || typeof window === "undefined") {
      fallbackToClipboard();
      return;
    }

    try {
      // Kakao SDK 동적 로드 (한 번만)
      const w = window as unknown as {
        Kakao?: {
          init: (key: string) => void;
          isInitialized: () => boolean;
          Share?: { sendDefault: (params: unknown) => void };
        };
      };

      if (!w.Kakao) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src =
            "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Kakao SDK load failed"));
          document.head.appendChild(script);
        });
      }
      if (w.Kakao && !w.Kakao.isInitialized()) {
        w.Kakao.init(jsKey);
      }
      if (!w.Kakao?.Share) {
        fallbackToClipboard();
        return;
      }

      const title = isKo
        ? `${brandName || domain} GEO 점수 ${score}/100`
        : `${brandName || domain} · GEO Score ${score}/100`;
      // 🔴 2026-08-11 (세션N-17) — "7개 엔진"이 **하드코딩**돼 있었다.
      //   이 화면은 실제로 8개로 측정했고(부제 "× 8개 AI 엔진"), 공유는 무료진단의 유입 경로다.
      //   → 고객이 단톡방에 공유하는 순간 **틀린 숫자가 제3자에게 먼저 도착**했다.
      //   엔진 수가 늘어도 문구가 영원히 7이었으므로 실측값으로 바꾼다.
      const sharedEngineCount = new Set(
        job.result?.metrics?.enginesCovered ?? []
      ).size;
      const description = isKo
        ? `AI 답변 ${sharedEngineCount}개 엔진에서 ${brandName || domain}의 가시성 측정 결과. 우리 브랜드도 측정해보세요.`
        : `AI visibility audit across ${sharedEngineCount} engines. Audit your brand too.`;

      w.Kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title,
          description,
          imageUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/og-image.png`,
          link: { mobileWebUrl: url, webUrl: url },
        },
        buttons: [
          {
            title: isKo ? "결과 보기" : "View result",
            link: { mobileWebUrl: url, webUrl: url },
          },
          {
            title: isKo ? "내 브랜드 측정" : "Audit my brand",
            link: {
              mobileWebUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/${locale}/audit`,
              webUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/${locale}/audit`,
            },
          },
        ],
      });
    } catch {
      fallbackToClipboard();
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-white/10 border-t bg-zinc-950/85 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3 lg:px-6">
        {submitted ? (
          /* 🔴 세션N-26 — 발송 실패 시에도 *"곧 보내드려요"* 라고 말하던 것을 고쳤다.
             서버는 `emailSent:false` 로 정직하게 답하는데 화면이 그걸 무시해서,
             고객이 **오지 않을 메일을 기다렸다**. 이제 둘을 갈라 말한다.
             ⚠️ 실패해도 이 화면 자체가 전체 리포트다 — 그래서 "다시 시도"가 아니라
                **지금 여기서 볼 수 있다**고 안내한다(우리가 해준다 X, 여기서 본다 O). */
          <div
            className={
              emailSent
                ? "flex items-center justify-center gap-2 text-[var(--signal-good)] text-sm"
                : "flex items-center justify-center gap-2 text-amber-300 text-sm"
            }
          >
            {emailSent ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <Mail className="h-4 w-4 shrink-0" />
            )}
            <span>{getLeadResultMessage(emailSent, isKo)}</span>
          </div>
        ) : emailOpen ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
            <Mail className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              autoFocus
              className="min-w-[180px] flex-1 rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-400 focus:border-[var(--brand-2)] focus:outline-none"
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isKo ? "이메일 주소" : "your@email.com"}
              required
              type="email"
              value={email}
            />
            <Button
              className="gap-1.5"
              disabled={submitting}
              size="sm"
              type="submit"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              {isKo ? "풀 리포트 받기" : "Send full report"}
            </Button>
            <Button
              onClick={() => {
                setEmailOpen(false);
                setSubmitError(null);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isKo ? "취소" : "Cancel"}
            </Button>
            {submitError && (
              <span className="basis-full text-red-400 text-xs">
                ⚠ {submitError}
              </span>
            )}
          </form>
        ) : (
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Button
              className="gap-1.5"
              onClick={() => setEmailOpen(true)}
              size="sm"
            >
              <Mail className="h-3.5 w-3.5" />
              {isKo ? "풀 리포트 받기 · 무료" : "Get full report · Free"}
            </Button>
            <Button
              className="gap-1.5"
              onClick={shareKakao}
              size="sm"
              variant="outline"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {isKo ? "카카오톡으로 공유" : "Share to KakaoTalk"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 상태 컴포넌트 (다크 톤)
// ──────────────────────────────────────────────────────────────────

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-12 text-zinc-400">
      <Loader2 className="h-5 w-5 animate-spin" />
      {message}
    </div>
  );
}

function ErrorState({ message, isKo }: { message: string; isKo: boolean }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-red-300">
      <div className="flex items-center gap-2 font-semibold">
        <XCircle className="h-5 w-5" />
        {isKo ? "결과 로드 실패" : "Failed to load"}
      </div>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

function NoDataState({ isKo }: { isKo: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6">
      <p className="text-zinc-400">
        {isKo ? "결과 데이터가 없어요." : "No result data."}
      </p>
    </div>
  );
}

function FailedState({ job, locale }: { job: JobResponse; locale: string }) {
  const isKo = locale.startsWith("ko");
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
      <div className="flex items-center gap-2 font-semibold text-red-300">
        <XCircle className="h-5 w-5" />
        {isKo ? "진단 실패" : "Audit failed"}
      </div>
      <p className="mt-2 text-red-300 text-sm">
        {job.errorMessage ?? (isKo ? "알 수 없는 오류" : "Unknown error")}
      </p>
      <Button asChild className="mt-4" variant="outline">
        <a href={`/${locale}/audit`}>{isKo ? "다시 시도" : "Try again"}</a>
      </Button>
    </div>
  );
}

/**
 * 🔴 **측정 성공 0건 화면** (2026-08-10 세션N-14).
 *
 * 여기서 지키는 것 = **"잰 것만 말한다. 못 잰 건 못 쟀다고 말한다."**
 *
 * 이 화면이 없을 때 `apple.com` 진단은 **28개 엔진 전멸**인데도 점수 0점과
 * *"놓치는 유입 800 세션/월"* 을 단언하고 있었다. 근거가 0개인 숫자다.
 *
 * ⚠️ 그래서 여기서는 **숫자를 하나도 만들어내지 않는다** — 시도한 엔진 수처럼
 *   실제로 세어진 값만 쓴다. 점수·손실·경쟁 지형은 전부 렌더하지 않는다.
 * ⚠️ 문구는 사용자 책임으로 읽히지 않게 쓴다(해요체·안내형).
 *   측정에 실패한 건 우리 쪽 사정이지 고객 잘못이 아니다.
 */
function MeasurementFailedView({
  attempted,
  isKo,
  job,
  locale,
  result,
}: {
  attempted: number;
  isKo: boolean;
  job: JobResponse;
  locale: string;
  result: JobResult;
}) {
  return (
    <div className="space-y-6 pb-24 lg:pb-12">
      <MeasuredAtNotice isKo={isKo} job={job} />

      <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6 md:p-10">
        <div className="flex items-center gap-2 font-semibold text-amber-300">
          <AlertCircle className="h-5 w-5" />
          {isKo ? "이번엔 측정하지 못했어요" : "We couldn't measure this time"}
        </div>

        <p className="mt-3 max-w-2xl text-sm text-zinc-300 leading-relaxed">
          {isKo
            ? `${result.domain}에 대해 AI ${attempted}곳에 물어봤지만, 응답을 한 곳도 받지 못했어요. 그래서 이번 결과에는 점수를 매기지 않았어요.`
            : `We asked ${attempted} AI engines about ${result.domain}, but none of them responded. So we're not showing a score for this run.`}
        </p>

        {/* 🔴 여기가 핵심 — "0점"이 아니라 "모른다"고 말한다. */}
        <p className="mt-3 max-w-2xl text-sm text-zinc-400 leading-relaxed">
          {isKo
            ? "0점이 아니라 '아직 모른다'는 뜻이에요. 측정에 성공해야 AI가 브랜드를 어떻게 말하는지 알려드릴 수 있어요."
            : "This isn't a score of zero — it means we don't know yet. We can only tell you how AI describes your brand once a measurement succeeds."}
        </p>

        <Button asChild className="mt-6" variant="outline">
          <a href={`/${locale}/audit`}>
            {isKo ? "다시 측정하기" : "Run it again"}
          </a>
        </Button>
      </section>
    </div>
  );
}

function ProcessingState({
  locale,
  domain,
  status,
}: {
  locale: string;
  domain: string;
  status: string;
}) {
  const isKo = locale.startsWith("ko");
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-12 text-center backdrop-blur-sm">
      <div className="relative mx-auto h-14 w-14">
        <div
          className="absolute inset-0 rounded-full opacity-50 blur-xl"
          style={{
            background:
              "conic-gradient(from 0deg, var(--brand-1), var(--brand-2), var(--brand-3), var(--brand-1))",
          }}
        />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 ring-1 ring-white/10">
          <RotateCw className="h-6 w-6 animate-spin text-[var(--brand-2)]" />
        </div>
      </div>
      <h2 className="mt-6 font-semibold text-2xl text-zinc-100">
        {isKo ? "AI 엔진들에 질의 중…" : "Querying AI engines…"}
      </h2>
      <p className="mt-2 text-zinc-400">
        {isKo
          ? `${domain}을 여러 AI에서 측정하고 있어요. 약 30초~3분 걸려요.`
          : `Measuring ${domain} across 7 AI engines. ~30s-3m.`}
      </p>
      <p className="mt-4 font-medium text-xs text-zinc-400">
        {isKo
          ? `상태: ${status === "queued" ? "대기 중" : "분석 중"}`
          : `STATUS: ${status}`}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 완료 뷰 — 메인 레이아웃
// ──────────────────────────────────────────────────────────────────

function CompletedView({
  job,
  result,
  locale,
  onBriefingTriggered,
}: {
  job: JobResponse;
  result: JobResult;
  locale: string;
  onBriefingTriggered: () => void;
}) {
  const isKo = locale.startsWith("ko");
  // 계산은 `@repo/audit/measurement-coverage` 단일 진실을 쓴다(규칙 복제 금지).
  const coverage = countMeasurementCoverage(result.engineResponses);
  const { measured, attempted } = coverage;

  // 🔴 **측정 성공 0건이면 결과가 아니라 "측정 실패"를 말한다** (2026-08-10 세션N-14).
  //   못 잰 것을 "0점"으로 부르면 안 된다 — 체온계가 안 켜졌는데 "체온 0도"라고 적는 격이다.
  //   점수·손실 추정·경쟁 지형을 **전부 숨긴다**(근거가 0개이므로 말할 수 있는 게 없다).
  if (isMeasurementFailure(coverage)) {
    return (
      <MeasurementFailedView
        attempted={attempted}
        isKo={isKo}
        job={job}
        locale={locale}
        result={result}
      />
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-8">
      {/* main column */}
      <div className="space-y-12 pb-24 lg:pb-12">
        {/* 캐시 투명성(세션L) — 측정 시각을 숨기지 않는다. 리서치: Observatory·SSL Labs·
            PageSpeed 전부 캐시를 밝히고 재측정 경로를 준다. 숨기면 "왜 안 바뀌지?"
            혼란이 되지만, 밝히면 즉시 응답이 오히려 장점으로 읽힌다. */}
        <MeasuredAtNotice isKo={isKo} job={job} />

        <HeroSection isKo={isKo} job={job} result={result} />

        <RevenueImpactCard
          attemptedEngines={attempted}
          // 전수감사 §A-1: 규모 초기값을 측정 신호(인지 엔진 비율·SoV)로 추정.
          // small 하드코딩이 SK하이닉스에 "₩63만/월"을 보여줬던 결함의 수정.
          defaultSizeKey={inferBrandSize(
            (() => {
              const measured = new Set(result.metrics.enginesCovered).size;
              const mentioned = new Set(result.metrics.enginesWithMention).size;
              return measured > 0 ? mentioned / measured : 0;
            })(),
            result.metrics.sov
          )}
          isKo={isKo}
          // 🔴 **분모를 항상 밝힌다** (2026-08-10 세션N-14).
          //   이 카드는 `sov` 하나로 손실을 추정하는데, 그 `sov` 가 **몇 개 엔진에서
          //   나온 값인지**는 말하지 않고 있었다. 28개 중 12개만 성공한 회차도
          //   28개 전부 성공한 회차와 **똑같은 확신**으로 숫자를 보여준다.
          //   → 임계값으로 감추거나 경고하지 않고(근거 없는 경계선이 된다),
          //     **몇 개로 잰 숫자인지 그대로 적는다.** 판단은 고객이 한다.
          //   (화면이 이미 쓰는 "7개 중 1개 미인용" 패턴과 같은 방식이다.)
          measuredEngines={measured}
          sov={result.metrics.sov}
        />

        <CompetitorBenchmark
          brandName={result.brandName}
          brandVariants={result.brandVariants}
          excerpts={result.engineResponses.map((r) => r.excerpt)}
          isKo={isKo}
          registeredCompetitors={result.registeredCompetitors}
        />

        <TruthMirror
          brandName={result.brandName}
          engineResponses={result.engineResponses}
          isKo={isKo}
        />

        {/* 전수감사 §A-7: 처방(측정 기반)을 문제 인식(진실거울) 직후로 이동.
            기존엔 페이지 맨 아래라 crew 액션과 뒤섞여 "추가 액션이랑 오늘 할일이랑
            무슨 관계냐"는 혼란을 만들었다. 측정 처방 먼저, 심층 분석은 그 다음. */}
        <ActionTeaser isKo={isKo} locale={locale} result={result} />

        <CrewMainSection job={job} locale={locale} />

        {job.crewStatus === "completed" &&
          job.crewResult?.analysts &&
          job.crewResult?.strategist && (
            <CopilotChat isKo={isKo} jobId={job.jobId} />
          )}

        <NaverBriefingCard
          briefingPrompt={result.briefingPrompt}
          briefingStatus={result.briefingStatus ?? "not_requested"}
          engineResponses={result.engineResponses}
          isKo={isKo}
          jobId={job.jobId}
          onTriggered={onBriefingTriggered}
        />

        <NaverVsAiGap engineResponses={result.engineResponses} isKo={isKo} />

        <EnginesTabsSection isKo={isKo} result={result} />

        {/* 장치 C(세션L) — 약점 앵커 CTA. 관심이 가장 뜨거운 순간(내가 어느 엔진에서
            미언급인지 본 직후)에 배치. 격차가 없으면(전 엔진 인지) 렌더하지 않는다. */}
        <EngineGapCta isKo={isKo} result={result} />

        {result.metrics.topCitedDomains.length > 0 && (
          <CitationSourcesPanel isKo={isKo} result={result} />
        )}

        <UpsellCard isKo={isKo} job={job} locale={locale} result={result} />
      </div>

      {/* right sticky aside — Action Center (AthenaHQ +45% ROI 패턴) */}
      <aside className="hidden lg:block">
        <div className="sticky top-6 space-y-4">
          <ActionCenterSticky isKo={isKo} job={job} locale={locale} />
        </div>
      </aside>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Hero — McKinsey Action Title + Score Donut + KPI 4 tile
// ──────────────────────────────────────────────────────────────────

function HeroSection({
  job,
  result,
  isKo,
}: {
  job: JobResponse;
  result: JobResult;
  isKo: boolean;
}) {
  // 중복 제거 — enginesCovered/enginesWithMention 배열에 같은 AI가 프롬프트 수만큼 들어있음
  const enginesCoveredUnique = Array.from(
    new Set(result.metrics.enginesCovered)
  );
  const enginesMentionedUnique = Array.from(
    new Set(result.metrics.enginesWithMention)
  );
  // stub인 고유 엔진 ID 카운트 (백엔드 stubCount는 응답 단위라 중복됨)
  const stubEngineIds = new Set<string>();
  for (const r of result.engineResponses) {
    if (r.isStub) {
      stubEngineIds.add(r.engineId);
    }
  }
  const stubEnginesCount = stubEngineIds.size;
  // 측정 실패(오류) 고유 엔진 수 — 점수·언급률 분모에서 제외됨(geo-score와 동일 원칙)
  const erroredEnginesCount = new Set(
    (result.metrics.errors ?? []).map((e) => e.engineId)
  ).size;
  // 🔴 실패 **응답** 수(세션N-28 ⑦). 위 `erroredEnginesCount` 와 **단위가 다르다**:
  //   저건 엔진 종류 수(2곳), 이건 실패한 측정 횟수(예: 2회). 요약 줄은 "총 N회 측정"
  //   이라 응답 단위로 말하므로 여기서만 쓴다. 섞으면 분모 혼재가 다시 생긴다.
  const failedResponses = (result.metrics.errors ?? []).length;
  const dedupMetrics: JobMetrics = {
    ...result.metrics,
    enginesCovered: enginesCoveredUnique,
    enginesWithMention: enginesMentionedUnique,
    stubCount: stubEnginesCount,
  };
  // 🔴 채점은 **저장된 원본 metrics(응답 단위)** 로 한다 — dedup 배열을 넘기지 않는다.
  //   (2026-08-07 세션N-8, M1 작업 중 발견. 실측: 완료 job 71건 중 **58건(82%)이 불일치**,
  //    최대 32점 — Olive 화면 66 / 메일·OG 34. 평균 +4.9점 화면이 관대했다.)
  //
  //   원인: 여기서 `new Set()` 으로 중복 제거한 배열을 채점기에 넘겼는데, 세션M의 F11이
  //   `recognitionRate` 를 **고유 엔진 → 응답 빈도**로 바꾼 이유가 정확히 그 반대였다.
  //   F11은 `geo-score.ts` 만 고치고 이 화면의 dedup 은 못 봐서, 화면만 옛 방식으로 남아
  //   F11을 되돌리고 있었다. 메일(`lead/route.ts:71`)·OG(`og/route.tsx:73`)·runner 는
  //   처음부터 원본을 넘겨 정상이었다 → **화면 하나만 다른 점수를 보여주고 있었다.**
  //
  //   판정 근거(실측 71건): 고유 엔진 방식은 인지도 **만점(100%)이 35%** 로 쏟아진다
  //   (한 번만 언급돼도 그 엔진은 만점). 응답 단위는 4%. F11이 *"브랜드를 구분하지 못하는
  //   사실상의 상수"* 라며 없애려던 증상 그 자체다.
  //
  //   ⚠️ dedupMetrics 를 지우지는 않는다 — **개수 표시**에는 고유 엔진이 맞다.
  //   "AI 7곳 중 6곳"을 응답 단위로 쓰면 "AI 28곳 중 19곳"이 되어 새 거짓말이 된다.
  //   (`mckinseyHeadline` 은 내부에서 다시 `new Set()` 하므로 어느 쪽을 넘겨도 동일하나,
  //    의도를 드러내려고 개수용 metrics 를 계속 넘긴다.)
  // 감사 8번: 평균 순위가 **몇 건을 평균낸 값인지**. null 제외(세션N-5 교훈 —
  //   `mentionPosition`은 일부 응답에만 있어서 0으로 깔면 순위가 왜곡된다).
  const rankedResponses = result.engineResponses.filter(
    (r) => r.mentionPosition !== null
  ).length;
  // 순위의 분모(세션N-10). **집계값을 그대로 쓴다** — 화면에서 다시 평균내면
  //   같은 숫자를 두 벌 계산하는 것이라 언젠가 어긋난다(감사 §10 3중 복제와 같은 함정).
  //   도입 전 job 은 null → 라벨이 세션N-8 표기로 폴백한다.
  const avgListSize = result.metrics.averageMentionListSize ?? null;
  const axisView = fiveAxisScores(result.metrics, isKo);
  const totalScore = totalFiveAxis(axisView);
  const severity = sovSeverity(totalScore);
  const label = scoreTierLabel(totalScore, isKo);
  // 🔴 측정 성공 엔진 수 = 단일 진실(`countMeasurementCoverage`). 헤드라인·KPI·언급률이
  //   **같은 값**을 쓰게 하려고 여기서 한 번만 구한다(세션N-28 — 아래 §분모 주석 참고).
  const coverage = countMeasurementCoverage(result.engineResponses);
  const measuredEnginesCoverage = coverage.measured;
  const headline = mckinseyHeadline(
    result.brandName,
    dedupMetrics,
    isKo,
    measuredEnginesCoverage
  );

  // ──────────────────────────────────────────────────
  // 🔴 "AI 몇 곳" 분모 단일화 (2026-08-06 세션N-7)
  //
  // 사고: 같은 페이지에서 분모가 3개 따로 계산돼 **같은 질문에 세 답이 나왔다**.
  //   ① 제목(mckinseyHeadline): 전체 − stub − 오류  → "AI 7개 중 1개는 아직"(=6곳 인용)
  //   ② 언급률: 전체 − 오류 (**stub 안 뺌**)
  //   ③ KPI "6/7": **전체 그대로**(아무것도 안 뺌)
  //   → 고객이 "5냐 6냐 7냐"를 셋 중 뭘 믿을지 알 수 없었다.
  //
  // 기준 = 측정하지 못한 엔진을 "우리를 모른다"로 세면 점수가 부당하게 깎인다.
  //   ⚠️ 아래 `measuredEnginesCoverage` 를 화면 전체가 공유한다 — 새 지표도 이 값을 쓸 것.
  // ──────────────────────────────────────────────────
  // 🔴🔴 세션N-28 실측 버그 — 화면에 **「우리를 아는 AI 7/6」·「117%」** 가 떠 있었다.
  //
  //   원인: **분모 규칙이 단일 진실 모듈과 반대**였다.
  //     · `packages/audit/measurement-coverage.ts` (단일 진실):
  //         *"같은 엔진이 4번 중 1번만 성공했어도 **그 엔진은 측정됨**"*
  //     · 여기 `erroredEnginesCount`: **1번이라도 실패하면 통째로 제외**
  //   실데이터(엔비디아): Perplexity 는 5회 중 **3회 성공·2회 rate limit 실패**다.
  //   답을 3번이나 줬는데 "측정 못 한 엔진"으로 빼니 분모만 6이 되고,
  //   분자(언급 엔진)에는 그대로 남아 **7/6 = 117%** 가 됐다.
  //
  //   ⭐ **모듈이 맞다.** 실제로 답을 받은 엔진을 분모에서 빼면 "잰 것"을 축소 보고하는 것이다.
  //   → 분모를 `countMeasurementCoverage` 로 통일한다. 분자는 건드리지 않는다.
  //   ⚠️ 이 오류는 measure·align·axe **어느 도구도 못 잡았다**(전부 통과).
  //      fullPage 를 눈으로 보고서야 드러났다.
  const mentionRate =
    measuredEnginesCoverage === 0
      ? 0
      : Math.round(
          (enginesMentionedUnique.length / measuredEnginesCoverage) * 100
        );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-sm md:p-10">
      {/* 장식용 코너 글로우 제거(2026-07-30 slop 제거) — 점수 도넛이 시각 앵커 역할 */}

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium text-[var(--brand-2)] text-xs">
            {isKo ? "AI 노출 점수" : "GEO Score Audit"}
          </div>
          <div className="mt-0.5 font-medium text-xs text-zinc-400">
            {result.domain}
          </div>
          <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-medium text-xs">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                severity === "green"
                  ? "bg-[var(--signal-good)]"
                  : severity === "amber"
                    ? "bg-[var(--signal-warn)]"
                    : "bg-[var(--signal-bad)]"
              }`}
            />
            <span className="text-zinc-300">{label}</span>
          </div>
        </div>
        {job.pdfUrl && (
          <Button asChild className="gap-2" size="sm" variant="outline">
            <a href={job.pdfUrl} rel="noopener noreferrer" target="_blank">
              <Download className="h-4 w-4" />
              PDF
            </a>
          </Button>
        )}
      </div>

      {/* McKinsey Action Title — 헤드라인.
          🔴 감사 9번 `translate="no"` (2026-08-07 세션N-8): 브라우저 자동번역이
          **브랜드명을 번역·음역**하면 결과 전체가 딴 회사 얘기가 된다.
          세션N-3에서 표기법 비대칭(`설화수` vs `Sulwhasoo`)이 급소로 확인된 그 지점이다.
          ⚠️ h1 전체에 걸면 **한국어 문장까지 번역이 막힌다** → 브랜드명만 감싼다.
          모든 헤드라인 변형이 브랜드명으로 시작하므로 접두사만 분리하면 문장은 그대로다. */}
      <h1 className="mt-6 max-w-3xl font-bold text-2xl text-zinc-50 leading-tight md:text-3xl lg:text-4xl">
        {headline.startsWith(result.brandName) ? (
          <>
            <span translate="no">{result.brandName}</span>
            {headline.slice(result.brandName.length)}
          </>
        ) : (
          headline
        )}
      </h1>
      {/* 🔴 세션N-28 ⑦ 상태 정직성 — 요약 줄이 "총 29회 측정"만 말하고 **그중 2회가
          실패했다는 사실은 페이지 아래 각주에만** 있었다. 요약을 읽고 스크롤을 멈춘
          사람은 실패를 **모른 채** 숫자를 신뢰한다.
          ⚠️ 단위를 섞지 않는다 — 이 줄의 분모는 **응답(회)** 이라 `errors.length`(응답 단위)를
          쓴다. `erroredEnginesCount`(엔진 단위)를 쓰면 ⑥에서 고친 분모 혼재가 되살아난다. */}
      <p className="mt-2 text-sm text-zinc-400">
        {isKo
          ? `${result.promptsCount}개 프롬프트 × ${enginesCoveredUnique.length}개 AI 엔진 · 총 ${result.metrics.enginesCovered.length}회 측정`
          : `${result.promptsCount} prompts × ${enginesCoveredUnique.length} AI engines · ${result.metrics.enginesCovered.length} measurements`}
        {failedResponses > 0 && (
          <span className="text-[var(--signal-warn)]">
            {isKo
              ? ` · ${failedResponses}회 실패(점수에서 제외)`
              : ` · ${failedResponses} failed (excluded from score)`}
          </span>
        )}
      </p>

      {/* Donut + 5축 분해 (HubSpot 패턴) */}
      <div className="relative mt-10 flex flex-col items-center gap-10 md:flex-row md:items-start md:gap-12">
        {/* 점수와 "그래서 좋은 거냐"를 **붙여서** 놓는다 — 티어 알약은 제목 위에 있어
            게이지와 시각적으로 분리돼 있었고, 그래서 73과 연결이 안 보였다. */}
        <div className="flex shrink-0 flex-col items-center gap-3">
          <ScoreDonut severity={severity} value={totalScore} />
          <p className="max-w-[14rem] text-center text-sm text-zinc-400 leading-relaxed">
            {scoreTierMeaning(totalScore, isKo)}
          </p>
          <PreviousRunBadge history={job.history} isKo={isKo} />
        </div>

        <div className="w-full">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-medium text-xs text-zinc-400">
              {isKo ? "점수를 만든 5가지" : "5-axis breakdown"}
            </span>
            <span className="font-medium text-xs text-zinc-400">
              {totalScore} / 100
            </span>
          </div>
          {/* M1 A안 — 2단 구조. 인지도를 **선행 축**으로 올리고 감성·노출을 그 아래 종속으로 둔다.
              나열 순서가 곧 인과 설명이다: 위를 올려야 아래가 오른다. */}
          <div className="space-y-2.5">
            <FiveAxisBar axis={axisView.driver} isKo={isKo} />
          </div>

          <div className="mt-2.5 border-white/10 border-l-2 pl-3">
            {/* 🔴 2026-08-11 (세션N-17) — 괄호 분모가 %와 안 맞아 보이는 문제를 **설명으로** 해소.
                진단 실측: 화면에 「좋게 말하나 63% (25/32)」가 찍히는데 25÷32=78% 라
                고객이 검산하면 틀린다(5줄 중 3줄은 나눠떨어지므로 "괄호를 나누면 %"라고 학습된다).
                ⚠️ 숫자 계산은 **바꾸지 않았다** — 위 M1 주석(2026-08-07)이 이미 두 대안을 검토해
                ①%를 실효상한 기준으로 바꾸면 저인지 브랜드 바가 가득 차 보이고
                ②괄호를 원래 만점으로 되돌리면 "13점이 감성 문제"라는 오독이 돌아온다고 판정했다.
                → 둘 다 유효하므로 **두 숫자가 서로 다른 기준임을 화면에서 말해준다**(표시층 해결). */}
            <p className="mb-2 text-[11px] text-zinc-400 leading-relaxed">
              {isKo
                ? "아래 두 항목은 위 인지도가 상한을 정해요. 우리를 모르는 AI는 좋게 말할 수도, 인용할 수도 없어요. %는 100점 만점에서 이 항목이 받은 몫이고, 괄호의 뒷숫자는 지금 인지도로 받을 수 있는 최대 점수예요."
                : "The two below are capped by recognition above — an AI that doesn't know you can't describe or cite you. The % is this axis's share of the 100-point total; the number after the slash is the most it can score at your current recognition."}
            </p>
            <div className="space-y-2.5">
              {axisView.dependents.map((a) => (
                <FiveAxisBar axis={a} isKo={isKo} key={a.key} />
              ))}
            </div>
          </div>

          <div className="mt-3.5 space-y-2.5 border-white/5 border-t pt-3.5">
            {axisView.independents.map((a) => (
              <FiveAxisBar axis={a} isKo={isKo} key={a.key} />
            ))}
          </div>
        </div>
      </div>

      <MarketRegionCards isKo={isKo} result={result} />

      {/* KPI 보조 strip — 5축 아래 */}
      <div className="mt-6 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCell
          // 🔴 라벨 구분 필수: 제목의 "점유율 N%"는 `sov`(답변 안에서 우리가 차지한 몫)이고
          //   이 칸은 `mentionRate`(우리를 언급한 AI 비율)다. **계산식이 다른 별개 지표**인데
          //   둘 다 "N%"로 표기돼, 값이 우연히 같으면 같은 지표로 읽혔다(실측: 둘 다 86%).
          label={isKo ? "우리를 말한 AI 비율" : "ENGINE COVERAGE"}
          unit="%"
          value={mentionRate}
        />
        {/* 🔴 감사 8번 — 평균 순위에 **척도**를 붙인다 (세션N-8 착수 → 세션N-10 완결).
            *"`평균 순위 1위`에 척도가 없다. 3개 중 1위인지 300개 중인지 모른다"*
            (리서치: 7개 툴이 순위 병기 · Similarweb *"순위는 비교군이 붙어야 의미가 생긴다"*)

            ✅ **세션N-10에서 진짜 분모를 만들었다.** 세션N-8의 *"분모를 만들 수 없다"* 는
            판단은 **틀렸다** — `estimateMentionPosition` 이 목록 길이를 버리고 있었을 뿐,
            같은 정규식에서 바로 뽑을 수 있는 값이었다. 이제 `mentionListSize` 로 저장된다.
            ⚠️ 단 **소급 불가**: 도입 전 job 은 분모가 없다 → 그 경우 세션N-8의
            "몇 건을 평균냈나" 표기로 **폴백**한다(없는 분모를 지어내지 않는다). */}
        <KpiCell
          isMissing={result.metrics.averageMentionPosition === null}
          // 🔴 S7-3차(2026-08-12) — 표기를 `@repo/audit/rank-label` 로 단일화.
          //   네이버 격차 카드가 같은 순위를 **분모 없이** 말하고 있었다("3.2위").
          //   같은 페이지에서 한쪽은 밝히고 한쪽은 감추면 어느 쪽을 믿을지 모른다.
          label={detailedRankLabel(
            {
              averagePosition: null,
              listSize: avgListSize,
              sampleCount: rankedResponses,
            },
            isKo
          )}
          unit={
            result.metrics.averageMentionPosition !== null
              ? isKo
                ? "번째"
                : ""
              : "—"
          }
          value={result.metrics.averageMentionPosition ?? 0}
        />
        <KpiCell
          // 분모 = measuredEngines(제목·언급률과 동일). 이전엔 전체 엔진 수를 그대로 써서
          //   제목이 "7개 중 1개 미인용"(=6측정)인데 여기가 "6/7"로 어긋났다.
          // 🔴 세션N-28: 분모를 `countMeasurementCoverage`(단일 진실)로 통일한다.
          //   종전엔 "1번이라도 실패한 엔진"을 통째로 빼서 실제로 「7/6」이 떠 있었다.
          label={isKo ? "우리를 아는 AI" : "ENGINES"}
          valueRaw={`${enginesMentionedUnique.length}/${measuredEnginesCoverage}`}
        />
        <KpiCell
          // 🔴 2026-08-11 (세션N-17) — 분모와 표시값이 안 맞았다.
          //   라벨은 긍정+중립+부정(=21)을 분모로 쓰는데 값은 "3/0"(=3)만 보여줬다.
          //   숨은 중립 18건이 **'좋게 말하나' 점수의 실제 주인**이라(전부 중립이면 30/40 기준선)
          //   안 보여주면 "긍정 3·부정 0인데 왜 63%냐"에서 고객이 막힌다.
          //   → 중립을 표시에 포함해 3개 숫자의 합이 분모와 일치하게 만든다.
          label={
            isKo
              ? `긍정/중립/부정 · 응답 ${
                  result.metrics.sentimentDistribution.positive +
                  result.metrics.sentimentDistribution.neutral +
                  result.metrics.sentimentDistribution.negative
                }건 기준`
              : `POS/NEU/NEG · OF ${
                  result.metrics.sentimentDistribution.positive +
                  result.metrics.sentimentDistribution.neutral +
                  result.metrics.sentimentDistribution.negative
                } RESPONSES`
          }
          valueRaw={`${result.metrics.sentimentDistribution.positive}/${result.metrics.sentimentDistribution.neutral}/${result.metrics.sentimentDistribution.negative}`}
        />
      </div>

      {stubEnginesCount > 0 && (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-300 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {isKo
              ? `${stubEnginesCount}개 AI는 아직 연결 전이에요. 다음 측정부터 넣어드려요 (한국 AI: 네이버, 카카오 등).`
              : `${stubEnginesCount} engines are not connected yet. Will be included next time.`}
          </span>
        </div>
      )}

      {erroredEnginesCount > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {isKo
              ? `${erroredEnginesCount}개 AI는 일시 오류로 응답을 받지 못했어요. 점수와 등장률은 측정에 성공한 곳만으로 계산했어요.`
              : `${erroredEnginesCount} engines failed temporarily. Scores are based on successfully measured engines.`}
          </span>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// 시장별 점수 카드 (2026-08-02 세션M)
//
// 왜: 통합 점수 하나가 정반대 두 현실을 평균 내 가리고 있었다.
//   실측 SK하이닉스 68점 = 사실은 "한국 41(언급 54%) · 글로벌 70(언급 100%)".
//   "국내 AI가 우리를 모른다"는 실행 가능한 진단이 숫자 하나에 묻혀 있었다.
//
// 설계 원칙(📕docs/_적용/타깃시장선언_SEO선례_2026-08-02.md):
//   1. **점수 옆 시장 라벨은 의무.** 라벨 없는 62점은 고객마다 의미가 달라 거짓말이 된다.
//   2. **0 과 N/A 를 구분.** 선언 안 한 시장은 0점이 아니라 **아예 렌더링하지 않는다**
//      (0은 "했는데 실패", 미표시는 "우리 시장 아님"으로 읽힌다 — 업계 표준).
//   3. 단일 시장 고객은 **숫자 1개 그대로**다. 통합 점수가 사라지는 게 아니라 이름이 붙는 것.
// ──────────────────────────────────────────────────────────────────

const SEVERITY_DOT: Record<Severity, string> = {
  green: "bg-[var(--signal-good)]",
  amber: "bg-[var(--signal-warn)]",
  red: "bg-[var(--signal-bad)]",
};

function MarketRegionCards({
  result,
  isKo,
}: {
  result: JobResult;
  isKo: boolean;
}) {
  // 🔴 2026-08-21 재활성 — 분류 축을 "엔진 국적"에서 **질의 언어**로 재설계했다
  //   (`market-scope.ts` `promptLanguageRegion`). "국내 중심"이어도 ChatGPT·Claude·
  //   Perplexity 가 빠지지 않는다(한국어 질문에 7 엔진 전부가 답하므로).
  //   실측(2026-08-21, 라이브 701건)으로 언어축 유효성 확인: 언급률로는 판별 안 되지만
  //   감성·출처량으로는 뚜렷이 갈린다. 상세=`docs/_적용/시장축_언어재설계_2026-08-21.md`.
  //
  //   경쟁사 리서치(`지역언어축_경쟁사_리서치_2026-08-02.md` Q1·Q4) — Profound·Semrush·
  //   Ahrefs·Peec·Otterly **전부 "필터"** 방식이다(선택한 시장만 보여줌). "통합 합산"을
  //   공개 방법론으로 발행하는 곳은 **업계에 없다** — 아래 both 분기가 그 공백을 채운다.
  const SHOW_MARKET_CARDS = true;
  const scope = result.marketScope ?? "both";
  const all = result.regions ?? [];
  // 구 job(regions 없음)은 아무것도 렌더하지 않는다 — 기존 화면 그대로(회귀 0).
  if (!SHOW_MARKET_CARDS || all.length === 0) {
    return null;
  }

  // 선언한 시장만 보여준다. 나머지는 숨김(0점 표시 아님).
  const shown = scope === "both" ? all : all.filter((r) => r.region === scope);
  if (shown.length === 0) {
    return null;
  }
  const hiddenCount = all.length - shown.length;

  return (
    <div className="mt-8">
      <div className="mb-3 font-medium text-xs text-zinc-400">
        {isKo ? "시장별 점수" : "Score by market"}
      </div>
      <div className={`grid gap-3 ${shown.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {shown.map((r) => {
          const sev = sovSeverity(r.score);
          return (
            <div
              className="rounded-xl border border-white/10 bg-white/5 p-4"
              key={r.region}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[sev]}`}
                />
                {/* 라벨 의무 — 숫자만 두면 어느 시장 기준인지 알 수 없다 */}
                <span className="font-medium text-sm text-zinc-300">
                  {r.label}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-bold text-3xl text-zinc-50 tabular-nums">
                  {r.score}
                </span>
                <span className="text-sm text-zinc-400">/ 100</span>
              </div>
              <div className="mt-1 text-xs text-zinc-400">
                {isKo
                  ? `AI ${r.enginesMeasured}개 중 언급 ${r.mentionRate}%`
                  : `${r.mentionRate}% mention across ${r.enginesMeasured} engines`}
              </div>
            </div>
          );
        })}
      </div>

      {/* 업셀 — 점수 카드 안이 아니라 아래에 작게. 카드 안에 회색칸을 만들면
          결국 "미달"로 읽힌다(리서치 경고). */}
      {hiddenCount > 0 && (
        <p className="mt-3 text-xs text-zinc-400">
          {isKo
            ? "다른 시장도 함께 보고 싶다면 대시보드에서 타깃 시장을 바꿀 수 있어요."
            : "Want another market? Change your target market in the dashboard."}
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Score Donut — conic-gradient 글로우 + motion 카운트업
// ──────────────────────────────────────────────────────────────────

function ScoreDonut({
  value,
  severity,
}: {
  value: number;
  severity: Severity;
}) {
  const radius = 96;
  const circumference = 2 * Math.PI * radius;
  const score = useMotionValue(0);
  const display = useTransform(score, (v: number) => Math.round(v));
  const dashOffset = useTransform(
    score,
    (v: number) => circumference * (1 - v / 100)
  );

  useEffect(() => {
    const ctrl = animate(score, value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => ctrl.stop();
  }, [value, score]);

  // 🔴 저점 빨강 제거 (2026-08-06 세션N-7) — app 1-3과 동일 규율을 web에 이식.
  //   근거 ① GSC는 **하락에 색상 경고를 아예 쓰지 않는다**(의도적 안티패닉 설계).
  //        ② 토스 그래픽 규율(심사 탈락 사유): *"부정적 감정 표현 그래픽 금지"*.
  //        ③ 이 제품은 **0점~저점 고객이 다수**다 — 첫 화면 최대 그래픽이 빨간 원이면
  //           "고칠 수 있는 상태"가 아니라 "실패 통보"로 읽히고 재방문하지 않는다.
  //        ④ 색맹 99%가 적녹이라 접근성 문제도 겹친다.
  //   → 좋은 상태(green)만 색으로 보상하고, 낮은 상태는 **중립**으로 사실만 전달한다.
  //     "좋은지 나쁜지"는 색이 아니라 옆의 티어 라벨(scoreTierLabel)이 글자로 말한다.
  const gradId =
    severity === "green"
      ? "g-good"
      : severity === "amber"
        ? "g-warn"
        : "g-warn";
  const textColor =
    severity === "green"
      ? "text-[var(--signal-good)]"
      : severity === "amber"
        ? "text-[var(--signal-warn)]"
        : "text-zinc-100";

  return (
    <div className="relative flex h-56 w-56 shrink-0 items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0 rounded-full opacity-40 blur-2xl"
        style={{
          background:
            "conic-gradient(from 0deg, var(--brand-1), var(--brand-2), var(--brand-3), var(--brand-1))",
        }}
      />
      {/* 순수 장식 — 점수 값은 아래 텍스트(`{display}`)로 이미 읽힌다.
          `<title>` 을 달면 스크린리더가 같은 점수를 **두 번** 읽으므로 숨기는 쪽이 맞다. */}
      <svg
        aria-hidden="true"
        className="relative h-56 w-56 -rotate-90"
        viewBox="0 0 224 224"
      >
        <defs>
          <linearGradient id="g-good" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.20 155)" />
            <stop offset="100%" stopColor="oklch(0.70 0.18 195)" />
          </linearGradient>
          <linearGradient id="g-warn" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.82 0.18 75)" />
            <stop offset="100%" stopColor="oklch(0.78 0.20 50)" />
          </linearGradient>
          <linearGradient id="g-bad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.72 0.25 25)" />
            <stop offset="100%" stopColor="oklch(0.56 0.22 25)" />
          </linearGradient>
        </defs>
        <circle
          cx="112"
          cy="112"
          fill="none"
          r={radius}
          stroke="oklch(1 0 0 / 0.06)"
          strokeWidth="14"
        />
        <motion.circle
          cx="112"
          cy="112"
          fill="none"
          r={radius}
          stroke={`url(#${gradId})`}
          strokeDasharray={circumference}
          strokeLinecap="round"
          strokeWidth="14"
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {/* 보이는 숫자는 카운트업 중 계속 바뀐다 → 스크린리더에는 숨기고(aria-hidden),
            최종 값만 아래 sr-only 로 한 번 전달한다(중간값 연속 낭독 방지). */}
        <motion.span
          aria-hidden="true"
          /* `tabular-nums` 오타(`tabular-numser`) 수정 (2026-08-08). 존재하지 않는 클래스라
             조용히 무시되고 있었다 — 점수 카운트업 애니메이션에서 숫자 폭이 흔들린다
             (39곳 중 여기만 오타였고, 하필 가장 큰 숫자다). */
          className={`font-bold text-7xl tabular-nums ${textColor}`}
        >
          {display}
        </motion.span>
        <span
          aria-hidden="true"
          className="mt-1 font-medium text-xs text-zinc-400"
        >
          GEO 점수
        </span>
        <span className="sr-only">GEO 점수 {Math.round(value)}점</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// FiveAxisBar — HubSpot 5축 가로 막대 (가중치 투명 공개)
// ──────────────────────────────────────────────────────────────────

function FiveAxisBar({ axis, isKo }: { axis: AxisScore; isKo: boolean }) {
  const pct = (axis.score / axis.max) * 100;
  const tone: Severity = pct >= 70 ? "green" : pct >= 40 ? "amber" : "red";
  // 저점 빨강 제거 — 게이지(ScoreDonut)와 같은 안티패닉 규율. 0점 고객 화면이 온통 빨강이 되면
  //   개선 가능한 상태가 "실패 통보"로 읽힌다. 낮음은 **채움이 짧은 것**으로 이미 보인다.
  const barColor =
    tone === "green"
      ? "bg-[var(--signal-good)]"
      : tone === "amber"
        ? "bg-[var(--signal-warn)]"
        : "bg-white/25";
  const width = useMotionValue(0);
  const widthPct = useTransform(width, (v: number) => `${v}%`);
  useEffect(() => {
    const ctrl = animate(width, pct, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => ctrl.stop();
  }, [pct, width]);

  return (
    <div className="group">
      <div className="flex items-baseline justify-between text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-zinc-200">
            {isKo ? axis.labelKo : axis.labelEn}
          </span>
          <span className="font-medium text-xs text-zinc-400">{axis.hint}</span>
        </div>
        {/* 🔴 축끼리 비교 가능하게 %를 주 숫자로 (2026-08-06 세션N-7)
            사고: 분모가 축마다 달라(40·20·20·10·10) `27/40`과 `9/10`을 고객이 **직접 나눗셈**해야
            비교됐다. 실제로 27/40(67%)은 노란 바, 9/10(90%)은 초록 바인데 숫자만 보면 27>9라
            역전돼 보였다. `pct`는 이미 :1414에서 계산돼 바 채움에만 쓰이고 있었다.
            원점수는 남긴다 — Semrush식 분해(총점이 어디서 왔는지)가 최강 신뢰장치라 지우면 손실. */}
        {/* M1 B안 — 종속 축은 **실효 상한**을 분모로 병기한다(2026-08-07 세션N-8).
            `27/40`은 "13점이 감성 문제"로 읽히지만, 인지 85%면 애초에 34점이 상한이라
            실제 감성 손실은 7점뿐이다. 분모를 34로 적으면 그 오독이 사라진다.
            ⚠️ 바 채움(pct)과 %는 **원래 만점(max) 기준 그대로** 둔다 — 총점 100점에
            기여하는 몫이 그것이고, 실효 상한으로 채우면 인지 30% 브랜드의 감성 바가
            가득 차서 "감성 우수"로 보이는 정반대 오독이 생긴다. */}
        <span className="font-mono text-zinc-400 tabular-nums">
          {Math.round(pct)}%
          <span className="text-zinc-400">
            {" "}
            ({axis.score}/
            {axis.dependsOnRecognition && axis.effectiveMax !== undefined
              ? axis.effectiveMax
              : axis.max}
            )
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: widthPct }}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// KPI Cell — motion 카운트업
// ──────────────────────────────────────────────────────────────────

function KpiCell({
  label,
  value,
  valueRaw,
  unit,
  tone,
  isMissing,
}: {
  label: string;
  value?: number;
  valueRaw?: string;
  unit?: string;
  tone?: Severity;
  isMissing?: boolean;
}) {
  const v = useMotionValue(0);
  const display = useTransform(v, (n: number) => Math.round(n * 10) / 10);
  useEffect(() => {
    if (value === undefined) {
      return;
    }
    const ctrl = animate(v, value, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    return () => ctrl.stop();
  }, [value, v]);

  const valueColor =
    tone === "green"
      ? "text-[var(--signal-good)]"
      : tone === "amber"
        ? "text-[var(--signal-warn)]"
        : tone === "red"
          ? "text-[var(--signal-bad)]"
          : "text-zinc-100";

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="font-medium text-xs text-zinc-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <motion.span
          className={`font-bold text-2xl tabular-nums ${valueColor}`}
        >
          {isMissing ? "—" : (valueRaw ?? display)}
        </motion.span>
        {unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Crew Section (Monday Action + Top Actions + Analysts)
// ──────────────────────────────────────────────────────────────────

// 메인 컬럼용 — 분석가 리포트 + 보조 액션 4~6위 (Top 3은 사이드바로 분리)
function CrewMainSection({
  job,
  locale,
}: {
  job: JobResponse;
  locale: string;
}) {
  const isKo = locale.startsWith("ko");

  if (job.crewStatus === "not_requested") {
    return (
      <CrewTriggerCard
        emailMasked={job.emailMasked ?? null}
        isKo={isKo}
        jobId={job.jobId}
      />
    );
  }
  if (job.crewStatus === "queued" || job.crewStatus === "processing") {
    return <CrewProcessingCard isKo={isKo} />;
  }
  if (job.crewStatus === "failed") {
    return <CrewFailedCard isKo={isKo} jobId={job.jobId} />;
  }
  if (!job.crewResult) {
    return null;
  }

  if (!(job.crewResult.analysts && job.crewResult.strategist)) {
    return <LegacyCrewNotice isKo={isKo} locale={locale} />;
  }

  return (
    <div className="space-y-12">
      <SecondaryActionsGrid
        isKo={isKo}
        strategist={job.crewResult.strategist}
      />
      <AnalystsSection analysts={job.crewResult.analysts} isKo={isKo} />
    </div>
  );
}

// 사이드바용 — Monday Action + Top 3 + PDF + 트리거/상태
function ActionCenterSticky({
  job,
  locale,
  isKo,
}: {
  job: JobResponse;
  locale: string;
  isKo: boolean;
}) {
  const ready =
    job.crewStatus === "completed" &&
    job.crewResult?.analysts &&
    job.crewResult?.strategist;

  return (
    <SpotlightCard border="brand" className="p-5">
      <div className="flex items-center gap-2 font-medium text-[var(--brand-2)] text-xs">
        <Target className="h-3.5 w-3.5" />
        {/* §A-7: 출처 표기 — 본문 '추가 액션 4~6위'와 같은 AI 분석팀 산출임을 명시 */}
        {isKo
          ? "먼저 할 일 3가지 — AI 분석 1~3순위"
          : "Action Center — analyst top 3"}
      </div>

      {ready && job.crewResult?.strategist?.output ? (
        <ActionCenterContent
          isKo={isKo}
          job={job}
          strategist={job.crewResult.strategist}
        />
      ) : (
        <ActionCenterPending isKo={isKo} job={job} />
      )}

      {job.pdfUrl && (
        <Button
          asChild
          className="mt-5 w-full gap-2"
          size="sm"
          variant="outline"
        >
          <a href={job.pdfUrl} rel="noopener noreferrer" target="_blank">
            <Download className="h-4 w-4" />
            {isKo ? "PDF 다운로드" : "Download PDF"}
          </a>
        </Button>
      )}

      {/* 🔴 "새 진단 시작"을 **주 CTA 자리에서 내린다** (2026-08-07 세션N-8, 감사 4번).
          방금 진단을 끝낸 사람에게 "또 진단하세요"가 카드의 유일한 실동작 버튼이었다.
          지우지는 않는다 — 다른 도메인을 재는 사람에게는 실제로 필요한 동선이다.
          full-width 버튼 → **작은 텍스트 링크**로 위계만 낮춘다(주 CTA와 경쟁 제거). */}
      <div className="mt-3 border-white/10 border-t pt-3 text-center">
        <a
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-300"
          href={`/${locale}/audit`}
        >
          <RotateCw className="h-3 w-3" />
          {isKo ? "다른 브랜드 진단하기" : "Audit another brand"}
        </a>
      </div>
    </SpotlightCard>
  );
}

function ActionCenterContent({
  strategist,
  job: _job,
  isKo,
}: {
  strategist: StrategistReport;
  job: JobResponse;
  isKo: boolean;
}) {
  const out = strategist.output;
  if (!out) {
    return null;
  }
  const top3 = out.topActions.slice(0, 3);
  return (
    <div className="mt-4 space-y-4">
      {/* Monday Action — 압축 카드 */}
      {out.mondayActionOne && (
        <div className="rounded-lg border border-[var(--brand-1)]/30 bg-[var(--brand-1)]/5 p-3">
          <div className="font-medium text-[var(--brand-2)] text-xs">
            {/* 🔴 2026-08-11 — "월요일 09:00" 고정 문자열이었다. 패널 제목이 "오늘 할 일"이라
                화요일에 열면 정면 충돌했고, 이 결과가 9일 전 캐시본일 수도 있어 그 '월요일'이
                지난주인지 다음주인지 알 방법이 없었다.
                ⚠️ 날짜를 계산해 넣지 않는다 — 진단 시점이 과거일 수 있어 **없는 날짜를 지어내는 것**이 된다.
                → 시각 대신 **순서**를 말한다(실행 가능성은 유지, 거짓 정밀도는 제거). */}
            {isKo ? "가장 먼저" : "Do this first"}
          </div>
          <div className="mt-1 font-semibold text-sm text-zinc-50 leading-snug">
            {out.mondayActionOne.title}
          </div>
        </div>
      )}

      {/* Top 3 액션 */}
      <div className="space-y-2">
        {top3.map((a) => (
          <StickyActionRow action={a} isKo={isKo} key={a.rank} />
        ))}
      </div>
    </div>
  );
}

function StickyActionRow({
  action,
  isKo,
}: {
  action: ActionItem;
  isKo: boolean;
}) {
  const channelLabel = CHANNEL_LABELS[action.channel] ?? action.channel;
  return (
    <div className="group rounded-lg border border-white/10 bg-white/[0.02] p-3 transition-colors hover:border-[var(--brand-2)]/30 hover:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-xs text-zinc-400 tabular-nums">
          #{String(action.rank).padStart(2, "0")}
        </span>
        <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {channelLabel}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-3 font-medium text-xs text-zinc-100 leading-snug">
        {action.title}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className="text-zinc-400">{action.expectedTimeframe}</span>
        <span className="inline-flex items-center gap-1 text-[var(--signal-good)]">
          <span className="h-1 w-1 rounded-full bg-[var(--signal-good)]" />
          {isKo ? `임팩트 ${action.impact}/5` : `Impact ${action.impact}/5`}
        </span>
      </div>
    </div>
  );
}

function ActionCenterPending({
  job,
  isKo,
}: {
  job: JobResponse;
  isKo: boolean;
}) {
  if (job.crewStatus === "queued" || job.crewStatus === "processing") {
    return (
      <div className="mt-4 flex items-start gap-2 text-xs text-zinc-400">
        <RotateCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--brand-2)]" />
        <span className="leading-relaxed">
          {isKo
            ? "AI 마케팅팀 4명이 분석하고 있어요. 끝나면 먼저 할 일 3가지를 여기에 보여드려요."
            : "Your AI team is analyzing. Top 3 actions will appear here."}
        </span>
      </div>
    );
  }
  if (job.crewStatus === "failed") {
    return (
      <p className="mt-4 text-red-400 text-xs">
        {isKo
          ? "AI 분석 실패. 본문에서 다시 시도하세요."
          : "AI analysis failed."}
      </p>
    );
  }
  // 🔴 4번 "우측 빈 카드 → 행동 카드" (2026-08-07 세션N-8, 감사결과 문서)
  //   기존: 첫 화면 폭의 22%가 *"본문에서 …누르면 보여드려요"* 플레이스홀더였다.
  //   두 가지가 동시에 잘못돼 있었다:
  //     ① **다른 곳으로 심부름을 보낸다** — 버튼이 본문에 있으니 스크롤해서 찾아가라고 한다.
  //        (N-7이 라벨 불일치는 고쳤지만 "찾아가야 한다"는 구조 자체는 남았다.)
  //     ② 카드 안의 유일한 실동작 버튼이 `새 진단 시작` — **방금 진단한 사람에게 또 진단하라**고 한다.
  //   리서치: *"설명만 있는 빈 상태가 가장 약하다"* → 헤드라인 + 보조문 + **주 CTA 1개**.
  //   → 심부름 대신 **여기서 바로 눌리는 버튼**을 둔다(트리거 로직은 본문 카드와 공유).
  return <ActionCenterEmpty isKo={isKo} jobId={job.jobId} />;
}

function ActionCenterEmpty({ jobId, isKo }: { jobId: string; isKo: boolean }) {
  const { triggering, triggerError, signUpRequired, handleTrigger } =
    useCrewTrigger(jobId);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr";

  // 🔴 세션N-25 — 본문 카드와 **같은 트리거**라 소진 상태도 같이 갈라야 한다.
  //   여기만 빨간 에러로 남으면 한 화면에서 두 카드가 서로 다른 말을 한다.
  //
  // ⚠️ 사이드바는 좁은 패널이라 본문 카드처럼 소유권 안내 박스를 넣으면 과하다.
  //   대신 **본문 카드가 그 안내를 담당**하고(같은 화면에 동시 표시된다), 여기서는
  //   한 줄로 "같은 주소" 조건만 덧붙인다 — 두 곳이 **다른 말을 하지 않게** 한다.
  if (signUpRequired) {
    return (
      <div className="mt-4">
        <p className="font-semibold text-sm text-zinc-100 leading-relaxed">
          {isKo
            ? "무료 심층 분석을 사용하셨어요"
            : "You've used your free deep analysis"}
        </p>
        <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
          {isKo
            ? "진단에 쓴 주소로 가입하시면 계속 이용할 수 있고, 이번 진단이 기준점으로 남아요."
            : "Sign up with the email you used — you can keep going and this audit stays as your baseline."}
        </p>
        <Button asChild className="mt-3.5 w-full gap-2" size="sm">
          <a href={`${appUrl}/sign-up`}>
            <Sparkles className="h-3.5 w-3.5" />
            {isKo ? "가입하고 계속 쓰기" : "Sign up to continue"}
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="font-semibold text-sm text-zinc-100 leading-relaxed">
        {isKo ? "무엇부터 손볼지 뽑아드릴게요" : "Let's find what to fix first"}
      </p>
      <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
        {isKo
          ? "위 진단 결과를 AI 분석팀이 읽고, 이번 주에 할 수 있는 일 3개를 순서대로 정리해요. 3~5분 걸려요."
          : "Our analysts read the results above and rank 3 actions you can ship this week. Takes 3-5 min."}
      </p>
      {triggerError && (
        <p className="mt-2.5 text-red-400 text-xs">⚠ {triggerError}</p>
      )}
      <Button
        className="mt-3.5 w-full gap-2"
        disabled={triggering}
        onClick={handleTrigger}
        size="sm"
      >
        {triggering ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {isKo ? "분석 시작 중…" : "Starting…"}
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" />
            {/* 🔴 세션N-25 — 예전 라벨 `할 일 뽑기 · 무료`. 서버는 1회만 허용하므로
                횟수를 밝힌다(AthenaHQ 최대 불만 = "크레딧 소진 예측 불가"). */}
            {isKo ? "할 일 뽑기 · 무료 1회" : "Get my actions · 1 free"}
          </>
        )}
      </Button>
    </div>
  );
}

function LegacyCrewNotice({ locale, isKo }: { locale: string; isKo: boolean }) {
  return (
    <SpotlightCard border="brand" className="p-6 md:p-8">
      <div className="flex items-center gap-2 font-medium text-[var(--brand-2)] text-xs">
        <Sparkles className="h-3.5 w-3.5" />
        {isKo ? "이전 분석 데이터" : "Legacy Analysis"}
      </div>
      <h3 className="mt-3 font-bold text-xl text-zinc-50">
        {isKo
          ? "이 jobId는 이전 버전 분석 데이터를 가지고 있어요"
          : "This job has legacy analysis data"}
      </h3>
      <p className="mt-3 max-w-2xl text-sm text-zinc-400 leading-relaxed">
        {isKo
          ? "Findable이 4 에이전트 분석 출력 형식을 JSON 구조화로 업그레이드했어요. 새 형식(Monday Action·Top Actions·Findings 분리)을 보려면 새 진단을 시작해주세요."
          : "Findable upgraded the 4-agent output to structured JSON. Run a new audit to see the new format."}
      </p>
      <Button asChild className="mt-5 gap-2" size="lg">
        <a href={`/${locale}/audit`}>
          <Sparkles className="h-4 w-4" />
          {isKo ? "새 진단 시작하기" : "Start a new audit"}
        </a>
      </Button>
    </SpotlightCard>
  );
}

// 분석 트리거 — 본문 카드(CrewTriggerCard)와 사이드바 카드(ActionCenterPending)가 공유.
//   사이드바에 버튼을 넣으면서 fetch 로직을 복붙하면 두 곳이 갈라진다(CLAUDE.md §3 중복구현 금지).
function useCrewTrigger(jobId: string) {
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  // 🔴 2026-08-12 세션N-25 — "무료 체험 소진"은 **에러가 아니라 다음 단계**다.
  //   예전에는 모든 실패를 빨간 에러 문자열 하나로 뭉개서, 무료 사용자가
  //   *"무료"* 라고 적힌 버튼을 누르면 빨간 경고를 받았다(신뢰 파괴).
  //   → 서버가 주는 **구조화된 플래그**로 갈라 가입 유도로 바꾼다.
  //   ⚠️ 문구가 아니라 **플래그**로 판정한다 — 문자열 비교로 갈랐다면 서버 문구를
  //      다듬는 순간 조용히 깨진다(프로젝트 교훈: 상태는 문자열 아니라 데이터로).
  const [signUpRequired, setSignUpRequired] = useState(false);

  async function handleTrigger() {
    setTriggering(true);
    setTriggerError(null);
    try {
      const response = await fetch(`/api/audit/${jobId}/crew`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        signUpRequired?: boolean;
        capExhausted?: boolean;
      };
      if (!response.ok) {
        if (data.signUpRequired) {
          setSignUpRequired(true);
        } else {
          setTriggerError(data.error ?? `HTTP ${response.status}`);
        }
        // 🔴 세션N-25 계측 — 결과를 **구조화된 플래그로** 분류한다(문구 파싱 금지).
        //   `quota_used` 가 이 제품의 핵심 전환 신호다(가치를 느끼고 가입 화면에 닿은 수).
        let outcome: CrewTriggerOutcome = "error";
        if (data.signUpRequired) {
          outcome = "quota_used";
        } else if (data.capExhausted) {
          outcome = "daily_capped";
        } else if (response.status === 409) {
          outcome = "already";
        }
        trackCrewTriggered({ outcome });
        setTriggering(false);
        return;
      }
      trackCrewTriggered({ outcome: "started" });
      setTimeout(() => setTriggering(false), 1500);
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : String(err));
      trackCrewTriggered({ outcome: "error" });
      setTriggering(false);
    }
  }

  return { triggering, triggerError, signUpRequired, handleTrigger };
}

/**
 * 무료 crew 체험을 이미 쓴 상태 — **에러 화면이 아니라 가입 유도 화면**이다.
 *
 * 🔴 왜 이 카드가 필요한가(세션N-25): 예전에는 소진/차단이 전부 **빨간 ⚠ 문구**로
 *   나왔다. 게다가 그 문구가 *"승인 파트너·유료 플랜에서 이용할 수 있습니다"* 라
 *   **사실도 아니었다**(실제 게이트는 결제가 아니라 **로그인**이다).
 *   → 고객이 받는 인상이 "고장났네" 또는 "무료라더니 거짓말이네" 였다.
 *
 * ⭐ 퍼널 관점: 이 지점이 결과 페이지에서 **유일한 자연 발생 전환 순간**이다.
 *   여기서 가입시키면 퍼널 최대 누수(*"가입해도 빈손"*)를 crew 가치로 메울 수 있다.
 *   📕 선례: HubSpot AEO Grader 도 **무료 1회 진단 → 유료 모니터링** 2단 퍼널이고,
 *   무료 진단 자체를 leadgen 으로 쓴다(우리 5축 배점도 HubSpot 과 동일 구성이다).
 */
function CrewSignUpCard({
  isKo,
  emailMasked,
}: {
  isKo: boolean;
  emailMasked: string | null;
}) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr";

  // 🔴 **공유 링크(`?shared=1`)에서는 이메일을 절대 노출하지 않는다.**
  //   결과 페이지는 링크만 있으면 누구나 볼 수 있으므로, 마스킹된 주소라도
  //   제3자에게 보여주면 소유자 정보가 샌다. `UpsellCard`(`:4003`)가 쓰는 것과
  //   **같은 판정**을 쓴다 — 한쪽만 가리면 다른 쪽으로 새기 때문이다.
  //   ⚠️ 초기값 `true`(=숨김): 판별 전 한 프레임이라도 노출되는 쪽이 위험하다.
  //   ⚠️ 렌더 중 `window` 를 읽으면 하이드레이션 불일치가 나므로 effect 로 읽는다.
  //   ✅ **세션N-26 해결** — 예전엔 여기 *"정석은 서버측 소유자 판별인데 라우트가
  //      소유 검사 없이 `emailMasked` 를 항상 준다"* 는 한계가 적혀 있었다.
  //      이제 `/api/audit/[jobId]` 가 **소유자에게만** 그 필드를 넣는다
  //      (`@repo/audit/ownership` · 판정 실패 시 비소유로 닫힘).
  //      → 주소창 URL 을 그대로 복사해 보내도 제3자에겐 값이 **오지 않는다**.
  const [isSharedView, setIsSharedView] = useState(true);
  useEffect(() => {
    setIsSharedView(
      new URLSearchParams(window.location.search).get("shared") === "1"
    );
  }, []);
  const ownerEmail = isSharedView ? null : emailMasked;

  return (
    <SpotlightCard className="p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-grad-brand text-white">
          <Users className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-xl text-zinc-50">
            {isKo
              ? "무료 심층 분석을 사용하셨어요"
              : "You've used your free deep analysis"}
          </h3>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "가입하시면 심층 분석을 계속 이용할 수 있고, 이번 진단이 기준점으로 남아 다음 측정과 비교돼요."
              : "Sign up to keep running deep analysis — and this audit stays as your baseline to compare against."}
          </p>

          {/* 🔴 소유권 안내 — `UpsellCard` 의 "장치 A" 와 **같은 성질**이다.
              대시보드는 `AuditJob.email IN [로그인 이메일]` 로 내 진단을 찾으므로
              (`(authenticated)/page.tsx:47`·`history/page.tsx:23`), **다른 주소로
              가입하면 이 결과가 조용히 사라진다.**
              ⚠️ 이 카드에는 그 안내가 빠져 있었다 — 같은 화면의 `UpsellCard` 는
              안내하는데 여기만 없으면 **가입 유도의 결과가 갈린다**.
              ⚠️ 프리필은 걸지 않는다: API 가 주는 값은 **마스킹된 주소**라 그대로
              넣으면 오연결이 된다(기존 판단 유지 · `:3946` 주석). */}
          {ownerEmail && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-[var(--brand-3)]/25 bg-[var(--brand-3)]/5 p-3.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-3)]" />
              <p className="text-sm text-zinc-300 leading-relaxed">
                {isKo ? (
                  <>
                    이 결과를 이어받으려면{" "}
                    <span className="font-mono font-semibold text-zinc-100">
                      {ownerEmail}
                    </span>{" "}
                    같은 주소로 가입하셔야 해요.
                  </>
                ) : (
                  <>
                    Sign up with{" "}
                    <span className="font-mono font-semibold text-zinc-100">
                      {ownerEmail}
                    </span>{" "}
                    to keep this result.
                  </>
                )}
              </p>
            </div>
          )}

          <Button asChild className="mt-4 gap-2" size="lg">
            <a href={`${appUrl}/sign-up`}>
              <Sparkles className="h-4 w-4" />
              {isKo ? "가입하고 계속 쓰기" : "Sign up to continue"}
            </a>
          </Button>
        </div>
      </div>
    </SpotlightCard>
  );
}

function CrewTriggerCard({
  jobId,
  isKo,
  emailMasked,
}: {
  jobId: string;
  isKo: boolean;
  emailMasked: string | null;
}) {
  const { triggering, triggerError, signUpRequired, handleTrigger } =
    useCrewTrigger(jobId);

  // 🔴 2026-08-12 세션N-25 — 무료 체험을 다 쓴 상태는 **에러가 아니라 다음 단계**다.
  //   빨간 경고 대신 가입 경로를 준다. (예전엔 여기가 빨간 ⚠ 문구였다.)
  if (signUpRequired) {
    return <CrewSignUpCard emailMasked={emailMasked} isKo={isKo} />;
  }

  return (
    <SpotlightCard className="p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-grad-brand text-white">
          <Users className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-medium text-[var(--brand-2)] text-xs">
            <Sparkles className="h-3 w-3" />
            {/* 🔴 2026-08-12 세션N-25 — 예전 라벨은 `베타 · 무료` 였다.
                그런데 서버는 비로그인 리드에게 **1회만** 허용한다 → 횟수를 **미리** 밝힌다.
                📕 근거(경쟁사 실측): AthenaHQ 의 **가장 반복되는 불만**이
                *"크레딧 소진 예측 불가"* 였다 — *"첫 주에 한 달 할당량을 다 태웠다"*.
                남은 횟수를 안 알려주는 것이 그 불만의 원인이므로 **선고지**한다. */}
            {isKo ? "무료 1회" : "1 free run"}
          </div>
          <h3 className="mt-3 font-bold text-xl text-zinc-50">
            {isKo
              ? "AI 마케팅팀 4명에게 깊이 있는 분석 받기"
              : "Get deep analysis from 4 AI marketing analysts"}
          </h3>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "AI 에이전트 4개(한국 GEO·글로벌 비교·인용 출처·실행 전략)가 위 데이터를 분석해서 이번 주에 할 수 있는 일 1개를 뽑아드려요. 가입 없이 지금 한 번 받아보실 수 있어요. 약 3~5분."
              : "Four AI agents (Korean GEO · global benchmark · citations · strategy) analyze the data above and propose one action you can ship this week. One run, no sign-up needed. ~3-5 min."}
          </p>
          {triggerError && (
            <p className="mt-3 text-red-400 text-sm">⚠ {triggerError}</p>
          )}
          <Button
            className="mt-4 gap-2"
            disabled={triggering}
            onClick={handleTrigger}
            size="lg"
          >
            {triggering ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isKo ? "분석 시작 중…" : "Starting…"}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {/* 🔴 라벨 일치 (2026-08-06 세션N-7): 우측 안내문이 'AI 마케팅팀 분석 시작'을
                    누르라고 하는데 버튼은 "4 에이전트 분석 시작"이어서 **없는 버튼을 찾게 만들었다**.
                    "4 에이전트"는 내부 구조 용어이기도 하다 —
                    Stripe 규칙 *"라벨은 시스템 구조가 아니라 사용자 의도"*("Chargeback Events"❌→"Disputes"○). */}
                {isKo ? "AI 마케팅팀 분석 시작" : "Start 4-agent analysis"}
              </>
            )}
          </Button>
        </div>
      </div>
    </SpotlightCard>
  );
}

function CrewProcessingCard({ isKo }: { isKo: boolean }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6 md:p-8">
      <div className="flex items-center gap-4">
        <RotateCw className="h-6 w-6 animate-spin text-[var(--brand-2)]" />
        <div>
          <h3 className="font-bold text-lg text-zinc-50">
            {isKo
              ? "AI 마케팅팀이 분석하고 있어요…"
              : "Your AI team is analyzing…"}
          </h3>
          <p className="mt-1 text-sm text-zinc-400">
            {isKo ? "3~5분쯤 걸려요." : "Takes about 3-5 minutes."}
          </p>
        </div>
      </div>
    </section>
  );
}

function CrewFailedCard({ jobId, isKo }: { jobId: string; isKo: boolean }) {
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    setRetrying(true);
    try {
      await fetch(`/api/audit/${jobId}/crew`, { method: "POST" });
    } catch {
      // ignore
    }
    setTimeout(() => setRetrying(false), 1500);
  }
  return (
    <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 md:p-8">
      <div className="flex items-start gap-4">
        <XCircle className="mt-1 h-5 w-5 shrink-0 text-red-400" />
        <div className="flex-1">
          <h3 className="font-bold text-lg text-red-300">
            {isKo ? "AI 분석 실패" : "AI analysis failed"}
          </h3>
          <p className="mt-1 text-red-400 text-sm">
            {isKo
              ? "AI를 부르는 중에 문제가 생겼어요. 잠시 후 다시 시도해 주세요."
              : "Error calling AI model. Please retry shortly."}
          </p>
          <Button
            className="mt-3"
            disabled={retrying}
            onClick={retry}
            size="sm"
            variant="outline"
          >
            {retrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isKo ? (
              "다시 시도"
            ) : (
              "Retry"
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Naver AI 브리핑 — on-demand 측정 카드 (D-2026-07-22)
//   본류 7 엔진과 분리. Browserbase 클라우드 크롬 사용 (느림)이라 버튼으로만 트리거.
//   briefingStatus별로 트리거/진행중/완료/실패 뷰. CrewTriggerCard 패턴 미러.
// ──────────────────────────────────────────────────────────────────

function NaverBriefingCard({
  jobId,
  briefingStatus,
  briefingPrompt,
  engineResponses,
  isKo,
  onTriggered,
}: {
  jobId: string;
  briefingStatus: BriefingStatus;
  briefingPrompt?: string;
  engineResponses: JobResult["engineResponses"];
  isKo: boolean;
  onTriggered: () => void;
}) {
  if (briefingStatus === "processing") {
    return <NaverBriefingProcessingCard isKo={isKo} />;
  }
  if (briefingStatus === "completed") {
    return (
      <NaverBriefingCompletedCard
        briefingPrompt={briefingPrompt}
        engineResponses={engineResponses}
        isKo={isKo}
        jobId={jobId}
      />
    );
  }
  // not_requested · failed → 트리거 카드 (failed는 재시도 안내 병기)
  return (
    <NaverBriefingTriggerCard
      failed={briefingStatus === "failed"}
      isKo={isKo}
      jobId={jobId}
      onTriggered={onTriggered}
    />
  );
}

function NaverBriefingTriggerCard({
  jobId,
  failed,
  isKo,
  onTriggered,
}: {
  jobId: string;
  failed: boolean;
  isKo: boolean;
  onTriggered: () => void;
}) {
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  async function handleTrigger() {
    setTriggering(true);
    setTriggerError(null);
    try {
      const response = await fetch(`/api/audit/${jobId}/briefing`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setTriggerError(data.error ?? `HTTP ${response.status}`);
        setTriggering(false);
        return;
      }
      // 성공 → 부모가 briefingStatus=processing 낙관 반영 + 폴링 재개.
      // (완료 화면에서는 폴링이 멈춰 있어 이 신호가 없으면 카드가 갱신되지 않는다.)
      onTriggered();
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : String(err));
      setTriggering(false);
    }
  }

  return (
    <SpotlightCard className="p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-grad-brand text-white">
          <Search className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-medium text-[var(--brand-2)] text-xs">
            <Sparkles className="h-3 w-3" />
            {isKo ? "베타 · 무료" : "Beta · Free"}
          </div>
          <h3 className="mt-3 font-bold text-xl text-zinc-50">
            {isKo
              ? "네이버 AI 브리핑에서도 측정해보기"
              : "Measure Naver AI Briefing too"}
          </h3>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "네이버 검색의 AI 브리핑에 우리가 나오는지 직접 확인해요. 실제로 검색해 보기 때문에 30초~1분쯤 걸려요."
              : "Checks whether your brand is cited in Naver's AI Briefing. Runs a real search via cloud browser (~30s-1m)."}
          </p>
          {failed && (
            <p className="mt-3 text-amber-400 text-sm">
              {isKo
                ? "⚠ 지난번 측정이 실패했어요. 다시 시도할 수 있어요."
                : "⚠ Last measurement failed. You can retry."}
            </p>
          )}
          {triggerError && (
            <p className="mt-3 text-red-400 text-sm">⚠ {triggerError}</p>
          )}
          <Button
            aria-busy={triggering}
            className="mt-4 gap-2"
            disabled={triggering}
            onClick={handleTrigger}
            size="lg"
          >
            {triggering ? (
              <>
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                {isKo ? "측정 시작 중…" : "Starting…"}
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                {failed
                  ? isKo
                    ? "다시 측정하기"
                    : "Retry measurement"
                  : isKo
                    ? "네이버 AI 브리핑 측정"
                    : "Measure Naver AI Briefing"}
              </>
            )}
          </Button>
        </div>
      </div>
    </SpotlightCard>
  );
}

function NaverBriefingProcessingCard({ isKo }: { isKo: boolean }) {
  return (
    // `<output>` = 진행/결과 알림의 시맨틱 요소로 `role="status"` 를 암묵 포함한다
    //   (role 을 직접 다는 것보다 정확). ⚠️ 기본 display 가 inline 이라 `block` 을 명시해야
    //   기존 카드 레이아웃(패딩·테두리)이 그대로 유지된다.
    <output
      aria-live="polite"
      className="block rounded-2xl border border-white/10 bg-zinc-900/60 p-6 md:p-8"
    >
      <div className="flex items-center gap-4">
        <RotateCw
          aria-hidden="true"
          className="h-6 w-6 animate-spin text-[var(--brand-2)]"
        />
        <div>
          <h3 className="font-bold text-lg text-zinc-50">
            {isKo
              ? "네이버 AI 브리핑 측정 중…"
              : "Measuring Naver AI Briefing…"}
          </h3>
          <p className="mt-1 text-sm text-zinc-400">
            {isKo
              ? "클라우드 브라우저로 실제 검색을 하고 있어요. 약 30초~1분 걸려요."
              : "Running a real search via cloud browser. ~30s-1m."}
          </p>
        </div>
      </div>
    </output>
  );
}

/** 문장이 중간에서 끊겼는지 — 브리핑 박스 접힘 스크랩 한계(전수감사 §A-5). */
const SENTENCE_END_RE = /[.!?다요…]["')\]]?\s*$/;

/**
 * 브리핑 결과가 없을 때 — **왜 없는지에 따라 다르게 말한다**(N-45).
 *
 * | 사유 | 무엇이 사실인가 | 화면이 해야 할 말 |
 * |---|---|---|
 * | 미노출 | **쟀다.** 브리핑이 우리를 안 말했다 | 기회다 — 지금 선점할 수 있다 |
 * | 크레딧·인증 | **못 쟀다.** 측정 자체가 안 됐다 | 우리 쪽 문제다 — 곧 복구된다 |
 * | 속도제한 | **못 쟀다.** 일시적이다 | 잠시 뒤 다시 된다 |
 *
 * 🔴 이 셋을 한 칸에 뭉치면 **못 잰 것을 「네이버가 우리를 모른다」로 오독**한다.
 *   고객은 그 말을 믿고 GEO 개선에 돈을 쓴다 — **틀린 근거로 의사결정을 시킨다.**
 *
 * ⚠️ 기술 원문(`errorMessage`)은 화면에 그대로 내보내지 않는다. 사유만 분류해 쓴다.
 *   (`[크레딧소진] Firecrawl HTTP 402: {...}` 같은 문자열은 고객이 읽을 것이 아니다)
 */
// 🔬 export 이유: 실제 렌더해 **세 상태의 문구를 눈으로** 확인하기 위해
//   (`audit-result.tsx` 는 4,300줄이라 통째로 띄우기 어렵고, DB 없이는 페이지가 안 뜬다).
//   📕 규율: 화면은 스크린샷·렌더로 확인한다 — 테스트 통과만으로 「됐다」고 하지 않는다.
export function BriefingNotSurfaced({
  errorMessage,
  isKo,
}: {
  errorMessage: string | null;
  isKo: boolean;
}) {
  // 측정을 **못 한** 경우 — 우리 쪽 사정이라 「미노출」이라 말하면 안 된다.
  const blocked =
    errorMessage?.startsWith(BRIEFING_FAIL_PREFIX.credits) ||
    errorMessage?.startsWith(BRIEFING_FAIL_PREFIX.auth);
  const throttled = errorMessage?.startsWith(BRIEFING_FAIL_PREFIX.rateLimit);

  if (blocked || throttled) {
    return (
      <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-900/50 p-4">
        <p className="font-semibold text-sm text-zinc-200">
          {isKo
            ? "이번엔 측정하지 못했어요"
            : "We couldn't measure this time"}
        </p>
        <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
          {isKo
            ? throttled
              ? "요청이 몰려 잠시 막혔어요. 조금 뒤에 다시 시도하면 측정됩니다."
              : "측정 도구 연결에 문제가 있어요. 저희가 확인하고 있으니 곧 다시 측정됩니다."
            : throttled
              ? "Requests were throttled. Try again shortly and it will measure."
              : "Our measurement tool is having trouble connecting. We're on it — this will be measured again soon."}
        </p>
        <p className="mt-2 text-xs text-zinc-500 leading-relaxed">
          {isKo
            ? "⚠️ 네이버 AI 브리핑이 우리를 말하지 않는다는 뜻은 아니에요 — 아직 확인하지 못한 것뿐이에요."
            : "⚠️ This does not mean Naver AI Briefing omits your brand — we simply haven't checked yet."}
        </p>
      </div>
    );
  }

  // 여기서부터는 **정상 결과**다 — 쟀고, 안 나왔다(= GEO 기회).
  return (
    <div className="mt-3 rounded-xl border border-[var(--brand-2)]/20 bg-[var(--brand-2)]/5 p-4">
      <p className="font-semibold text-sm text-zinc-200">
        {isKo
          ? "아직 네이버 AI 브리핑에 안 나와요"
          : "Not yet surfaced in Naver AI Briefing"}
      </p>
      <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
        {isKo
          ? "이 질문에서 네이버 AI 브리핑은 아직 우리를 말하지 않아요. 경쟁사가 먼저 자리를 잡기 전에 지금 선점할 수 있어요."
          : "Naver AI Briefing doesn't cite your brand for this query yet, which is exactly the opening to claim that visibility before competitors do."}
      </p>
    </div>
  );
}

function NaverBriefingCompletedCard({
  jobId: _jobId,
  briefingPrompt,
  engineResponses,
  isKo,
}: {
  jobId: string;
  briefingPrompt?: string;
  engineResponses: JobResult["engineResponses"];
  isKo: boolean;
}) {
  const briefing = engineResponses.find((r) => r.engineId === "naver-briefing");

  // 어떤 질문을 던졌는지 — 이게 없으면 "후기" 답변이 뜬금없어 보인다(§A-5).
  // 질의(효과/후기/장단점)는 네이버 AI 브리핑이 노출되는 유형이라 의도된 선택.
  let queryNotice: string;
  if (briefingPrompt) {
    queryNotice = isKo
      ? `네이버에 "${briefingPrompt}"로 검색했을 때 나온 AI 브리핑 답변이에요.`
      : `Naver AI Briefing answer for the query "${briefingPrompt}".`;
  } else {
    queryNotice = isKo
      ? "네이버 AI 브리핑이 잘 뜨는 질문(효과·후기·장단점)으로 검색한 결과예요."
      : "Measured with query types that trigger Naver AI Briefing.";
  }

  return (
    <SpotlightCard border="brand" className="p-6 md:p-8">
      <div className="flex items-center gap-2 font-medium text-[var(--brand-2)] text-xs">
        <Search className="h-3.5 w-3.5" />
        {isKo ? "네이버 AI 브리핑 측정 완료" : "Naver AI Briefing measured"}
      </div>
      <p className="mt-2 text-xs text-zinc-400">{queryNotice}</p>
      {!briefing || briefing.errorMessage ? (
        // 🔴 **「미노출」과 「못 쟀다」를 구분한다**(N-45).
        //   예전엔 둘을 한 칸에 뭉개 `errorMessage` 가 있으면 무조건
        //   *"아직 네이버 AI 브리핑에 안 나와요"* 라고 했다. 그런데 크레딧이 마르면
        //   **측정 자체를 못 한 것**인데 화면은 *"네이버가 우리를 말하지 않는다"* 고
        //   말한다 = 📕 이 저장소 최다 사고 유형인 **「못 잰 것을 0점이라 부르기」**.
        //   (같은 계열: apple.com 오판 · N-36 Tracking 유실 · N-31)
        <BriefingNotSurfaced
          errorMessage={briefing?.errorMessage ?? null}
          isKo={isKo}
        />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <MentionBadge
              isStub={briefing.isStub}
              mentioned={briefing.brandMentioned}
              position={briefing.mentionPosition}
            />
            <SentimentBadge sentiment={briefing.sentiment} />
          </div>
          <p className="mt-4 whitespace-pre-line text-sm text-zinc-300 leading-relaxed [overflow-wrap:anywhere]">
            {briefing.isStub
              ? isKo
                ? "네이버 AI 브리핑 연결이 아직 켜지지 않았어요 (Browserbase 미설정)."
                : "Naver AI Briefing is not connected yet (Browserbase not configured)."
              : (() => {
                  // 브리핑 박스는 접힌 상태로 스크랩돼 문장이 중간에 끊길 수 있다
                  // ("…준비형 콘텐츠가 더 많" §A-5). 끊겼으면 말줄임을 붙여
                  // "잘린 게 아니라 원문이 더 있다"는 걸 알린다.
                  const text = stripMarkdown(briefing.excerpt);
                  if (!text) {
                    return isKo ? "(응답 없음)" : "(no response)";
                  }
                  return SENTENCE_END_RE.test(text) ? text : `${text}…`;
                })()}
          </p>
        </>
      )}
    </SpotlightCard>
  );
}

// ──────────────────────────────────────────────────────────────────
// Spotlight Card — 마우스 추적 글로우
// ──────────────────────────────────────────────────────────────────

function SpotlightCard({
  children,
  className = "",
  border = "default",
}: {
  children: React.ReactNode;
  className?: string;
  border?: "default" | "brand";
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  const borderCls =
    border === "brand"
      ? "border-l-4 border-l-[var(--brand-2)] border-y border-r border-white/10"
      : "border border-white/10";

  return (
    // `onMouseMove` 는 **순수 시각 효과**(커서를 따라가는 빛 번짐)일 뿐 클릭 동작이 없다.
    //   → 키보드 대체 조작이 필요 없고(못 봐도 잃는 기능 0), 상호작용 role 을 주면
    //   스크린리더에 의미 없는 노드만 늘어난다. 장식임을 명시한다.
    // biome-ignore lint/a11y/noStaticElementInteractions: 장식용 포인터 효과 — 대체 조작 불필요
    <div
      className={`group relative overflow-hidden rounded-2xl bg-zinc-900/60 backdrop-blur-sm ${borderCls} ${className}`}
      onMouseMove={onMove}
      ref={ref}
      role="presentation"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(450px circle at var(--mx, 50%) var(--my, 50%), oklch(0.72 0.16 47 / 0.18), transparent 60%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Top Actions — stagger reveal + rank 1 글로우
// ──────────────────────────────────────────────────────────────────

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  },
};

// 메인 영역 — Top 3는 사이드바, 4~6위만 본문에 (사이드바 강조 위해)
function SecondaryActionsGrid({
  strategist,
  isKo,
}: {
  strategist: StrategistReport;
  isKo: boolean;
}) {
  if (!strategist.output) {
    return null;
  }
  const actions = strategist.output.topActions.slice(3, 6);
  if (actions.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-medium text-xs text-zinc-400">
        <Target className="h-3.5 w-3.5" />
        {isKo
          ? "AI 분석 제안 4~6순위 — 오른쪽 '먼저 할 일 3가지'에 이어지는 후순위"
          : "AI analyst suggestions #4–6 — following the top 3 in 'Action Center'"}
      </div>
      <motion.div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        initial="hidden"
        variants={stagger}
        viewport={{ once: true, amount: 0.2 }}
        whileInView="show"
      >
        {actions.map((action) => (
          <ActionCard action={action} isKo={isKo} key={action.rank} />
        ))}
      </motion.div>
    </section>
  );
}

function ActionCard({ action, isKo }: { action: ActionItem; isKo: boolean }) {
  const channelLabel = CHANNEL_LABELS[action.channel] ?? action.channel;

  return (
    <motion.div
      className="group relative rounded-xl border border-white/10 bg-zinc-900/60 p-5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[var(--brand-2)]/30"
      variants={item}
    >
      {action.rank === 1 && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-xl opacity-25 blur-xl transition-opacity group-hover:opacity-40"
          style={{
            background:
              "linear-gradient(135deg, var(--brand-1), var(--brand-2))",
          }}
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-zinc-400 tabular-nums">
          #{String(action.rank).padStart(2, "0")}
        </span>
        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-400">
          {channelLabel}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-3 font-semibold text-base text-zinc-50 leading-snug">
        {action.title}
      </h3>
      <p className="mt-2 line-clamp-3 text-sm text-zinc-400 leading-relaxed">
        {action.rationale}
      </p>
      <div className="mt-4 flex items-center justify-between border-white/5 border-t pt-3 text-xs">
        {/* 🔴 S7-2차(2026-08-11) — `임팩트 4/5`·`노력 2/5` 만 있고 **5가 뭘 뜻하는지
            화면에 없었다**. 카드 3장을 비교하려면 축을 알아야 한다 → 각 항목에 설명을
            달아 마우스를 올리면 뜨게 한다(카드가 좁아 본문에 넣으면 잡음이 된다). */}
        <div className="flex items-center gap-2">
          <ScoreDot
            hint={
              isKo
                ? "고치면 AI 답변에 얼마나 크게 반영될지 (5 = 가장 큼)"
                : "How much this moves AI answers (5 = most)"
            }
            label={isKo ? "임팩트" : "Impact"}
            score={action.impact}
            tone="emerald"
          />
          <ScoreDot
            hint={
              isKo
                ? "실행에 드는 품 (5 = 가장 많이 듦)"
                : "How much work it takes (5 = most)"
            }
            label={isKo ? "노력" : "Effort"}
            score={action.effort}
            tone="zinc"
          />
        </div>
      </div>
      <div className="mt-2 text-xs text-zinc-400">
        {action.expectedTimeframe}
      </div>
    </motion.div>
  );
}

function ScoreDot({
  hint,
  label,
  score,
  tone,
}: {
  hint?: string;
  label: string;
  score: number;
  tone: "emerald" | "zinc";
}) {
  const dotCls = tone === "emerald" ? "bg-[var(--signal-good)]" : "bg-zinc-500";
  return (
    <span className="inline-flex items-center gap-1 text-zinc-400" title={hint}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
      {label} {score}/5
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Analysts — collapsed 아코디언
// ──────────────────────────────────────────────────────────────────

function AnalystsSection({
  analysts,
  isKo,
}: {
  analysts: AnalystReport[];
  isKo: boolean;
}) {
  if (analysts.length === 0) {
    return null;
  }
  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-medium text-xs text-zinc-400">
        <Users className="h-3.5 w-3.5" />
        {isKo ? "분석가 리포트" : "Analyst Reports"}
      </div>
      <div className="space-y-3">
        {analysts.map((a) => (
          <AnalystAccordion isKo={isKo} key={a.agentId} report={a} />
        ))}
      </div>
    </section>
  );
}

function AnalystAccordion({
  report,
  isKo,
}: {
  report: AnalystReport;
  isKo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const out = report.output;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
      <button
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/5"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{report.emoji}</span>
          <div>
            <div className="font-semibold text-sm text-zinc-100">
              {report.displayName}
            </div>
            <div className="font-medium text-xs text-zinc-400">
              {report.role}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {out && (
            <span className="hidden max-w-md truncate text-sm text-zinc-400 md:block">
              {out.executiveSummary}
            </span>
          )}
          {report.errorMessage && (
            <span className="text-red-400 text-xs">⚠ 오류</span>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="border-white/10 border-t px-5 py-5">
          {report.errorMessage ? (
            <p className="text-red-400 text-sm">⚠ {report.errorMessage}</p>
          ) : out ? (
            <div className="space-y-4">
              <p className="font-medium text-sm text-zinc-200 leading-relaxed">
                {out.executiveSummary}
              </p>
              {out.findings.length > 0 && (
                <div className="space-y-2">
                  {out.findings.map((f, i) => (
                    <FindingRow finding={f} key={i} />
                  ))}
                </div>
              )}
              {out.observation && (
                <div className="rounded-md border border-white/5 bg-white/5 p-3 text-sm text-zinc-400 leading-relaxed">
                  {out.observation}
                </div>
              )}
              {out.dataGaps.length > 0 && (
                // 전수감사 §A-6: 분석가 3명 × 5~6건씩 전부 나열해 "왜 다 데이터
                // 부족이냐"는 인상을 만들었다. 이건 분석의 한계 고지(내부 메타)라
                // 기본 접힘으로 강등 — 원문은 보존하되 시선을 뺏지 않게.
                <details className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
                  <summary className="cursor-pointer select-none">
                    {isKo
                      ? `이번 분석에서 확인하지 못한 것 ${out.dataGaps.length}건 (참고용)`
                      : `${out.dataGaps.length} things this analysis couldn't verify`}
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {out.dataGaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              {isKo ? "응답이 없어요." : "No response."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const dotCls =
    finding.severity === "red"
      ? "bg-[var(--signal-bad)]"
      : finding.severity === "amber"
        ? "bg-[var(--signal-warn)]"
        : "bg-[var(--signal-good)]";
  return (
    <div className="flex items-start gap-3 rounded-md border border-white/5 bg-white/5 px-3 py-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
      <div className="flex-1">
        <div className="font-semibold text-sm text-zinc-100">
          {finding.title}
        </div>
        <div className="mt-0.5 text-xs text-zinc-400">
          {finding.whyItMatters}
        </div>
        {finding.detail && (
          <div className="mt-1 text-xs text-zinc-400 leading-relaxed">
            {finding.detail}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Engines — sticky 탭 + layoutId 슬라이드 (Linear)
// ──────────────────────────────────────────────────────────────────

/**
 * AI 응답 원문 — 기본은 접힌 상태(최대 높이 제한 + 하단 페이드), "전체 보기"로 펼친다.
 *
 * 왜 글자수로 안 자르나: `…`로 자르면 문장이 끊겨 **AI가 실제로 뭐라고 했는지**가 왜곡된다.
 *   높이만 제한하면 원문은 온전하고 사용자가 필요할 때 전체를 본다(진행형 공개).
 * ⚠️ 접힘 임계보다 짧은 응답엔 버튼을 달지 않는다 — 누를 게 없는 버튼은 노이즈다.
 */
const COLLAPSED_MAX_CHARS = 700;

function toggleLabel(expanded: boolean, isKo: boolean): string {
  if (expanded) {
    return isKo ? "접기" : "Collapse";
  }
  return isKo ? "전체 보기" : "Show full response";
}

/** 원문이 없는 3가지 경우(오류·미연결·빈 응답)를 각각 다른 문장으로. */
function ResponseFallback({
  response,
  isKo,
}: {
  response: JobResult["engineResponses"][number];
  isKo: boolean;
}) {
  if (response.errorMessage) {
    return <span className="text-red-400">⚠ {response.errorMessage}</span>;
  }
  if (response.isStub) {
    return (
      <span className="text-zinc-400">
        {isKo
          ? "이 AI는 아직 연결되지 않았어요. 다음 측정부터 넣어드려요."
          : "This AI is not connected yet. Will be included next time."}
      </span>
    );
  }
  return (
    <span className="text-zinc-400">
      {isKo ? "(응답 없음)" : "(no response)"}
    </span>
  );
}

function ResponseBody({
  content,
  fallback,
  isKo,
}: {
  content: string | null;
  fallback: React.ReactNode;
  isKo: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!content) {
    return (
      <div className="mt-4 whitespace-pre-line text-sm text-zinc-300 leading-relaxed [overflow-wrap:anywhere]">
        {fallback}
      </div>
    );
  }

  const needsCollapse = content.length > COLLAPSED_MAX_CHARS;

  return (
    <div className="mt-4">
      <div
        className={`relative whitespace-pre-line text-sm text-zinc-300 leading-relaxed [overflow-wrap:anywhere] ${
          needsCollapse && !expanded ? "max-h-[15rem] overflow-hidden" : ""
        }`}
      >
        {content}
        {needsCollapse && !expanded && (
          // 하단 페이드 — "더 있다"를 색으로 알린다(잘린 게 아니라 접힌 것).
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-900 to-transparent" />
        )}
      </div>
      {needsCollapse && (
        <button
          className="mt-3 text-[var(--brand-2)] text-xs underline underline-offset-2 hover:text-zinc-200"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {toggleLabel(expanded, isKo)}
        </button>
      )}
    </div>
  );
}

function EnginesTabsSection({
  result,
  isKo,
}: {
  result: JobResult;
  isKo: boolean;
}) {
  const dedup = dedupeByEngine(result.engineResponses);
  const [selected, setSelected] = useState<string>(dedup[0]?.engineId ?? "");
  const current = dedup.find((r) => r.engineId === selected);

  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-medium text-xs text-zinc-400">
        {isKo ? "엔진별 응답" : "Engine Responses"}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
        {/* 🔴 세션N-28 ② — 모바일에서 탭이 **가로 스크롤로 잘려 있었다**.
            실측(390px): 탭 줄 내용 653px vs 칸 340px → **313px 이 화면 밖**.
            밀려난 것이 하필 **네이버·다음**(= 한국 AI 커버리지, 우리 차별점)이라
            "스크롤하면 보인다"로 넘길 수 없었다. 손가락으로 밀 생각을 못 하면
            그 엔진은 **없는 것과 같다**(닐슨 ⑥ 기억보다 인식).
            → `flex-wrap` 으로 두 줄에 다 보이게 한다. 드롭다운은 쓰지 않는다(1클릭 증가).
            ⚠️ `shrink-0` 은 유지 — 라벨이 쪼그라들어 글자가 겹치면 안 된다.
            ⚠️ `layoutId` 밑줄은 줄이 바뀌어도 spring 으로 따라간다(세로 이동만 추가됨). */}
        <div className="flex flex-wrap gap-1 border-white/10 border-b bg-white/[0.02] px-2">
          {dedup.map((r) => {
            const isActive = r.engineId === selected;
            return (
              <button
                className={`relative shrink-0 px-4 py-3 font-medium text-sm transition-colors ${
                  isActive
                    ? "text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                key={r.engineId}
                onClick={() => setSelected(r.engineId)}
                type="button"
              >
                {ENGINE_LABELS[r.engineId] ?? r.engineId}
                {r.engineId === "chatgpt-web" && (
                  <span className="ml-1.5 rounded border border-[var(--brand-2)]/30 bg-[var(--brand-2)]/10 px-1 text-[10px] text-[var(--brand-2)]">
                    BETA
                  </span>
                )}
                {isActive && (
                  <motion.div
                    className="absolute inset-x-2 -bottom-px h-0.5 bg-grad-brand"
                    layoutId="engine-tab-indicator"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {current && (
          <div className="px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <MentionBadge
                isStub={current.isStub}
                mentioned={current.brandMentioned}
                position={current.mentionPosition}
              />
              <SentimentBadge sentiment={current.sentiment} />
              <span className="font-mono text-xs text-zinc-400 tabular-nums">
                {current.durationMs}ms
              </span>
            </div>
            {/* 🔴 원문 접기 (2026-08-06 세션N-7) — 페이지 최대 분량 구간.
                실측: excerpt가 최대 **3,908자**(평균 1,245~1,451자)로 잘림 없이 렌더돼
                이 섹션 하나가 전체 높이의 상당 부분을 먹었다.
                근거: 리서치 02번 *"진행형 공개가 전 소스에서 가장 반복된 IA 원칙"* ·
                Apple Deference *"UI는 콘텐츠와 경쟁하지 않는다"*.
                ⚠️ **삭제·요약이 아니라 접기**다 — 이 원문이 진실거울의 증거이고
                "AI가 우리를 이렇게 말한다"의 근거라 없애면 제품의 핵심이 사라진다. */}
            <ResponseBody
              content={
                current.errorMessage || current.isStub
                  ? null
                  : stripMarkdown(current.excerpt)
              }
              fallback={<ResponseFallback isKo={isKo} response={current} />}
              isKo={isKo}
              key={current.engineId}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function MentionBadge({
  mentioned,
  position,
  isStub,
}: {
  mentioned: boolean;
  position: number | null;
  isStub: boolean;
}) {
  if (isStub) {
    return <Pill tone="muted">측정 안 됨</Pill>;
  }
  if (!mentioned) {
    return <Pill tone="negative">미언급</Pill>;
  }
  if (position) {
    return <Pill tone="positive">{position}위</Pill>;
  }
  return <Pill tone="positive">언급</Pill>;
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (sentiment === "positive") {
    return <Pill tone="positive">긍정</Pill>;
  }
  if (sentiment === "negative") {
    return <Pill tone="negative">부정</Pill>;
  }
  if (sentiment === "neutral") {
    return <Pill tone="neutral">중립</Pill>;
  }
  return <Pill tone="muted">—</Pill>;
}

function Pill({
  tone,
  children,
}: {
  tone: "positive" | "negative" | "neutral" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "positive"
      ? "bg-[var(--signal-good)]/10 text-[var(--signal-good)] border-[var(--signal-good)]/30"
      : tone === "negative"
        ? "bg-[var(--signal-bad)]/10 text-[var(--signal-bad)] border-[var(--signal-bad)]/30"
        : tone === "neutral"
          ? "bg-[var(--signal-warn)]/10 text-[var(--signal-warn)] border-[var(--signal-warn)]/30"
          : "bg-white/5 text-zinc-400 border-white/10";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-xs ${cls}`}
    >
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Citation Sources — Perplexity 칩 (favicon + %)
// ──────────────────────────────────────────────────────────────────

// 🔴 감사 7번 — 인용 출처 등급 표기 (2026-08-07 세션N-8)
//   거절 사유: *"법무팀에 '나무위키가 우리 브랜드 서술 출처'라고 보고하면 그 회의는 끝난다"*
//   실데이터(완료 71건 집계): blog.naver.com 1,193 · namu.wiki 120 · gall.dcinside.com 47 ·
//   theqoo.net 14 · instiz 14 — **커뮤니티·위키가 nytimes.com·자사 사이트와 똑같은 알약**으로
//   나열됐다. 출처의 성격이 안 보이니 "우리가 관리 못 하는 곳이 우리를 설명한다"는
//   불안만 남고, **무엇을 해야 하는지**는 안 보인다.
//   → 지우지 않는다(진실거울의 증거다). **분류해서 보여준다** — 성격이 보이면
//     "여기는 손댈 수 있다/없다"가 판단되고, 이게 곧 처방으로 이어진다.
type SourceTier = "owned" | "media" | "community" | "other";

const WWW_PREFIX = /^www\./;

function classifySource(domain: string, brandDomain: string): SourceTier {
  const d = domain.toLowerCase();
  const brand = brandDomain.toLowerCase().replace(WWW_PREFIX, "");
  if (brand && d.includes(brand)) {
    return "owned";
  }
  // 커뮤니티·UGC·위키 — 우리가 직접 통제할 수 없고, 사내 공유 시 신뢰를 깎는 출처.
  const community = [
    "namu.wiki",
    "thewiki.kr",
    "dcinside.com",
    "theqoo.net",
    "instiz.net",
    "clien.net",
    "blog.naver.com",
    "cafe.naver.com",
    "tistory.com",
    "brunch.co.kr",
    "reddit.com",
    "youtube.com",
    "quora.com",
    "velog.io",
    "blog.me",
  ];
  if (community.some((c) => d.includes(c))) {
    return "community";
  }
  // 뉴스·매체 — 제3자 검증 출처(가장 신뢰도 높음).
  const media = [
    "news.",
    "nytimes.com",
    "businessinsider.com",
    "mashable.com",
    "pcworld.com",
    "searchengineland.com",
    ".co.kr/news",
    "topstarnews",
    "newsinstar",
    "v.daum.net",
    "gqkorea",
    "mobiinside",
  ];
  if (media.some((m) => d.includes(m))) {
    return "media";
  }
  return "other";
}

const TIER_STYLE: Record<SourceTier, { border: string; text: string }> = {
  owned: { border: "border-sky-500/30", text: "text-sky-300" },
  media: { border: "border-emerald-500/30", text: "text-emerald-300" },
  // ⚠️ 커뮤니티에 **빨강을 쓰지 않는다** — GSC 안티패닉 규율(저점=실패 통보 금지).
  //   "관리 밖"은 결함이 아니라 상태이고, 실제로 AI 인용의 다수를 차지한다.
  community: { border: "border-amber-500/30", text: "text-amber-300" },
  other: { border: "border-white/15", text: "text-zinc-400" },
};

function tierLabel(tier: SourceTier, isKo: boolean): string {
  if (tier === "owned") {
    return isKo ? "자사" : "Owned";
  }
  if (tier === "media") {
    return isKo ? "매체" : "Media";
  }
  if (tier === "community") {
    return isKo ? "커뮤니티·위키" : "Community";
  }
  return isKo ? "기타" : "Other";
}

function CitationSourcesPanel({
  result,
  isKo,
}: {
  result: JobResult;
  isKo: boolean;
}) {
  const total = result.metrics.topCitedDomains.reduce(
    (sum, d) => sum + d.count,
    0
  );
  const communityPct =
    total > 0
      ? Math.round(
          (result.metrics.topCitedDomains
            .filter(
              (d) =>
                classifySource(d.domain, result.domain ?? "") === "community"
            )
            .reduce((sum, d) => sum + d.count, 0) /
            total) *
            100
        )
      : 0;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 font-medium text-xs text-zinc-400">
        {isKo ? "주요 인용 출처" : "Top Cited Domains"}
      </div>
      {/* 🔴 S7-2차(2026-08-11) — 칩마다 색과 등급(자사·매체·커뮤니티)이 붙는데
          **그게 무슨 뜻인지 화면에 없었다**. 페이지 마지막 데이터 블록이라
          고객은 판단 근거 없이 끝을 본다. → 등급을 **"내가 고칠 수 있나"** 축으로 푼다
          (분류 자체가 그 축이다 · `classifySource`). 색만으로 구분하지 않는다(색맹 대비). */}
      <p className="mb-3 max-w-2xl text-[11px] text-zinc-400 leading-relaxed">
        {isKo
          ? "자사 = 우리가 직접 고칠 수 있는 곳 · 매체 = 기고·보도로 늘릴 수 있는 곳 · 커뮤니티·위키 = 직접 못 고치는 곳"
          : "Owned = you can edit directly · Media = grow via coverage and contributions · Community/Wiki = not directly editable"}
      </p>
      {/* 숫자를 "그래서 뭐" 없이 두지 않는다 — 커뮤니티 비중이 높으면 그게 곧 할 일이다. */}
      {communityPct >= 40 && (
        <p className="mb-4 max-w-2xl text-xs text-zinc-400 leading-relaxed">
          {isKo
            ? `AI가 참고한 출처의 ${communityPct}%가 커뮤니티·위키예요. 우리가 직접 고칠 수 없는 자리라, 매체 기고·보도자료처럼 관리 가능한 출처를 늘리는 게 다음 할 일이에요.`
            : `${communityPct}% of cited sources are community or wiki pages — places you can't edit directly. Growing owned and earned media coverage is the next move.`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {result.metrics.topCitedDomains.map((d, i) => {
          const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
          const tier = classifySource(d.domain, result.domain ?? "");
          const style = TIER_STYLE[tier];
          return (
            <motion.a
              animate={{ opacity: 1, y: 0 }}
              className={`group inline-flex items-center gap-2 rounded-full border bg-zinc-900/60 px-3 py-1.5 text-xs backdrop-blur-sm transition-all hover:-translate-y-0.5 ${style.border}`}
              href={`https://${d.domain}`}
              initial={{ opacity: 0, y: 8 }}
              key={d.domain}
              rel="noopener noreferrer"
              target="_blank"
              transition={{ delay: i * 0.04 }}
            >
              <img
                alt=""
                className="h-3.5 w-3.5 rounded-sm"
                src={`https://www.google.com/s2/favicons?domain=${d.domain}&sz=32`}
              />
              {/* 도메인은 번역되면 안 된다 — 기획서 §9-2(d) `translate="no"`(감사 9번) */}
              <span className="font-mono text-zinc-300" translate="no">
                {d.domain}
              </span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-zinc-400 tabular-nums">
                {pct}%
              </span>
              <span className={`text-[10px] ${style.text}`}>
                {tierLabel(tier, isKo)}
              </span>
            </motion.a>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// 캐시 투명성 (세션L) — "언제 측정한 결과인지" 밝히기
// ──────────────────────────────────────────────────────────────────

const FRESH_THRESHOLD_MIN = 10; // 이보다 최근이면 "방금" — 배너를 띄우지 않는다
const MIN_PER_HOUR = 60;
// 도메인 캐시 창(24h)과 같은 값이다 — 이 시간을 넘긴 결과는 "일 단위"로 표기하고
// 캐시 설명("24시간 동안 함께 써요")을 붙이지 않는다(문장이 스스로를 반박하기 때문).
const HOURS_PER_DAY = 24;

/**
 * 측정 시각 안내 + 재측정 경로.
 *
 * 📕 근거: docs/_적용/무료진단_어뷰징_원가방어_리서치_2026-07-31.md §5(a)
 *   도메인 캐시(24h)를 켠 뒤 필요한 짝. 업계(Mozilla Observatory·SSL Labs·PageSpeed)는
 *   캐시를 **숨기지 않고** 측정 시각을 보여주고 재측정 경로를 준다.
 *   숨기면 "사이트를 고쳤는데 점수가 왜 그대로냐"는 버그 오해가 되고,
 *   밝히면 즉시 응답이 오히려 장점으로 읽힌다.
 *
 * ⚠️ 방금 측정(10분 이내)엔 렌더하지 않는다 — "0분 전 측정"은 잡음이다.
 */
function MeasuredAtNotice({ job, isKo }: { isKo: boolean; job: JobResponse }) {
  const measuredIso = job.completedAt ?? job.createdAt;
  if (!measuredIso) {
    return null;
  }
  const measuredMs = new Date(measuredIso).getTime();
  if (Number.isNaN(measuredMs)) {
    return null;
  }
  const elapsedMin = Math.floor((Date.now() - measuredMs) / 60_000);
  if (elapsedMin < FRESH_THRESHOLD_MIN) {
    return null; // 방금 측정 — 안내 불필요
  }
  const hours = Math.floor(elapsedMin / MIN_PER_HOUR);
  // 🔴 2026-08-11 (세션N-17) — 두 가지를 고친다.
  //   ① **일 단위 롤오버가 없었다**: 214시간(=8.9일) 을 "214시간 전"으로 찍었다.
  //   ② 그 문장이 **스스로를 반박했다**: "214시간 전 측정 + 같은 도메인은 24시간 동안
  //      이 결과를 함께 써요" → 24시간 캐시라면 190시간 전에 만료됐어야 한다.
  //      캐시 창을 넘긴 결과에는 캐시 설명을 붙이지 않고 **"달라졌을 수 있다"**고 말한다.
  const isStale = hours >= HOURS_PER_DAY;
  const ago = (() => {
    if (hours < 1) {
      return isKo ? `${elapsedMin}분 전` : `${elapsedMin} min ago`;
    }
    if (isStale) {
      const days = Math.floor(hours / HOURS_PER_DAY);
      return isKo ? `${days}일 전` : `${days} day${days > 1 ? "s" : ""} ago`;
    }
    if (isKo) {
      return `${hours}시간 전`;
    }
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  })();

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-sm text-zinc-400">
        {isKo ? (
          <>
            <span className="text-zinc-200">{ago}</span> 측정한 결과예요.{" "}
            {isStale
              ? "그동안 AI 답변이 달라졌을 수 있어요."
              : "같은 도메인은 24시간 동안 이 결과를 함께 써요."}
          </>
        ) : (
          <>
            Measured <span className="text-zinc-200">{ago}</span>.{" "}
            {isStale
              ? "AI answers may have changed since then."
              : "The same domain shares this result for 24 hours."}
          </>
        )}
      </p>
      {/* ⚠️ 여기를 www /audit 로 보내면 안 된다 — 도메인 캐시가 같은 결과를 돌려주므로
          "다시 측정" 버튼이 아무 일도 안 하는 것처럼 보인다(죽은 버튼).
          지금 즉시 재측정은 로그인 워크스페이스의 기능이라 app 으로 보낸다. */}
      <a
        className="shrink-0 text-[var(--brand-3)] text-sm underline decoration-[var(--brand-3)]/30 hover:decoration-[var(--brand-3)]"
        href={`${appUrl}/sign-up`}
      >
        {/* 🔴 2026-08-11 (세션N-17) — 링크는 app /sign-up 인데 라벨이 재측정처럼 읽혔다.
            9일 지난 결과를 보고 "다시 재보자"고 누른 고객이 예고 없이 가입 폼을 만났다.
            목적지는 유지(아래 주석의 이유) 하고 **대가를 라벨에 밝힌다**. */}
        {isKo ? "지금 다시 측정 (가입 필요)" : "Measure again (sign-up)"}
      </a>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Engine Gap CTA (세션L 장치 C) — 약점 앵커
// ──────────────────────────────────────────────────────────────────

/**
 * 사용자가 "어느 엔진이 우리를 모르는지" 본 직후에 놓는 인라인 CTA.
 *
 * 기존 문제: 가입 CTA가 2,400줄 리포트 **맨 아래** 카드 하나뿐이라, 관심이 가장
 *   뜨거운 순간에는 화면에 없었다(세션L L-2 진단).
 *
 * 원칙: 실측 엔진 이름을 그대로 박는다("Perplexity·Gemini가 아직 모릅니다").
 *   일반론이면 광고로 읽히고, 내 데이터면 진단으로 읽힌다.
 *   격차가 0이면(전 엔진 인지) 이 카드는 렌더하지 않는다 — 없는 문제를 팔지 않는다.
 */
function EngineGapCta({ result, isKo }: { isKo: boolean; result: JobResult }) {
  const mentioned = new Set(result.metrics.enginesWithMention);
  // 측정 성공 엔진만 대상(스텁·에러 엔진은 "모른다"고 말할 근거가 없다).
  const measured = result.engineResponses.filter(
    (r) => !(r.isStub || r.errorMessage)
  );
  const missing = dedupeByEngine(measured).filter(
    (r) => !mentioned.has(r.engineId)
  );
  if (missing.length === 0) {
    return null;
  }
  const names = missing.map((r) => ENGINE_LABELS[r.engineId] ?? r.engineId);
  const shown = names.slice(0, 3).join(" · ");
  const extra = names.length > 3 ? names.length - 3 : 0;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr";

  return (
    <SpotlightCard border="brand" className="p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-base text-zinc-50 leading-snug">
            {isKo
              ? // 조사 판정은 packages/audit 의 공용 헬퍼 사용("나이키을" 같은 오표기 방지).
                `${shown}${extra > 0 ? ` 외 ${extra}개` : ""}가 아직 ${result.brandName}${objectParticle(result.brandName)} 모릅니다`
              : `${shown}${extra > 0 ? ` +${extra} more` : ""} ${names.length > 1 ? "don't" : "doesn't"} know ${result.brandName} yet`}
          </p>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "이 격차가 좁혀지는지는 다음 측정과 비교해야 알 수 있어요. 무료 계정을 만들면 이 결과가 기준점으로 남아요."
              : "Whether this gap closes only shows up against your next run. A free account keeps this as your baseline."}
          </p>
        </div>
        <Button asChild className="shrink-0" size="sm">
          <a href={`${appUrl}/sign-up`}>
            {isKo ? "기준점 저장하기" : "Save as baseline"}
          </a>
        </Button>
      </div>
    </SpotlightCard>
  );
}

// ──────────────────────────────────────────────────────────────────
// Action Teaser (세션L 장치 D) — 처방 1건 전부 공개 + 나머지 건수
// ──────────────────────────────────────────────────────────────────

/**
 * 세션K-2 액션 레이어(packages/audit/actions.ts)를 무료 결과에 노출한다.
 *
 * 전략(사용자 확정 2026-07-31): **1건은 전부 공개**하고 나머지는 **건수만** 표시.
 *   - 가리지 않는 이유: 리서치가 무료 체커의 결과 게이팅에 반대(옆 도구로 이탈).
 *   - 1건을 통째로 주는 이유: 처방 품질을 먼저 증명해야 나머지에 값이 생긴다(샘플링).
 *   - 원가: result.geoActions 는 러너가 이미 적재한 값 → 추가 AI 호출·비용 0.
 *
 * ⚠️ "하지 말 것"(kind='avoid') 액션은 티저로 쓰지 않는다. 첫인상이 금지사항이면
 *    처방의 가치가 전달되지 않으므로, 실행형 액션을 우선 고른다.
 */
/**
 * 처방 1건 = 접힌 카드. 눌러야 `how`(실행 방법)가 열린다.
 *
 * 🔴 접기는 **밀도** 때문이지 **잠금이 아니다** — 내용은 전부 여기 있고 클릭 한 번이면 열린다.
 *   (같은 세션 D 작업의 진실거울 접기와 동일 원칙: 삭제·요약 아닌 접기.)
 * `<details>` 를 쓰는 이유: JS 상태 없이 동작하고 **브라우저 검색(Ctrl+F)·스크린리더가
 *   접힌 내용도 찾는다**. 접근성 기본값이 가장 좋은 요소다.
 */
function ActionDetails({
  action,
  index,
  isKo,
}: {
  action: GeoActionView;
  index: number;
  isKo: boolean;
}) {
  const isAvoid = action.kind === "avoid";
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold text-[11px] tabular-nums ${
            isAvoid
              ? "bg-white/10 text-zinc-400"
              : "bg-[var(--brand-3)]/15 text-[var(--brand-3)]"
          }`}
        >
          {isAvoid ? "!" : index}
        </div>
        <h4 className="min-w-0 flex-1 font-medium text-sm text-zinc-100 leading-snug">
          {action.title}
        </h4>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-white/5 border-t px-4 pt-4 pb-4">
        {/* 🔴 `how` 는 마크다운 `**강조**` 를 포함한다 — 파서가 없으므로 그대로 그리면
            별표가 글자로 보인다(라이브 실측). 표시 직전 단일 통로인 stripMarkdown 으로 푼다. */}
        <p className="whitespace-pre-line text-sm text-zinc-300 leading-relaxed">
          {stripMarkdown(action.how)}
        </p>
        {action.evidence && (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="mb-1.5 font-medium text-[11px] text-zinc-400">
              {isKo ? "이 처방이 나온 근거 (실측)" : "Evidence (measured)"}
            </div>
            <p className="whitespace-pre-line text-sm text-zinc-400 leading-relaxed">
              {stripMarkdown(action.evidence)}
            </p>
          </div>
        )}
        {action.source && (
          <p className="mt-3 text-xs text-zinc-400">{action.source}</p>
        )}
      </div>
    </details>
  );
}

function ActionTeaser({
  result,
  isKo,
  locale,
}: {
  isKo: boolean;
  locale: string;
  result: JobResult;
}) {
  const actions = result.geoActions ?? [];
  if (actions.length === 0) {
    return null;
  }
  // 우선순위 desc(3=지금 당장) → 실행형이 먼저.
  // ⚠️ avoid("하지 마세요")를 **선두로 쓰지 않는다** — 시뮬레이션에서 이미 1순위 브랜드가
  //   "방어가 낫습니다 / 나머지 0건"만 뜨는 빈 카드가 나왔다. 팔 게 없으면 안 띄운다.
  const actionable = actions.filter((a) => a.kind !== "avoid");
  const lead = [...actionable].sort((a, b) => b.priority - a.priority)[0];
  if (!lead) {
    return null;
  }

  // 🔴 2026-08-10 세션N-16 — **처방을 잠그지 않는다.**
  //
  // 지금까지는 1건만 보여주고 나머지를 `app/sign-up` 뒤로 잠갔다. 그런데 리서치가
  // **12개 도구 리뷰어의 독립 반복 지적**으로 확인한 이 카테고리의 최대 공백이
  // 바로 *"측정은 잘하는데 무엇을 해야 할지는 안 알려준다"* 이고, 사용자 반응 원문도
  // *"이걸 어떻게 고치는지 더 알고 싶다"* 였다(📕`_리서치원본…/06:176`·`01번`).
  // → **우리가 이기는 유일한 지점을 우리 손으로 80% 잠가둔 상태**였다.
  //
  // 🔒 유료 축은 안 무너진다: 리서치가 경고한 가치 역전의 원인은
  //   *"무료가 **반복 확인할 이유**까지 주는 것"*(Docker형)인데, **처방은 1회성 aha 라
  //   반복 이유가 아니다.** 반복 이유(=유료 축)는 **시간·비교·알림**이고 그대로 둔다.
  //   📕`05번` "가치 역전 진짜 원인" · `투두리스트` 흔들리면 안 되는 축.
  //
  // 밀도는 **접기**로 관리한다(같은 세션 D 작업과 동일 원칙): 1건은 펼치고 나머지는 접는다.
  const rest = [...actionable].sort((a, b) => b.priority - a.priority).slice(1);
  // "하지 마세요"는 맨 뒤에 둔다 — 할 일을 먼저 읽고 나서 피할 것을 읽는 순서.
  const avoid = actions.filter((a) => a.kind === "avoid");
  const restAll = [...rest, ...avoid];

  return (
    <section>
      {/* 🔴 S7-c(2026-08-11) — 예전 조판: `font-medium text-xs text-zinc-400`.
          **우리가 유일하게 이기는 섹션**("측정만 하고 처방이 없다"는 업계 1위 불만을
          해소하는 자리)이 페이지에서 **가장 약한 글자**였다. 바로 위 진실의 거울은
          `text-2xl md:text-3xl` 이라 위계가 거꾸로였다(Apple Craft·NN/g 8).
          → 섹션 제목다운 크기로 올린다. */}
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-xl text-zinc-100 md:text-2xl">
        {isKo ? "그래서 뭘 하면 되나" : "What to actually do"}
      </h2>
      {/* §A-7: 액션이 4곳에 흩어져 관계가 안 보였다 — 이 섹션의 출처를 명시.
          🔴 S7-c — 예전 문구의 **"다른 층"** 은 내부 용어였다(NN/g 2). 고객은 "층"이
          무슨 뜻인지 모른다. 두 묶음이 **무엇으로 갈리는지**를 그대로 말한다. */}
      <p className="mb-5 text-sm text-zinc-400">
        {isKo
          ? "위 측정 숫자가 바로 가리키는 처방이에요. 아래 'AI 분석팀' 제안은 AI가 따로 검토해 제안한 것이라 근거가 달라요."
          : "Prescriptions derived directly from the measurement above. The AI analyst suggestions below come from a separate review, so their basis differs."}
      </p>
      <SpotlightCard className="p-6 md:p-8">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-3)]/15 font-semibold text-[11px] text-[var(--brand-3)] tabular-nums">
            1
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base text-zinc-50 leading-snug md:text-lg">
              {lead.title}
            </h3>
            <p className="mt-3 whitespace-pre-line text-sm text-zinc-300 leading-relaxed">
              {stripMarkdown(lead.how)}
            </p>
            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="mb-1.5 font-medium text-[11px] text-zinc-400">
                {isKo ? "이 처방이 나온 근거 (실측)" : "Evidence (measured)"}
              </div>
              <p className="whitespace-pre-line text-sm text-zinc-400 leading-relaxed">
                {stripMarkdown(lead.evidence)}
              </p>
            </div>
            {lead.source && (
              <p className="mt-3 text-xs text-zinc-400">{lead.source}</p>
            )}
          </div>
        </div>

        {restAll.length > 0 && (
          <div className="mt-6 border-white/10 border-t pt-5">
            <p className="mb-3 font-medium text-xs text-zinc-400">
              {isKo
                ? `남은 처방 ${restAll.length}건 — 각각 눌러서 실행 방법을 보세요`
                : `${restAll.length} more prescriptions — open each for the how-to`}
            </p>
            <div className="flex flex-col gap-2">
              {restAll.map((action, index) => (
                <ActionDetails
                  action={action}
                  index={index + 2}
                  isKo={isKo}
                  key={action.title}
                />
              ))}
            </div>
          </div>
        )}
      </SpotlightCard>
      <p className="mt-3 text-xs text-zinc-400">
        {isKo ? (
          <>
            처방은 Princeton GEO 논문(arXiv 2311.09735) 실측 근거로 만들어요.{" "}
            <a
              className="underline decoration-white/20 hover:text-zinc-300"
              href={`/${locale}/contact`}
            >
              적용 대행 문의
            </a>
          </>
        ) : (
          <>
            Prescriptions are grounded in the Princeton GEO paper (arXiv
            2311.09735).{" "}
            <a
              className="underline decoration-white/20 hover:text-zinc-300"
              href={`/${locale}/contact`}
            >
              Ask about done-for-you
            </a>
          </>
        )}
      </p>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Upsell
// ──────────────────────────────────────────────────────────────────

/**
 * 업셀 카피 — 인지 상태 3분기(전무/일부/전부)로 각각 성립하는 문장을 만든다.
 *
 * 전수감사 §A-4: "8개 엔진 중 8개가 늘어나는지 줄어드는지" — 전 엔진 인지(8/8)일 때
 * 문장이 성립하지 않았다. 0개일 때는 "오르는 중인지"가 무의미(부재의 문제).
 * 파는 것은 항상 "시간"(다음 측정과의 비교)이고, 상태별로 그 프레임만 바꾼다.
 */
function buildUpsellCopy({
  isKo,
  brandName,
  sov,
  mentionedCount,
  measuredCount,
  isSharedView,
}: {
  isKo: boolean;
  brandName: string;
  sov: number;
  mentionedCount: number;
  measuredCount: number;
  isSharedView: boolean;
}): { headline: string; bodyCopy: string } {
  const isInvisible = mentionedCount === 0;
  const isFullCoverage = !isInvisible && mentionedCount === measuredCount;

  // 🔴 공유받은 사람용 카피 (2026-08-07 세션N-8, 감사 D7 리드젠)
  //   기존 카피는 전부 **소유자**를 향해 있었다 — *"이 진단을 이어서 보세요"*.
  //   그런데 링크를 받은 제3자는 **남의 진단**을 보고 있다. 그 사람에게 필요한 건
  //   "이어보기"가 아니라 **"우리 회사는 어떤지 재보기"** 다.
  //   리서치: AthenaHQ 공개 공유링크가 **리드젠 아티팩트로 기능**(01:353) ·
  //   Semrush·Ahrefs 무료 체커도 전부 **로그인 없는 공개 도구**로 리드를 받는다(01:201·234).
  //   ⚠️ 우리 무료진단은 **이미 비로그인 공개 + 카톡 공유 + OG 이미지**를 갖췄다.
  //   빠져 있던 건 "받은 사람을 향한 문장" 하나뿐이라, 여기서만 갈라준다
  //   (대시보드에 공유링크를 새로 뚫으면 DB 컬럼·공개 라우트·토큰 폐기 UI가 필요한데,
  //    리드젠 효과는 이미 퍼지고 있는 이 페이지가 같거나 더 크다).
  if (isSharedView) {
    if (isKo) {
      return {
        headline: `${brandName}의 AI 검색 성적표예요 — 우리 브랜드는 어떨까요?`,
        bodyCopy: `이 진단은 ChatGPT·Perplexity·네이버 등 AI ${measuredCount}곳에 실제로 물어본 결과예요. 도메인만 넣으면 3분 만에 같은 진단을 받아보실 수 있어요. 무료이고 카드도 필요 없어요.`,
      };
    }
    return {
      headline: `This is ${brandName}'s AI search scorecard — how does yours look?`,
      bodyCopy: `We asked ${measuredCount} AI engines about this brand and measured what they said. Enter your domain to get the same audit in about 3 minutes — free, no card required.`,
    };
  }

  if (isKo) {
    if (isInvisible) {
      return {
        headline: `지금 ${brandName}${objectParticle(brandName)} 아는 AI는 ${measuredCount}곳 중 0곳이에요`,
        bodyCopy:
          "지금은 기준점이 0이에요. 개선 작업을 한 뒤 다시 측정하면 올라갔는지 알 수 있어요. 무료 계정을 만들면 이 결과가 그 기준점으로 남아요.",
      };
    }
    const headline = `오늘 ${brandName}의 AI 점유율은 ${sov}%예요 — 문제는 이게 어제보다 나은지 모른다는 거예요`;
    return {
      headline,
      bodyCopy: isFullCoverage
        ? `지금은 측정한 AI ${measuredCount}곳 모두가 우리를 알아봐요. 관건은 이 상태가 유지되는지, 경쟁사가 치고 올라오는지예요 — 그건 다음 측정과 비교해야 보여요. 무료 계정을 만들면 오늘 결과가 비교 기준점으로 남아요.`
        : `지금은 AI ${measuredCount}곳 중 ${mentionedCount}곳만 우리를 알아봐요. 이 숫자가 늘고 있는지 줄고 있는지는 다음 측정과 비교해야 보여요. 무료 계정을 만들면 오늘 결과가 대시보드에 남아 다음 측정과 이어져요.`,
    };
  }

  if (isInvisible) {
    return {
      headline: `0 of ${measuredCount} AI engines know ${brandName} today`,
      bodyCopy:
        "Your baseline is zero. You'll only know if the fixes worked by measuring again. A free account keeps this as that baseline.",
    };
  }
  return {
    headline: `${brandName}'s AI share is ${sov}% today — the problem is you can't tell if that's better than yesterday`,
    bodyCopy: isFullCoverage
      ? `All ${measuredCount} measured engines recognize your brand today. The question is whether that holds — and whether competitors are gaining. Only your next run can tell. A free account keeps today as your baseline.`
      : `${mentionedCount} of ${measuredCount} engines recognize your brand today. Whether that number is growing only shows against your next run. A free account keeps this result on your dashboard.`,
  };
}

function UpsellCard({
  locale,
  isKo,
  job,
  result,
}: {
  isKo: boolean;
  job: JobResponse;
  locale: string;
  result: JobResult;
}) {
  // 🔴 전환 루프 완결(2026-07-30 플로우 감사): 예전엔 상담 CTA만 있어 무료진단→계정 생성
  //   동선이 코드상 존재하지 않았다. 1차 CTA = 무료 가입(PLG), 2차 = 상담.
  //   NEXT_PUBLIC_* 리터럴 참조는 빌드 시 인라인되므로 클라 컴포넌트에서 안전.
  //
  // 🟠 세션L L-1 재설계 — "무료는 로그인 없이, 가입은 유도로". 리서치(측정정확도_전면진단
  //   §3)가 로그인 강제를 반대한다: HubSpot "No Account Required" · Semrush 비로그인 3회/일 ·
  //   Geoptie "no account, no credit card". 무료 체커는 흔해서 결과를 가리면 옆 도구로 간다.
  //   → 결과는 계속 전부 공개하고, 파는 것은 **정보량이 아니라 시간**.
  //   Geoptie 결과 하단 원문: "이건 live snapshot입니다. 시간에 따른 추적은 대시보드로."
  //
  //   장치 A(소유권): 이 진단에 쓴 이메일을 prefill + "같은 주소로 가입해야 이어진다" 명시.
  //     ⚠️ 근거: app 대시보드는 AuditJob.email 로 내 측정을 찾는다(app page.tsx identifiers).
  //     즉 다른 주소로 가입하면 이 결과가 조용히 사라진다 — 그걸 막는 게 이 장치의 목적.
  //   장치 B(시점 vs 추세): 1회 측정으로는 **원리상** 알 수 없는 것(오르는지/내리는지)을 판다.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.findable.co.kr";
  // 🔒 **1차 방어는 서버다**(세션N-26) — `/api/audit/[jobId]` 가 소유자에게만
  //   `emailMasked` 를 넣어준다. 즉 제3자에게는 이 값이 **애초에 오지 않는다**.
  //   ⚠️ 아래 `?shared=1` 검사는 그걸 대체하는 게 아니라 **덧대는 것**이다:
  //      소유자가 본인 링크를 공유 버튼으로 보낸 경우, 받은 사람이 로그인 상태로
  //      우연히 소유자와 같은 계정이 아닌 한 서버가 이미 막지만, 소유자 본인이
  //      자기 화면을 캡처해 공유하는 상황까지 고려해 표기를 한 번 더 접는다.
  //   ⚠️ 렌더 중 window 를 읽으면 하이드레이션 불일치가 나므로 effect 로 읽는다.
  //   초기값 true(=숨김) — 판별 전 한 프레임이라도 노출되는 쪽이 위험하다(안전한 기본값).
  const [isSharedView, setIsSharedView] = useState(true);
  useEffect(() => {
    setIsSharedView(
      new URLSearchParams(window.location.search).get("shared") === "1"
    );
  }, []);
  const email = isSharedView ? null : (job.emailMasked ?? null);
  // Clerk sign-up 은 email_address_field 프리필을 쿼리로 받는다. 마스킹 값이 아니라
  // 실주소가 필요하므로 여기선 prefill 을 걸지 않고, 대신 "어떤 주소로" 가입해야 하는지
  // 화면에 명시한다(마스킹 노출 원칙 유지). 사용자가 직접 입력 → 오연결 위험 제거.
  const sov = Math.round(result.metrics.sov);
  const mentionedCount = new Set(result.metrics.enginesWithMention).size;
  // 🔴 세션N-28 — 여기도 분모를 직접 셌다(`enginesCovered` 고유화 = 오류·stub 안 뺌).
  //   이번 회차엔 우연히 같은 값이 나왔지만, 전부 실패한 엔진이 섞이면 업셀 카피가
  //   "AI 8곳 중 7곳"처럼 **재보지도 못한 엔진을 분모에 넣는다**.
  //   `isFullCoverage` 판정(= 전 엔진 인지)도 이 값으로 갈리므로 문장이 뒤집힌다.
  const measuredCount = countMeasurementCoverage(
    result.engineResponses
  ).measured;

  const { headline, bodyCopy } = buildUpsellCopy({
    isKo,
    brandName: result.brandName,
    sov,
    mentionedCount,
    measuredCount,
    isSharedView,
  });

  // 공유받은 사람 ↔ 소유자로 CTA가 갈린다(위 buildUpsellCopy 주석 참조).
  //   중첩 삼항을 JSX 안에 쓰면 lint(noNestedTernary)에 걸리고 읽기도 어렵다 → 여기서 평평하게.
  const ctaVariant = isSharedView ? "shared" : "owner";
  const primaryCtaLabel = {
    shared: isKo ? "우리 브랜드 무료 진단" : "Audit my brand · Free",
    owner: isKo ? "무료 계정 만들고 추세 보기" : "Create free account",
  }[ctaVariant];
  const ctaFootnote = {
    shared: isKo
      ? "도메인만 넣으면 돼요. 가입도, 카드도 필요 없어요."
      : "Just your domain — no signup, no card.",
    owner: isKo
      ? "무료 계정은 카드를 등록하지 않아도 돼요. 자동 재측정과 경쟁사 추적은 유료 플랜이에요."
      : "No credit card required. Auto re-measurement and competitor tracking are paid plans.",
  }[ctaVariant];

  return (
    <SpotlightCard border="brand" className="p-6 md:p-10">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-medium text-[11px] text-zinc-400">
        {isKo ? "지금 보신 건 오늘 하루의 스냅샷" : "This is today's snapshot"}
      </div>
      <h3 className="mt-4 font-bold text-xl text-zinc-50 md:text-2xl">
        {headline}
      </h3>
      <p className="mt-3 max-w-2xl text-sm text-zinc-400 leading-relaxed">
        {bodyCopy}
      </p>

      {/* 장치 A — 결과 소유권 연결. 이 안내가 없으면 다른 이메일로 가입해 결과를 잃는다. */}
      {email && (
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-[var(--brand-3)]/25 bg-[var(--brand-3)]/5 p-4">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-3)]" />
          <p className="text-sm text-zinc-300 leading-relaxed">
            {isKo ? (
              <>
                이 결과는{" "}
                <span className="font-mono font-semibold text-zinc-100">
                  {email}
                </span>{" "}
                에 연결돼 있습니다.{" "}
                <span className="font-semibold text-zinc-100">
                  같은 주소로 가입하셔야
                </span>{" "}
                대시보드에서 이 진단을 이어서 보실 수 있습니다.
              </>
            ) : (
              <>
                This result is tied to{" "}
                <span className="font-mono font-semibold text-zinc-100">
                  {email}
                </span>
                .{" "}
                <span className="font-semibold text-zinc-100">
                  Sign up with that same address
                </span>{" "}
                to keep this audit on your dashboard.
              </>
            )}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {/* 공유받은 사람의 주 행동은 **가입**이 아니라 "내 브랜드 진단"이다.
            남의 결과를 보러 온 사람에게 sign-up 을 첫 버튼으로 주면 이탈한다.
            리서치의 리드젠 사례(Semrush·Ahrefs 무료 체커)가 전부 **가입 없이 바로 측정**이다. */}
        <Button asChild className="gap-2" size="lg">
          <a href={isSharedView ? `/${locale}/audit` : `${appUrl}/sign-up`}>
            <Zap className="h-4 w-4" />
            {primaryCtaLabel}
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href={`/${locale}/contact`}>
            {isKo ? "전문가 상담 예약" : "Talk to an expert"}
          </a>
        </Button>
      </div>
      <p className="mt-4 text-xs text-zinc-400">{ctaFootnote}</p>
    </SpotlightCard>
  );
}

function dedupeByEngine<T extends { engineId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const r of rows) {
    if (seen.has(r.engineId)) {
      continue;
    }
    seen.add(r.engineId);
    result.push(r);
  }
  return result;
}
