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
//   9. 메타 라벨 영문+monospace+uppercase tracking 0.18em
//  10. 한국어 본문 line-height 1.7, 본문 단색 zinc

import { analytics } from "@repo/analytics";
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
import { CopilotChat } from "./copilot-chat";
import { NaverVsAiGap } from "./naver-vs-ai-gap";

interface Props {
  jobId: string;
  locale: string;
}

// ──────────────────────────────────────────────────────────────────
// 타입 (orchestrator AnalystOutput·StrategistOutput과 일치)
// ──────────────────────────────────────────────────────────────────

type Severity = "red" | "amber" | "green";
type CrewStatus = "not_requested" | "queued" | "processing" | "completed" | "failed";
type BriefingStatus = "not_requested" | "processing" | "completed" | "failed";

interface Finding {
  title: string;
  whyItMatters: string;
  detail: string;
  severity: Severity;
}
interface AnalystOutput {
  executiveSummary: string;
  findings: Finding[];
  observation: string;
  dataGaps: string[];
}
interface ActionItem {
  rank: number;
  title: string;
  princetonStrategy: string;
  rationale: string;
  steps: string[];
  impact: number;
  effort: number;
  expectedTimeframe: string;
  channel: string;
}
interface StrategistOutput {
  mondayActionOne: { title: string; whyThisOne: string; expectedOutcome: string };
  topActions: ActionItem[];
  executiveSummary: string;
}
interface AnalystReport {
  agentId: "minji" | "alex" | "sujin";
  displayName: string;
  role: string;
  emoji: string;
  output: AnalystOutput | null;
  rawText: string | null;
  durationMs: number;
  errorMessage: string | null;
}
interface StrategistReport {
  agentId: "junho";
  displayName: string;
  role: string;
  emoji: string;
  output: StrategistOutput | null;
  rawText: string | null;
  durationMs: number;
  errorMessage: string | null;
}
interface CrewReport {
  analysts?: AnalystReport[]; // 신 구조 (재설계 후)
  strategist?: StrategistReport; // 신 구조
  reports?: unknown[]; // 옛 구조 호환 (구 jobId)
  totalDurationMs: number;
  isStub: boolean;
}
interface JobMetrics {
  enginesCovered: string[];
  enginesWithMention: string[];
  sov: number;
  averageMentionPosition: number | null;
  sentimentDistribution: { positive: number; neutral: number; negative: number };
  topCitedDomains: Array<{ domain: string; count: number }>;
  errors: Array<{ engineId: string; message: string }>;
  stubCount: number;
}
interface JobResult {
  brandName: string;
  domain: string;
  promptsCount: number;
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
  metrics: JobMetrics;
  topRecommendations: string[];
  briefingStatus?: BriefingStatus;
}
interface JobResponse {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  domain: string;
  language: string;
  pdfUrl: string | null;
  result: JobResult | null;
  crewStatus: CrewStatus;
  crewResult: CrewReport | null;
  crewStartedAt: string | null;
  crewCompletedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
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
  owned_site: "자사 사이트",
  amazon: "Amazon",
  other: "기타",
};

// ──────────────────────────────────────────────────────────────────
// SoV 점수 → Severity (Lighthouse: 0.9 / 0.5 boundary, research 12)
// ──────────────────────────────────────────────────────────────────

function sovSeverity(sov: number): Severity {
  if (sov >= 70) return "green";
  if (sov >= 40) return "amber";
  return "red";
}

// HubSpot 4단계 라벨 (research 13)
function sovLabel(sov: number, isKo: boolean): string {
  if (isKo) {
    if (sov >= 76) return "리더";
    if (sov >= 51) return "경쟁 가능";
    if (sov >= 26) return "막 시작";
    return "AI에서 안 보임";
  }
  if (sov >= 76) return "Market Leader";
  if (sov >= 51) return "Competitive Position";
  if (sov >= 26) return "Emerging Presence";
  return "Critical Gap";
}

// ──────────────────────────────────────────────────────────────────
// 5축 점수 분해 (HubSpot 원본 가중치 — research 13 라인 24-32)
//   Sentiment 40 + Presence 20 + Recognition 20 + SoV 10 + Competition 10
// ──────────────────────────────────────────────────────────────────

interface AxisScore {
  key: "sentiment" | "presence" | "recognition" | "sov" | "competition";
  labelKo: string;
  labelEn: string;
  score: number;
  max: number;
  hint: string;
}

function fiveAxisScores(metrics: JobMetrics, isKo: boolean): AxisScore[] {
  const total =
    metrics.sentimentDistribution.positive +
    metrics.sentimentDistribution.neutral +
    metrics.sentimentDistribution.negative;
  // Sentiment: 긍정 비율 - 부정 비율 (정규화)
  const sentRatio =
    total === 0
      ? 0
      : (metrics.sentimentDistribution.positive - metrics.sentimentDistribution.negative) / total;
  const sentiment = Math.max(0, Math.min(40, Math.round((sentRatio + 1) * 20)));

  // Presence: 인용 도메인 다양성 (3rd-party 커버리지)
  const domainCount = metrics.topCitedDomains.length;
  const presence = Math.min(20, Math.round(domainCount * 4));

  // Recognition: 언급된 엔진 / 전체 엔진
  const enginesTotal = Math.max(metrics.enginesCovered.length, 1);
  const recognition = Math.round((metrics.enginesWithMention.length / enginesTotal) * 20);

  // SoV: 카테고리 점유 (전체 SoV의 1/10)
  const sovAxis = Math.round(metrics.sov / 10);

  // Competition: 평균 순위 역수 (1위=10, 5위=2, null=0)
  const avgPos = metrics.averageMentionPosition;
  const competition =
    avgPos === null ? 0 : Math.max(0, Math.min(10, Math.round(11 - avgPos * 2)));

  return [
    {
      key: "sentiment",
      labelKo: "감정 분석",
      labelEn: "Sentiment",
      score: sentiment,
      max: 40,
      hint: isKo ? "AI가 우리를 어떻게 묘사하는가" : "How AI describes you",
    },
    {
      key: "presence",
      labelKo: "노출 품질",
      labelEn: "Presence",
      score: presence,
      max: 20,
      hint: isKo ? "인용 출처가 얼마나 다양한가" : "3rd-party coverage diversity",
    },
    {
      key: "recognition",
      labelKo: "브랜드 인지",
      labelEn: "Recognition",
      score: recognition,
      max: 20,
      hint: isKo ? "우리를 아는 AI 비율" : "Does AI know you",
    },
    {
      key: "sov",
      labelKo: "점유율",
      labelEn: "Share of Voice",
      score: sovAxis,
      max: 10,
      hint: isKo ? "AI 답변 중 우리 비중" : "Category conversation share",
    },
    {
      key: "competition",
      labelKo: "경쟁 위치",
      labelEn: "Competition",
      score: competition,
      max: 10,
      hint: isKo ? "경쟁사 대비 등장 순서" : "Position vs competitors",
    },
  ];
}

function totalFiveAxis(axes: AxisScore[]): number {
  return axes.reduce((sum, a) => sum + a.score, 0);
}

// McKinsey Action Title — 데이터 → 한 문장 결론 (research 14)
function mckinseyHeadline(
  brandName: string,
  metrics: JobMetrics,
  isKo: boolean
): string {
  const mentioned = new Set(metrics.enginesWithMention).size;
  const total = new Set(metrics.enginesCovered).size;
  const stub = metrics.stubCount;
  const live = total - stub;
  const sov = metrics.sov;

  if (isKo) {
    if (sov >= 70 && mentioned >= live * 0.8) {
      return `${brandName}, 글로벌 AI ${live}개 엔진 중 ${Math.round(mentioned / Math.max(total, 1) * live)}곳에서 상위 인용. 한국 엔진 ${stub}개 측정 추가하면 완전한 가시성 확보.`;
    }
    if (sov >= 40) {
      return `${brandName}, AI 답변 절반 이상에서 누락. 이번 주 1건 액션으로 회복 가능합니다.`;
    }
    return `${brandName}, AI 검색에서 거의 보이지 않습니다. 즉시 조치가 필요합니다.`;
  }
  if (sov >= 70) return `${brandName} ranks top in ${mentioned}/${live} AI engines. Add Korean engines for full coverage.`;
  if (sov >= 40) return `${brandName} is missing in over half of AI answers. One action this week recovers SoV.`;
  return `${brandName} is nearly invisible in AI search. Immediate action required.`;
}

// ──────────────────────────────────────────────────────────────────
// 메인 진입점
// ──────────────────────────────────────────────────────────────────

export function AuditResultView({ jobId, locale }: Props) {
  const isKo = locale.startsWith("ko");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auditCapturedRef = useRef(false);
  // 폴링 루프 제어. 완료 후 멈춘 폴링을 on-demand 트리거(브리핑 등)가 재개할 수 있게
  // 실행 중인 타이머·취소 플래그를 ref로 들고 있는다.
  const pollControlRef = useRef<{
    active: boolean;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>({ active: false, timeoutId: null });

  const runPoll = useCallback(() => {
    const control = pollControlRef.current;
    // 이미 폴링 루프가 돌고 있으면 중복 기동하지 않는다.
    if (control.active) return;
    control.active = true;
    let consecutiveErrors = 0;
    // 백엔드 작업이 processing에 갇혀도(크래시·타임아웃 미처리) 무한 폴링하지 않도록
    // 경과 시간 상한을 둔다. briefing maxDuration 300s + 여유 = 7분.
    const startedAt = Date.now();
    const MAX_POLL_MS = 7 * 60 * 1000;

    async function poll() {
      try {
        const response = await fetch(`/api/audit/${jobId}`, { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        const data = (await response.json()) as JobResponse;
        if (!pollControlRef.current.active) return;
        consecutiveErrors = 0;
        setJob(data);

        // 첫 completed 도달 시점에 audit_started 이벤트 발화 (KPI 측정)
        if (
          !auditCapturedRef.current &&
          data.status === "completed" &&
          data.result
        ) {
          auditCapturedRef.current = true;
          analytics.capture("audit_started", {
            jobId,
            domain: data.domain,
            language: data.language,
            sov: data.result.metrics?.sov,
            enginesWithMention: new Set(
              data.result.metrics?.enginesWithMention ?? []
            ).size,
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
        if (!pollControlRef.current.active) return;
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
      if (control.timeoutId) clearTimeout(control.timeoutId);
    };
  }, [runPoll]);

  if (error) return <ErrorState message={error} isKo={isKo} />;
  if (!job) return <LoadingState message={isKo ? "결과 불러오는 중…" : "Loading…"} />;
  if (job.status === "queued" || job.status === "processing") {
    return <ProcessingState locale={locale} domain={job.domain} status={job.status} />;
  }
  if (job.status === "failed") return <FailedState job={job} locale={locale} />;
  if (!job.result) return <NoDataState isKo={isKo} />;

  return (
    <>
      <CompletedView
        job={job}
        result={job.result}
        locale={locale}
        onBriefingTriggered={handleBriefingTriggered}
      />
      <ViralBar job={job} locale={locale} />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// ViralBar — sticky bottom (HubSpot 이메일 게이트 + 카톡 공유, research 13)
// ──────────────────────────────────────────────────────────────────

function ViralBar({ job, locale }: { job: JobResponse; locale: string }) {
  const isKo = locale.startsWith("ko");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
      setSubmitted(true);
      setSubmitting(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function shareKakao() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const m = job.result?.metrics;
    let score = 0;
    let brandName = "";
    let domain = "";
    if (m) {
      const enginesUnique = Array.from(new Set(m.enginesCovered));
      const mentionedUnique = Array.from(new Set(m.enginesWithMention));
      const dedup: JobMetrics = {
        ...m,
        enginesCovered: enginesUnique,
        enginesWithMention: mentionedUnique,
      };
      score = totalFiveAxis(fiveAxisScores(dedup, isKo));
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
        ? `내 GEO 점수 ${score}점 받았어요! — Findable\n${url}`
        : `My GEO score is ${score}/100 — Findable\n${url}`;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(text);
        alert(
          isKo
            ? "링크가 클립보드에 복사됐습니다. 카카오톡에 붙여넣기 하세요."
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
          script.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
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
        : `${brandName || domain} — GEO Score ${score}/100`;
      const description = isKo
        ? `AI 답변 7개 엔진에서 ${brandName || domain}의 가시성 측정 결과. 우리 브랜드도 측정해보세요.`
        : `AI visibility audit across 7 engines. Audit your brand too.`;

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
          <div className="flex items-center justify-center gap-2 text-sm text-[var(--signal-good)]">
            <Check className="h-4 w-4" />
            {isKo
              ? "풀 리포트가 곧 메일함에 도착합니다."
              : "Full report is on its way to your inbox."}
          </div>
        ) : emailOpen ? (
          <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              type="email"
              required
              autoFocus
              placeholder={isKo ? "이메일 주소" : "your@email.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 min-w-[180px] rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-[var(--brand-2)] focus:outline-none"
            />
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
              {isKo ? "풀 리포트 받기" : "Send full report"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEmailOpen(false);
                setSubmitError(null);
              }}
            >
              {isKo ? "취소" : "Cancel"}
            </Button>
            {submitError && (
              <span className="basis-full text-xs text-red-400">⚠ {submitError}</span>
            )}
          </form>
        ) : (
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setEmailOpen(true)}
            >
              <Mail className="h-3.5 w-3.5" />
              {isKo ? "📩 풀 리포트 받기 (무료)" : "📩 Get full report (free)"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={shareKakao}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {isKo ? "🔗 카톡으로 점수 자랑" : "🔗 Share to Kakao"}
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
      <p className="text-zinc-400">{isKo ? "결과 데이터가 없습니다." : "No result data."}</p>
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
      <p className="mt-2 text-sm text-red-300">
        {job.errorMessage ?? (isKo ? "알 수 없는 오류" : "Unknown error")}
      </p>
      <Button asChild className="mt-4" variant="outline">
        <a href={`/${locale}/audit`}>{isKo ? "다시 시도" : "Try again"}</a>
      </Button>
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
      <h2 className="mt-6 font-semibold text-2xl text-zinc-100 tracking-tight">
        {isKo ? "AI 엔진들에 질의 중…" : "Querying AI engines…"}
      </h2>
      <p className="mt-2 text-zinc-400">
        {isKo
          ? `${domain}을 7개 AI 엔진에서 측정하고 있습니다. 약 30초~3분 소요.`
          : `Measuring ${domain} across 7 AI engines. ~30s-3m.`}
      </p>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {isKo ? `상태: ${status === "queued" ? "대기 중" : "분석 중"}` : `STATUS: ${status}`}
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
  return (
    <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-8">
      {/* main column */}
      <div className="space-y-12 pb-24 lg:pb-12">
        <HeroSection job={job} result={result} isKo={isKo} />

        <CrewMainSection job={job} locale={locale} />

        {job.crewStatus === "completed" &&
          job.crewResult?.analysts &&
          job.crewResult?.strategist && (
            <CopilotChat jobId={job.jobId} isKo={isKo} />
          )}

        <NaverBriefingCard
          jobId={job.jobId}
          briefingStatus={result.briefingStatus ?? "not_requested"}
          engineResponses={result.engineResponses}
          isKo={isKo}
          onTriggered={onBriefingTriggered}
        />

        <NaverVsAiGap engineResponses={result.engineResponses} isKo={isKo} />

        <EnginesTabsSection result={result} isKo={isKo} />

        {result.metrics.topCitedDomains.length > 0 && (
          <CitationSourcesPanel result={result} isKo={isKo} />
        )}

        <UpsellCard locale={locale} isKo={isKo} />
      </div>

      {/* right sticky aside — Action Center (AthenaHQ +45% ROI 패턴) */}
      <aside className="hidden lg:block">
        <div className="sticky top-6 space-y-4">
          <ActionCenterSticky job={job} locale={locale} isKo={isKo} />
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
  const enginesCoveredUnique = Array.from(new Set(result.metrics.enginesCovered));
  const enginesMentionedUnique = Array.from(new Set(result.metrics.enginesWithMention));
  // stub인 고유 엔진 ID 카운트 (백엔드 stubCount는 응답 단위라 중복됨)
  const stubEngineIds = new Set<string>();
  for (const r of result.engineResponses) {
    if (r.isStub) stubEngineIds.add(r.engineId);
  }
  const stubEnginesCount = stubEngineIds.size;
  const dedupMetrics: JobMetrics = {
    ...result.metrics,
    enginesCovered: enginesCoveredUnique,
    enginesWithMention: enginesMentionedUnique,
    stubCount: stubEnginesCount,
  };
  const axes = fiveAxisScores(dedupMetrics, isKo);
  const totalScore = totalFiveAxis(axes);
  const severity = sovSeverity(totalScore);
  const label = sovLabel(totalScore, isKo);
  const headline = mckinseyHeadline(result.brandName, dedupMetrics, isKo);
  const mentionRate =
    enginesCoveredUnique.length === 0
      ? 0
      : Math.round((enginesMentionedUnique.length / enginesCoveredUnique.length) * 100);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-sm md:p-10">
      {/* corner glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-64 w-64 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--brand-2), transparent)" }}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
            {isKo ? "GEO 점수 측정 결과" : "GEO Score Audit"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {result.domain}
          </div>
          <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]">
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
          <Button asChild size="sm" variant="outline" className="gap-2">
            <a href={job.pdfUrl} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" />
              PDF
            </a>
          </Button>
        )}
      </div>

      {/* McKinsey Action Title — 헤드라인 */}
      <h1 className="mt-6 max-w-3xl font-bold text-2xl text-zinc-50 leading-tight tracking-tight md:text-3xl lg:text-4xl">
        {headline}
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        {isKo
          ? `${result.promptsCount}개 프롬프트 × ${result.metrics.enginesCovered.length}개 엔진 분석`
          : `${result.promptsCount} prompts × ${result.metrics.enginesCovered.length} engines`}
      </p>

      {/* Donut + 5축 분해 (HubSpot 패턴) */}
      <div className="relative mt-10 flex flex-col items-center gap-10 md:flex-row md:items-start md:gap-12">
        <ScoreDonut value={totalScore} severity={severity} />

        <div className="w-full">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {isKo ? "GEO 점수 5가지 항목" : "5-axis breakdown"}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              {totalScore} / 100
            </span>
          </div>
          <div className="space-y-2.5">
            {axes.map((a) => (
              <FiveAxisBar key={a.key} axis={a} isKo={isKo} />
            ))}
          </div>
        </div>
      </div>

      {/* KPI 보조 strip — 5축 아래 */}
      <div className="mt-6 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCell
          label={isKo ? "언급률" : "MENTION"}
          value={mentionRate}
          unit="%"
        />
        <KpiCell
          label={isKo ? "평균 순위" : "AVG. POS"}
          value={result.metrics.averageMentionPosition ?? 0}
          unit={result.metrics.averageMentionPosition !== null ? (isKo ? "위" : "") : "—"}
          isMissing={result.metrics.averageMentionPosition === null}
        />
        <KpiCell
          label={isKo ? "AI 엔진 수" : "ENGINES"}
          valueRaw={`${enginesMentionedUnique.length}/${enginesCoveredUnique.length}`}
        />
        <KpiCell
          label={isKo ? "긍정/부정" : "POS/NEG"}
          valueRaw={`${result.metrics.sentimentDistribution.positive}/${result.metrics.sentimentDistribution.negative}`}
        />
      </div>

      {stubEnginesCount > 0 && (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {isKo
              ? `${stubEnginesCount}개 AI는 아직 연결 전이에요. 다음 측정부터 포함됩니다 (한국 AI: 네이버, 카카오 등).`
              : `${stubEnginesCount} engines are not connected yet. Will be included next time.`}
          </span>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Score Donut — conic-gradient 글로우 + motion 카운트업
// ──────────────────────────────────────────────────────────────────

function ScoreDonut({ value, severity }: { value: number; severity: Severity }) {
  const radius = 96;
  const circumference = 2 * Math.PI * radius;
  const score = useMotionValue(0);
  const display = useTransform(score, (v: number) => Math.round(v));
  const dashOffset = useTransform(score, (v: number) => circumference * (1 - v / 100));

  useEffect(() => {
    const ctrl = animate(score, value, { duration: 1.4, ease: [0.16, 1, 0.3, 1] });
    return () => ctrl.stop();
  }, [value, score]);

  const gradId = severity === "green" ? "g-good" : severity === "amber" ? "g-warn" : "g-bad";
  const textColor =
    severity === "green"
      ? "text-[var(--signal-good)]"
      : severity === "amber"
        ? "text-[var(--signal-warn)]"
        : "text-[var(--signal-bad)]";

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
      <svg className="relative h-56 w-56 -rotate-90" viewBox="0 0 224 224">
        <defs>
          <linearGradient id="g-good" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.20 155)" />
            <stop offset="100%" stopColor="oklch(0.70 0.18 195)" />
          </linearGradient>
          <linearGradient id="g-warn" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.82 0.18 75)" />
            <stop offset="100%" stopColor="oklch(0.78 0.20 50)" />
          </linearGradient>
          <linearGradient id="g-bad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.72 0.25 25)" />
            <stop offset="100%" stopColor="oklch(0.56 0.22 25)" />
          </linearGradient>
        </defs>
        <circle
          cx="112"
          cy="112"
          r={radius}
          fill="none"
          stroke="oklch(1 0 0 / 0.06)"
          strokeWidth="14"
        />
        <motion.circle
          cx="112"
          cy="112"
          r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className={`font-bold text-7xl tabular-nums tracking-tighter ${textColor}`}
        >
          {display}
        </motion.span>
        <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          GEO 점수
        </span>
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
  const barColor =
    tone === "green"
      ? "bg-[var(--signal-good)]"
      : tone === "amber"
        ? "bg-[var(--signal-warn)]"
        : "bg-[var(--signal-bad)]";
  const width = useMotionValue(0);
  const widthPct = useTransform(width, (v: number) => `${v}%`);
  useEffect(() => {
    const ctrl = animate(width, pct, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    return () => ctrl.stop();
  }, [pct, width]);

  return (
    <div className="group">
      <div className="flex items-baseline justify-between text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-zinc-200">
            {isKo ? axis.labelKo : axis.labelEn}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            {axis.hint}
          </span>
        </div>
        <span className="font-mono tabular-nums text-zinc-400">
          {axis.score}
          <span className="text-zinc-600"> / {axis.max}</span>
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
    if (value === undefined) return;
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
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <motion.span className={`font-bold text-2xl tabular-nums ${valueColor}`}>
          {isMissing ? "—" : (valueRaw ?? display)}
        </motion.span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Crew Section (Monday Action + Top Actions + Analysts)
// ──────────────────────────────────────────────────────────────────

// 메인 컬럼용 — 분석가 리포트 + 보조 액션 4~6위 (Top 3은 사이드바로 분리)
function CrewMainSection({ job, locale }: { job: JobResponse; locale: string }) {
  const isKo = locale.startsWith("ko");

  if (job.crewStatus === "not_requested") {
    return <CrewTriggerCard jobId={job.jobId} isKo={isKo} />;
  }
  if (job.crewStatus === "queued" || job.crewStatus === "processing") {
    return <CrewProcessingCard isKo={isKo} />;
  }
  if (job.crewStatus === "failed") {
    return <CrewFailedCard jobId={job.jobId} isKo={isKo} />;
  }
  if (!job.crewResult) return null;

  if (!job.crewResult.analysts || !job.crewResult.strategist) {
    return <LegacyCrewNotice locale={locale} isKo={isKo} />;
  }

  return (
    <div className="space-y-12">
      <SecondaryActionsGrid strategist={job.crewResult.strategist} isKo={isKo} />
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
    <SpotlightCard className="p-5" border="brand">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
        <Target className="h-3.5 w-3.5" />
        {isKo ? "오늘 할 일" : "Action Center"}
      </div>

      {ready && job.crewResult?.strategist?.output ? (
        <ActionCenterContent
          strategist={job.crewResult.strategist}
          job={job}
          isKo={isKo}
        />
      ) : (
        <ActionCenterPending job={job} isKo={isKo} />
      )}

      {job.pdfUrl && (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="mt-5 w-full gap-2"
        >
          <a href={job.pdfUrl} target="_blank" rel="noopener noreferrer">
            <Download className="h-4 w-4" />
            {isKo ? "PDF 다운로드" : "Download PDF"}
          </a>
        </Button>
      )}

      <div className="mt-3 border-white/10 border-t pt-3">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="w-full gap-2 text-zinc-400 hover:text-zinc-100"
        >
          <a href={`/${locale}/audit`}>
            <RotateCw className="h-3.5 w-3.5" />
            {isKo ? "새 진단 시작" : "New audit"}
          </a>
        </Button>
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
  if (!out) return null;
  const top3 = out.topActions.slice(0, 3);
  return (
    <div className="mt-4 space-y-4">
      {/* Monday Action — 압축 카드 */}
      {out.mondayActionOne && (
        <div className="rounded-lg border border-[var(--brand-1)]/30 bg-[var(--brand-1)]/5 p-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
            {isKo ? "월요일 09:00" : "Monday 9 AM"}
          </div>
          <div className="mt-1 font-semibold text-sm text-zinc-50 leading-snug">
            {out.mondayActionOne.title}
          </div>
        </div>
      )}

      {/* Top 3 액션 */}
      <div className="space-y-2">
        {top3.map((a) => (
          <StickyActionRow key={a.rank} action={a} isKo={isKo} />
        ))}
      </div>
    </div>
  );
}

function StickyActionRow({ action, isKo }: { action: ActionItem; isKo: boolean }) {
  const channelLabel = CHANNEL_LABELS[action.channel] ?? action.channel;
  return (
    <div className="group rounded-lg border border-white/10 bg-white/[0.02] p-3 transition-colors hover:border-[var(--brand-2)]/30 hover:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          #{String(action.rank).padStart(2, "0")}
        </span>
        <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {channelLabel}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 font-medium text-xs text-zinc-100 leading-snug">
        {action.title}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className="text-zinc-500">{action.expectedTimeframe}</span>
        <span className="inline-flex items-center gap-1 text-[var(--signal-good)]">
          <span className="h-1 w-1 rounded-full bg-[var(--signal-good)]" />
          {isKo ? `임팩트 ${action.impact}/5` : `Impact ${action.impact}/5`}
        </span>
      </div>
    </div>
  );
}

function ActionCenterPending({ job, isKo }: { job: JobResponse; isKo: boolean }) {
  if (job.crewStatus === "queued" || job.crewStatus === "processing") {
    return (
      <div className="mt-4 flex items-start gap-2 text-xs text-zinc-400">
        <RotateCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--brand-2)]" />
        <span className="leading-relaxed">
          {isKo
            ? "AI 마케팅팀 4명이 분석 중입니다. 완료되면 여기에 오늘 할 일 3개가 표시됩니다."
            : "Your AI team is analyzing. Top 3 actions will appear here."}
        </span>
      </div>
    );
  }
  if (job.crewStatus === "failed") {
    return (
      <p className="mt-4 text-xs text-red-400">
        {isKo ? "AI 분석 실패. 본문에서 다시 시도하세요." : "AI analysis failed."}
      </p>
    );
  }
  return (
    <p className="mt-4 text-xs text-zinc-500 leading-relaxed">
      {isKo
        ? "본문에서 'AI 마케팅팀 분석 시작'을 누르면 오늘 할 일 3개가 여기에 표시됩니다."
        : "Start the 4-agent analysis to see your top 3 actions here."}
    </p>
  );
}

function LegacyCrewNotice({ locale, isKo }: { locale: string; isKo: boolean }) {
  return (
    <SpotlightCard className="p-6 md:p-8" border="brand">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
        <Sparkles className="h-3.5 w-3.5" />
        {isKo ? "이전 분석 데이터" : "Legacy Analysis"}
      </div>
      <h3 className="mt-3 font-bold text-xl text-zinc-50 tracking-tight">
        {isKo
          ? "이 jobId는 이전 버전 분석 데이터를 가지고 있습니다"
          : "This job has legacy analysis data"}
      </h3>
      <p className="mt-3 max-w-2xl text-sm text-zinc-400 leading-relaxed">
        {isKo
          ? "Findable이 4 에이전트 분석 출력 형식을 JSON 구조화로 업그레이드했습니다. 새 형식(Monday Action·Top Actions·Findings 분리)을 보려면 새 진단을 시작해주세요."
          : "Findable upgraded the 4-agent output to structured JSON. Run a new audit to see the new format."}
      </p>
      <Button asChild size="lg" className="mt-5 gap-2">
        <a href={`/${locale}/audit`}>
          <Sparkles className="h-4 w-4" />
          {isKo ? "새 진단 시작하기" : "Start a new audit"}
        </a>
      </Button>
    </SpotlightCard>
  );
}

function CrewTriggerCard({ jobId, isKo }: { jobId: string; isKo: boolean }) {
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  async function handleTrigger() {
    setTriggering(true);
    setTriggerError(null);
    try {
      const response = await fetch(`/api/audit/${jobId}/crew`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setTriggerError(data.error ?? `HTTP ${response.status}`);
        setTriggering(false);
        return;
      }
      setTimeout(() => setTriggering(false), 1500);
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : String(err));
      setTriggering(false);
    }
  }

  return (
    <SpotlightCard className="p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-grad-brand text-white">
          <Users className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
            <Sparkles className="h-3 w-3" />
            {isKo ? "베타 · 무료" : "Beta · Free"}
          </div>
          <h3 className="mt-3 font-bold text-xl text-zinc-50 tracking-tight">
            {isKo
              ? "AI 마케팅팀 4명에게 깊이 있는 분석 받기"
              : "Get deep analysis from 4 AI marketing analysts"}
          </h3>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "민지(한국 GEO)·Alex(글로벌)·수진(인용)·준호(전략)가 위 데이터를 분석하고 이번 주 실행 가능한 액션 1개를 도출합니다. 약 3~5분."
              : "Minji, Alex, Sujin, Junho analyze and propose one action you can ship this week. ~3-5 min."}
          </p>
          {triggerError && <p className="mt-3 text-sm text-red-400">⚠ {triggerError}</p>}
          <Button size="lg" className="mt-4 gap-2" disabled={triggering} onClick={handleTrigger}>
            {triggering ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isKo ? "분석 시작 중…" : "Starting…"}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {isKo ? "4 에이전트 분석 시작" : "Start 4-agent analysis"}
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
            {isKo ? "AI 마케팅팀이 분석 중입니다…" : "Your AI team is analyzing…"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {isKo ? "약 3~5분 소요됩니다." : "Takes about 3-5 minutes."}
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
          <p className="mt-1 text-sm text-red-400">
            {isKo
              ? "AI 모델 호출 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
              : "Error calling AI model. Please retry shortly."}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : isKo ? "다시 시도" : "Retry"}
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
  engineResponses,
  isKo,
  onTriggered,
}: {
  jobId: string;
  briefingStatus: BriefingStatus;
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
        jobId={jobId}
        engineResponses={engineResponses}
        isKo={isKo}
      />
    );
  }
  // not_requested · failed → 트리거 카드 (failed는 재시도 안내 병기)
  return (
    <NaverBriefingTriggerCard
      jobId={jobId}
      failed={briefingStatus === "failed"}
      isKo={isKo}
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
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
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
            <Sparkles className="h-3 w-3" />
            {isKo ? "베타 · 무료" : "Beta · Free"}
          </div>
          <h3 className="mt-3 font-bold text-xl text-zinc-50 tracking-tight">
            {isKo
              ? "네이버 AI 브리핑에서도 측정해보기"
              : "Measure Naver AI Briefing too"}
          </h3>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "네이버 검색의 AI 브리핑 영역에 우리 브랜드가 인용되는지 실측합니다. 클라우드 브라우저로 실제 검색을 수행해 약 30초~1분 소요됩니다."
              : "Checks whether your brand is cited in Naver's AI Briefing. Runs a real search via cloud browser (~30s-1m)."}
          </p>
          {failed && (
            <p className="mt-3 text-sm text-amber-400">
              {isKo
                ? "⚠ 지난번 측정에 실패했습니다. 다시 시도할 수 있어요."
                : "⚠ Last measurement failed. You can retry."}
            </p>
          )}
          {triggerError && <p className="mt-3 text-sm text-red-400">⚠ {triggerError}</p>}
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
    <section
      aria-live="polite"
      className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6 md:p-8"
      role="status"
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
          <p className="mt-1 text-sm text-zinc-500">
            {isKo
              ? "클라우드 브라우저로 실제 검색을 수행 중입니다. 약 30초~1분."
              : "Running a real search via cloud browser. ~30s-1m."}
          </p>
        </div>
      </div>
    </section>
  );
}

function NaverBriefingCompletedCard({
  jobId: _jobId,
  engineResponses,
  isKo,
}: {
  jobId: string;
  engineResponses: JobResult["engineResponses"];
  isKo: boolean;
}) {
  const briefing = engineResponses.find((r) => r.engineId === "naver-briefing");

  return (
    <SpotlightCard className="p-6 md:p-8" border="brand">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--brand-2)]">
        <Search className="h-3.5 w-3.5" />
        {isKo ? "네이버 AI 브리핑 측정 완료" : "Naver AI Briefing measured"}
      </div>
      {!briefing || briefing.errorMessage ? (
        // "브리핑 미노출"은 측정 실패가 아니라 정상 결과(=GEO 기회)다.
        // errorMessage 원문(기술 문구)을 ⚠로 노출하지 않고 기회 프레이밍으로 전환.
        <div className="mt-3 rounded-xl border border-[var(--brand-2)]/20 bg-[var(--brand-2)]/5 p-4">
          <p className="font-semibold text-sm text-zinc-200">
            {isKo
              ? "아직 네이버 AI 브리핑에 노출되지 않았습니다"
              : "Not yet surfaced in Naver AI Briefing"}
          </p>
          <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
            {isKo
              ? "이 질의에서 네이버 AI 브리핑은 아직 우리 브랜드를 인용하지 않았습니다. 경쟁사가 먼저 자리를 잡기 전에, 지금이 바로 네이버 AI 노출을 확보할 기회입니다."
              : "Naver AI Briefing doesn't cite your brand for this query yet — which is exactly the opening to claim that visibility before competitors do."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <MentionBadge
              mentioned={briefing.brandMentioned}
              position={briefing.mentionPosition}
              isStub={briefing.isStub}
            />
            <SentimentBadge sentiment={briefing.sentiment} />
          </div>
          <p className="mt-4 whitespace-pre-line text-sm text-zinc-300 leading-relaxed">
            {briefing.isStub
              ? isKo
                ? "네이버 AI 브리핑 연결이 아직 활성화되지 않았습니다 (Browserbase 미설정)."
                : "Naver AI Briefing is not connected yet (Browserbase not configured)."
              : briefing.excerpt || (isKo ? "(응답 없음)" : "(no response)")}
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
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  const borderCls =
    border === "brand"
      ? "border-l-4 border-l-[var(--brand-2)] border-y border-r border-white/10"
      : "border border-white/10";

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={`group relative overflow-hidden rounded-2xl bg-zinc-900/60 backdrop-blur-sm ${borderCls} ${className}`}
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
  if (!strategist.output) return null;
  const actions = strategist.output.topActions.slice(3, 6);
  if (actions.length === 0) return null;

  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <Target className="h-3.5 w-3.5" />
        {isKo ? "추가 액션 (4~6위)" : "More Actions"}
      </div>
      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {actions.map((action) => (
          <ActionCard key={action.rank} action={action} isKo={isKo} />
        ))}
      </motion.div>
    </section>
  );
}

function ActionCard({ action, isKo }: { action: ActionItem; isKo: boolean }) {
  const channelLabel = CHANNEL_LABELS[action.channel] ?? action.channel;

  return (
    <motion.div
      variants={item}
      className="group relative rounded-xl border border-white/10 bg-zinc-900/60 p-5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[var(--brand-2)]/30"
    >
      {action.rank === 1 && (
        <div
          aria-hidden
          className="-z-10 absolute inset-0 rounded-xl opacity-25 blur-xl transition-opacity group-hover:opacity-40"
          style={{
            background: "linear-gradient(135deg, var(--brand-1), var(--brand-2))",
          }}
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-zinc-500">
          #{String(action.rank).padStart(2, "0")}
        </span>
        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-400">
          {channelLabel}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 font-semibold text-base text-zinc-50 leading-snug">
        {action.title}
      </h3>
      <p className="mt-2 line-clamp-3 text-sm text-zinc-400 leading-relaxed">{action.rationale}</p>
      <div className="mt-4 flex items-center justify-between border-white/5 border-t pt-3 text-xs">
        <div className="flex items-center gap-2">
          <ScoreDot
            label={isKo ? "임팩트" : "Impact"}
            score={action.impact}
            tone="emerald"
          />
          <ScoreDot label={isKo ? "노력" : "Effort"} score={action.effort} tone="zinc" />
        </div>
      </div>
      <div className="mt-2 text-xs text-zinc-500">{action.expectedTimeframe}</div>
    </motion.div>
  );
}

function ScoreDot({
  label,
  score,
  tone,
}: {
  label: string;
  score: number;
  tone: "emerald" | "zinc";
}) {
  const dotCls = tone === "emerald" ? "bg-[var(--signal-good)]" : "bg-zinc-500";
  return (
    <span className="inline-flex items-center gap-1 text-zinc-400">
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
  if (analysts.length === 0) return null;
  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <Users className="h-3.5 w-3.5" />
        {isKo ? "분석가 리포트" : "Analyst Reports"}
      </div>
      <div className="space-y-3">
        {analysts.map((a) => (
          <AnalystAccordion key={a.agentId} report={a} isKo={isKo} />
        ))}
      </div>
    </section>
  );
}

function AnalystAccordion({ report, isKo }: { report: AnalystReport; isKo: boolean }) {
  const [open, setOpen] = useState(false);
  const out = report.output;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{report.emoji}</span>
          <div>
            <div className="font-semibold text-sm text-zinc-100">{report.displayName}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
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
          {report.errorMessage && <span className="text-xs text-red-400">⚠ 오류</span>}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="border-white/10 border-t px-5 py-5">
          {report.errorMessage ? (
            <p className="text-sm text-red-400">⚠ {report.errorMessage}</p>
          ) : !out ? (
            <p className="text-sm text-zinc-500">{isKo ? "응답이 없습니다." : "No response."}</p>
          ) : (
            <div className="space-y-4">
              <p className="font-medium text-sm text-zinc-200 leading-relaxed">
                {out.executiveSummary}
              </p>
              {out.findings.length > 0 && (
                <div className="space-y-2">
                  {out.findings.map((f, i) => (
                    <FindingRow key={i} finding={f} />
                  ))}
                </div>
              )}
              {out.observation && (
                <div className="rounded-md border border-white/5 bg-white/5 p-3 text-sm text-zinc-400 leading-relaxed">
                  {out.observation}
                </div>
              )}
              {out.dataGaps.length > 0 && (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                  <span className="font-medium">{isKo ? "데이터 부족" : "Gaps"}:</span>{" "}
                  {out.dataGaps.join(", ")}
                </div>
              )}
            </div>
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
        <div className="font-semibold text-sm text-zinc-100">{finding.title}</div>
        <div className="mt-0.5 text-xs text-zinc-500">{finding.whyItMatters}</div>
        {finding.detail && (
          <div className="mt-1 text-xs text-zinc-400 leading-relaxed">{finding.detail}</div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Engines — sticky 탭 + layoutId 슬라이드 (Linear)
// ──────────────────────────────────────────────────────────────────

function EnginesTabsSection({ result, isKo }: { result: JobResult; isKo: boolean }) {
  const dedup = dedupeByEngine(result.engineResponses);
  const [selected, setSelected] = useState<string>(dedup[0]?.engineId ?? "");
  const current = dedup.find((r) => r.engineId === selected);

  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {isKo ? "엔진별 응답" : "Engine Responses"}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm">
        <div className="flex gap-1 overflow-x-auto border-white/10 border-b bg-white/[0.02] px-2">
          {dedup.map((r) => {
            const isActive = r.engineId === selected;
            return (
              <button
                key={r.engineId}
                type="button"
                onClick={() => setSelected(r.engineId)}
                className={`relative shrink-0 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive ? "text-zinc-50" : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {ENGINE_LABELS[r.engineId] ?? r.engineId}
                {r.engineId === "chatgpt-web" && (
                  <span className="ml-1.5 rounded border border-[var(--brand-2)]/30 bg-[var(--brand-2)]/10 px-1 text-[10px] text-[var(--brand-2)]">
                    BETA
                  </span>
                )}
                {isActive && (
                  <motion.div
                    layoutId="engine-tab-indicator"
                    className="absolute inset-x-2 -bottom-px h-0.5 bg-grad-brand"
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
                mentioned={current.brandMentioned}
                position={current.mentionPosition}
                isStub={current.isStub}
              />
              <SentimentBadge sentiment={current.sentiment} />
              <span className="font-mono text-xs tabular-nums text-zinc-600">
                {current.durationMs}ms
              </span>
            </div>
            <div className="mt-4 whitespace-pre-line text-sm text-zinc-300 leading-relaxed">
              {current.errorMessage ? (
                <span className="text-red-400">⚠ {current.errorMessage}</span>
              ) : current.isStub ? (
                <span className="text-zinc-400">
                  {isKo
                    ? "이 AI는 아직 연결되지 않았어요. 다음 측정부터 포함됩니다."
                    : "This AI is not connected yet. Will be included next time."}
                </span>
              ) : (
                current.excerpt || (isKo ? "(응답 없음)" : "(no response)")
              )}
            </div>
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
  if (isStub) return <Pill tone="muted">측정 안 됨</Pill>;
  if (!mentioned) return <Pill tone="negative">미언급</Pill>;
  if (position) return <Pill tone="positive">{position}위</Pill>;
  return <Pill tone="positive">언급</Pill>;
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (sentiment === "positive") return <Pill tone="positive">긍정</Pill>;
  if (sentiment === "negative") return <Pill tone="negative">부정</Pill>;
  if (sentiment === "neutral") return <Pill tone="neutral">중립</Pill>;
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
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// Citation Sources — Perplexity 칩 (favicon + %)
// ──────────────────────────────────────────────────────────────────

function CitationSourcesPanel({ result, isKo }: { result: JobResult; isKo: boolean }) {
  const total = result.metrics.topCitedDomains.reduce((sum, d) => sum + d.count, 0);
  return (
    <section>
      <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {isKo ? "주요 인용 출처" : "Top Cited Domains"}
      </div>
      <div className="flex flex-wrap gap-2">
        {result.metrics.topCitedDomains.map((d, i) => {
          const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
          const isReddit = d.domain.includes("reddit.com");
          return (
            <motion.a
              key={d.domain}
              href={`https://${d.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-xs backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[var(--brand-3)]/40"
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${d.domain}&sz=32`}
                alt=""
                className="h-3.5 w-3.5 rounded-sm"
              />
              <span className="font-mono text-zinc-300">{d.domain}</span>
              <span className="rounded bg-[var(--brand-3)]/10 px-1.5 py-0.5 font-mono tabular-nums text-[var(--brand-3)]">
                {pct}%
              </span>
              {isReddit && (
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                  {isKo ? "LLM 인용 1위" : "#1 LLM source"}
                </span>
              )}
            </motion.a>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Upsell
// ──────────────────────────────────────────────────────────────────

function UpsellCard({ locale, isKo }: { locale: string; isKo: boolean }) {
  return (
    <SpotlightCard className="p-6 md:p-10" border="brand">
      <h3 className="font-bold text-xl text-zinc-50 tracking-tight">
        {isKo ? "이 결과를 매주 자동 추적하시겠어요?" : "Track this weekly?"}
      </h3>
      <p className="mt-3 max-w-2xl text-sm text-zinc-400 leading-relaxed">
        {isKo
          ? "Findable Starter ₩99,000/월 — 30개 프롬프트 × 7개 엔진 자동 추적, 경쟁사 벤치마크, CSV Export, 월요일 09:00 액션 디지트 자동 발송."
          : "Findable Starter ₩99,000/mo — 30 prompts × 7 engines tracking, competitor benchmark, CSV export, Monday 9 AM digest."}
      </p>
      <Button asChild size="lg" className="mt-5 gap-2">
        <a href={`/${locale}/contact`}>
          <Zap className="h-4 w-4" />
          {isKo ? "전문가 상담 예약" : "Talk to an expert"}
        </a>
      </Button>
    </SpotlightCard>
  );
}

function dedupeByEngine<T extends { engineId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const r of rows) {
    if (seen.has(r.engineId)) continue;
    seen.add(r.engineId);
    result.push(r);
  }
  return result;
}
