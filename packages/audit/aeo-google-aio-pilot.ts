// AEO 레인 시범 — 구글 AI 개요(AI Overviews) 측정 러너(2026-10-07 대표 승인 · 무료 범위)
//
// 무엇을 하나: 허용 목록 브랜드마다 주 1회, 그 브랜드의 질문 계획 v2(이름 없는 A~D 질문 최대 20개)를
//   질문의 시장(KR=google.co.kr gl=kr hl=ko · US=google.com gl=us hl=en)에서 구글 검색해
//   AI 개요가 떴는지·브랜드가 본문에 나오는지·공식 도메인이 인용됐는지를 잰다.
//
// ⛔ 계약(점수 격리)
//   · AEO_GOOGLE_AIO_PILOT=true 이고 브랜드가 AEO_PILOT_BRANDS(브랜드 ID 또는 도메인)에 있을 때만.
//     목록이 비면 **아무 브랜드도** 돌지 않는다(전체 허용 없음).
//   · 결과는 질문의 출처가 된 AuditJob 의 result.aeoPilotRuns[] 에만 덧붙인다.
//     GEO 점수·추세·Tracking·처방·PDF 에 넣지 않는다(usedInScores: false). 공개 API 에서는 지운다
//     (normalize-stored-metrics.ts publicAuditResult).
//   · 판정은 규칙만 — AI 개요 본문을 LLM 에 넣지 않는다(구글 콘텐츠 · 약관 회색지대).
//   · 결과 표기: 「제3자 측정 서비스 기준」(Bright Data SERP API 수집 — 구글 공식 API 아님).
//   · 월 사용량 상한(기본 4,500건, 무료 5,000건/월보다 낮게): 이번 브랜드 질문 수를 더해 넘으면 멈춘다.
//   · 절대 throw 하지 않는다(cron 이 부른다).
//
// 근거·원가: packages/ai/lib/engines/google-aio-adapter.ts 상단(공식 문서 URL).

import {
  type AioCitation,
  type AioMarket,
  aioCitesDomain,
  aioMentionsBrand,
  fetchGoogleAio,
  type GoogleAioResult,
} from "@repo/ai/lib/engines/google-aio-adapter";
import { database } from "@repo/database";
import { brandNotInInternalOrg } from "@repo/database/internal-orgs";
import { log } from "@repo/observability/log";
import type { PlanV2Type } from "./plan-v2-contract";

type Env = Record<string, string | undefined>;

export const AEO_PILOT_VERSION = 1 as const;
export const AEO_PILOT_SOURCE_LABEL = "제3자 측정 서비스 기준" as const;
/** 브랜드당 질문 상한(주 20문항). */
export const AEO_PILOT_MAX_QUESTIONS = 20;
/** 브랜드당 최소 간격(주 1회). */
export const AEO_PILOT_MIN_DAYS = 7;
/** 무료 5,000건/월보다 낮게 멈춘다(다른 사용·재시도 여유). */
export const AEO_PILOT_MONTHLY_CAP = 4500;
/**
 * 동시 요청 수. 실측(2026-10-07) 응답 18~36초 · 상한 60초 → 20문항 ÷ 5 = 4바퀴 ≈ 최악 240초.
 */
export const AEO_PILOT_CONCURRENCY = 5;
const TOP_DOMAINS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 결과를 덧붙일 원본 회차는 완료 후 이 시간이 지난 것만(늦은 답 반영 등 다른 쓰기와 겹치지 않게). */
const SOURCE_SETTLE_MS = 6 * 60 * 60 * 1000;
const NON_BRANDED_TYPES: readonly PlanV2Type[] = ["A", "B", "C", "D"];

// ── 플래그·허용 목록 ────────────────────────────────────────────────
export function isAeoPilotEnabled(env: Env = process.env): boolean {
  return env.AEO_GOOGLE_AIO_PILOT === "true";
}

const LIST_SPLIT_RE = /[\s,]+/;
const DOMAIN_PREFIX_RE = /^(?:https?:\/\/)?(?:www\.)?/i;
const PATH_SUFFIX_RE = /\/.*$/;
export const normalizePilotDomain = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(DOMAIN_PREFIX_RE, "")
    .replace(PATH_SUFFIX_RE, "");

export function aeoPilotAllowlist(env: Env = process.env): string[] {
  return (env.AEO_PILOT_BRANDS ?? "")
    .split(LIST_SPLIT_RE)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isAeoPilotBrandAllowed(
  brand: { domain: string; id: string },
  env: Env = process.env
): boolean {
  const domain = normalizePilotDomain(brand.domain);
  return aeoPilotAllowlist(env).some(
    (entry) => entry === brand.id || normalizePilotDomain(entry) === domain
  );
}

/** 월 상한 — env 로 낮출 수만 있다(4,500 초과 불가). */
export function aeoPilotMonthlyCap(env: Env = process.env): number {
  const raw = Number(env.AEO_PILOT_MONTHLY_CAP);
  if (!Number.isFinite(raw) || raw <= 0) {
    return AEO_PILOT_MONTHLY_CAP;
  }
  return Math.min(AEO_PILOT_MONTHLY_CAP, Math.floor(raw));
}

/** 이번 달(한국시간) 1일 0시 — UTC Date. */
export function kstMonthStart(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 60 * 60 * 1000
  );
}

// ── 질문 선택(순수) ─────────────────────────────────────────────────
export interface AeoPilotQuestion {
  index: number;
  market: AioMarket;
  text: string;
  type: PlanV2Type;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const MARKETS: readonly AioMarket[] = ["KR", "US"];

/** 저장된 질문 1개 → 시범 질문(이름 없는 A~D 만). 아니면 null. */
function pilotQuestionOf(
  q: unknown,
  position: number
): AeoPilotQuestion | null {
  if (!isRecord(q) || q.kind !== "discovery") {
    return null;
  }
  const type = q.type as PlanV2Type;
  const market = MARKETS.find((m) => m === q.market);
  const text = typeof q.text === "string" ? q.text.trim() : "";
  if (!(market && text && NON_BRANDED_TYPES.includes(type))) {
    return null;
  }
  return {
    index: typeof q.index === "number" ? q.index : position,
    market,
    text,
    type,
  };
}

/**
 * result.shadowPlanV2.questions → 이름 없는(discovery) A~D 질문, 시장별 중복 제거, 최대 20개.
 * 시장 순서를 섞어 한 시장이 상한을 독점하지 않게 번갈아 고른다.
 */
export function selectAeoPilotQuestions(
  shadowPlanV2: unknown,
  max = AEO_PILOT_MAX_QUESTIONS
): AeoPilotQuestion[] {
  const raw = isRecord(shadowPlanV2) ? shadowPlanV2.questions : undefined;
  if (!Array.isArray(raw)) {
    return [];
  }
  const byMarket: Record<AioMarket, AeoPilotQuestion[]> = { KR: [], US: [] };
  const seen = new Set<string>();
  for (const [position, q] of raw.entries()) {
    const question = pilotQuestionOf(q, position);
    const key = question
      ? `${question.market}:${question.text.toLowerCase()}`
      : "";
    if (!question || seen.has(key)) {
      continue;
    }
    seen.add(key);
    byMarket[question.market].push(question);
  }
  const picked: AeoPilotQuestion[] = [];
  for (let i = 0; picked.length < max; i++) {
    const kr = byMarket.KR[i];
    const us = byMarket.US[i];
    if (!(kr || us)) {
      break;
    }
    for (const q of [kr, us]) {
      if (q && picked.length < max) {
        picked.push(q);
      }
    }
  }
  return picked;
}

// ── 집계(순수) ──────────────────────────────────────────────────────
export interface AeoPilotRow {
  brandMentioned: boolean;
  citations: AioCitation[];
  failure?: GoogleAioResult["failure"];
  latencyMs: number;
  market: AioMarket;
  officialCited: boolean;
  question: string;
  questionIndex: number;
  questionType: PlanV2Type;
  status: GoogleAioResult["status"];
  /** AI 개요 본문(규칙 판정 근거 · 내부 보관 전용, 공개 API 에서 제거). */
  text: string;
  textLength: number;
}

export interface AeoMarketSummary {
  brandMentioned: number;
  brandMentionRate: number | null;
  failed: number;
  /** 실패를 뺀 측정 수(= 노출률 분모). */
  measured: number;
  officialCited: number;
  officialCitedRate: number | null;
  questions: number;
  shown: number;
  /** shown ÷ measured. */
  showRate: number | null;
  topCitedDomains: Array<{ count: number; domain: string }>;
}

const rate = (n: number, d: number) =>
  d > 0 ? Math.round((n / d) * 1000) / 1000 : null;

/** 시장별 요약. brandMentionRate·officialCitedRate 의 분모 = AI 개요가 뜬 질문 수. */
export function summarizeAeoPilot(
  rows: readonly AeoPilotRow[]
): Partial<Record<AioMarket, AeoMarketSummary>> {
  const out: Partial<Record<AioMarket, AeoMarketSummary>> = {};
  for (const market of ["KR", "US"] as const) {
    const mine = rows.filter((r) => r.market === market);
    if (mine.length === 0) {
      continue;
    }
    const failed = mine.filter((r) => r.status === "failed").length;
    const shownRows = mine.filter((r) => r.status === "shown");
    const brandMentioned = shownRows.filter((r) => r.brandMentioned).length;
    const officialCited = shownRows.filter((r) => r.officialCited).length;
    const domainCounts = new Map<string, number>();
    for (const r of shownRows) {
      // 한 답 안에서 같은 도메인은 1번만 센다(「몇 개 질문에서 인용됐나」).
      for (const domain of new Set(r.citations.map((c) => c.domain))) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }
    const measured = mine.length - failed;
    out[market] = {
      questions: mine.length,
      measured,
      failed,
      shown: shownRows.length,
      showRate: rate(shownRows.length, measured),
      brandMentioned,
      brandMentionRate: rate(brandMentioned, shownRows.length),
      officialCited,
      officialCitedRate: rate(officialCited, shownRows.length),
      topCitedDomains: [...domainCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_DOMAINS)
        .map(([domain, count]) => ({ domain, count })),
    };
  }
  return out;
}

// ── 한 브랜드 측정 ──────────────────────────────────────────────────
export interface AeoPilotRun {
  brandId: string;
  cost: {
    basis: "free_tier" | "paid";
    billedKrw: number;
    credits: number;
    listPriceKrw: number;
    /** 시도한 요청 수(월 상한 계산에 쓴다 — 실패도 보수적으로 센다). */
    requestsAttempted: number;
  };
  measuredAt: string;
  officialDomain: string;
  rows: AeoPilotRow[];
  source: "brightdata-serp";
  sourceAuditJobId: string;
  sourceLabel: typeof AEO_PILOT_SOURCE_LABEL;
  summary: Partial<Record<AioMarket, AeoMarketSummary>>;
  usedInScores: false;
  version: typeof AEO_PILOT_VERSION;
}

export interface MeasureBrandArgs {
  brand: { domain: string; id: string; names: readonly string[] };
  env?: Env;
  fetchAio?: typeof fetchGoogleAio;
  /** 이번 달 이미 쓴 요청 수(무료 범위 판단). */
  monthlyUsed: number;
  now?: Date;
  questions: readonly AeoPilotQuestion[];
  signal?: AbortSignal;
  sourceAuditJobId: string;
}

const FREE_TIER_REQUESTS = 5000;

/** 질문들을 재고 집계한다. 순수하지 않은 것은 fetchAio 하나(주입 가능). */
export async function measureAeoPilotBrand(
  args: MeasureBrandArgs
): Promise<AeoPilotRun> {
  const fetchAio = args.fetchAio ?? fetchGoogleAio;
  const env = args.env ?? process.env;
  const rows: AeoPilotRow[] = new Array(args.questions.length);
  const costs: GoogleAioResult["cost"][] = new Array(args.questions.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < args.questions.length) {
      const i = cursor++;
      const q = args.questions[i];
      if (!q) {
        continue;
      }
      const basis =
        args.monthlyUsed + i + 1 <= FREE_TIER_REQUESTS ? "free_tier" : "paid";
      const res = await fetchAio({
        query: q.text,
        market: q.market,
        env,
        costBasis: basis,
        signal: args.signal,
      });
      rows[i] = {
        questionIndex: q.index,
        questionType: q.type,
        question: q.text,
        market: q.market,
        status: res.status,
        ...(res.failure ? { failure: res.failure } : {}),
        text: res.text,
        textLength: res.textLength,
        citations: res.citations,
        brandMentioned:
          res.status === "shown" &&
          aioMentionsBrand(res.text, [...args.brand.names, args.brand.domain]),
        officialCited:
          res.status === "shown" &&
          aioCitesDomain(res.citations, args.brand.domain),
        latencyMs: res.latencyMs,
      };
      // 원가는 행에 두지 않고 아래에서 합친다.
      costs[i] = res.cost;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(AEO_PILOT_CONCURRENCY, args.questions.length) },
      worker
    )
  );
  const done = rows.filter(Boolean);
  const spent = costs.filter(Boolean);
  const credits = spent.reduce((s, c) => s + c.credits, 0);
  const sum = (pick: (c: GoogleAioResult["cost"]) => number) =>
    Math.round(spent.reduce((s, c) => s + pick(c), 0) * 100) / 100;
  return {
    version: AEO_PILOT_VERSION,
    source: "brightdata-serp",
    sourceLabel: AEO_PILOT_SOURCE_LABEL,
    usedInScores: false,
    brandId: args.brand.id,
    officialDomain: normalizePilotDomain(args.brand.domain),
    sourceAuditJobId: args.sourceAuditJobId,
    measuredAt: (args.now ?? new Date()).toISOString(),
    rows: done,
    summary: summarizeAeoPilot(done),
    cost: {
      basis: spent.some((c) => c.basis === "paid") ? "paid" : "free_tier",
      credits,
      requestsAttempted: done.length,
      listPriceKrw: sum((c) => c.listPriceKrw),
      billedKrw: sum((c) => c.billedKrw),
    },
  };
}

// ── 오케스트레이션(cron) ─────────────────────────────────────────────
export interface PilotBrand {
  domain: string;
  entityVariants: unknown;
  id: string;
  name: string;
}

export interface AeoPilotDeps {
  appendRun: (auditJobId: string, run: AeoPilotRun) => Promise<void>;
  fetchAio: typeof fetchGoogleAio;
  /** 브랜드의 마지막 시범 측정 시각(없으면 null). */
  lastRunAt: (brandId: string) => Promise<Date | null>;
  latestShadowSource: (
    brandId: string,
    settledBefore: Date
  ) => Promise<{ auditJobId: string; shadowPlanV2: unknown } | null>;
  listBrands: (allowlist: readonly string[]) => Promise<PilotBrand[]>;
  /** 이번 달(KST) 시도한 요청 수 합. */
  monthlyRequests: (since: Date) => Promise<number>;
}

export type AeoPilotBrandOutcome =
  | { brandId: string; credits: number; questions: number; status: "measured" }
  | {
      brandId: string;
      status:
        | "too_soon"
        | "no_plan"
        | "no_questions"
        | "quota"
        | "deadline"
        | "error";
    };

export interface AeoPilotRunSummary {
  brands: AeoPilotBrandOutcome[];
  enabled: boolean;
  monthlyCap: number;
  monthlyUsedAfter: number;
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];

/**
 * 허용 목록 브랜드를 차례로 잰다. 꺼짐·목록 비어 있음 → 아무것도 안 한다.
 * deadlineMs: 이 시각(epoch ms) 이후에는 새 브랜드를 시작하지 않는다(남은 브랜드는 다음 날).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: guard chain per brand (flag → cadence → plan → quota) reads top to bottom.
export async function runAeoGoogleAioPilot(args: {
  deadlineMs?: number;
  deps?: AeoPilotDeps;
  /** 함수 마감 직전에 남은 요청을 끊는다(끊긴 질문은 failed·aborted — 분모에서 빠진다). */
  signal?: AbortSignal;
  env?: Env;
  now?: Date;
}): Promise<AeoPilotRunSummary> {
  const env = args.env ?? process.env;
  const cap = aeoPilotMonthlyCap(env);
  const allowlist = aeoPilotAllowlist(env);
  if (!isAeoPilotEnabled(env) || allowlist.length === 0) {
    return { enabled: false, brands: [], monthlyCap: cap, monthlyUsedAfter: 0 };
  }
  const deps = args.deps ?? liveAeoPilotDeps;
  const now = args.now ?? new Date();
  const outcomes: AeoPilotBrandOutcome[] = [];
  let used = 0;
  try {
    used = await deps.monthlyRequests(kstMonthStart(now));
    const brands = (await deps.listBrands(allowlist)).filter((b) =>
      isAeoPilotBrandAllowed(b, env)
    );
    for (const brand of brands) {
      if (args.deadlineMs && Date.now() > args.deadlineMs) {
        outcomes.push({ brandId: brand.id, status: "deadline" });
        continue;
      }
      try {
        const last = await deps.lastRunAt(brand.id);
        if (
          last &&
          now.getTime() - last.getTime() < AEO_PILOT_MIN_DAYS * DAY_MS
        ) {
          outcomes.push({ brandId: brand.id, status: "too_soon" });
          continue;
        }
        const source = await deps.latestShadowSource(
          brand.id,
          new Date(now.getTime() - SOURCE_SETTLE_MS)
        );
        if (!source) {
          outcomes.push({ brandId: brand.id, status: "no_plan" });
          continue;
        }
        const questions = selectAeoPilotQuestions(source.shadowPlanV2);
        if (questions.length === 0) {
          outcomes.push({ brandId: brand.id, status: "no_questions" });
          continue;
        }
        if (used + questions.length > cap) {
          log.warn("aeo.google_aio_pilot.quota_stop", {
            brandId: brand.id,
            used,
            planned: questions.length,
            cap,
          });
          outcomes.push({ brandId: brand.id, status: "quota" });
          // 상한에 닿으면 이번 달은 더 돌지 않는다.
          break;
        }
        const run = await measureAeoPilotBrand({
          brand: {
            id: brand.id,
            domain: brand.domain,
            names: [brand.name, ...stringList(brand.entityVariants)],
          },
          questions,
          monthlyUsed: used,
          sourceAuditJobId: source.auditJobId,
          fetchAio: deps.fetchAio,
          env,
          now,
          signal: args.signal,
        });
        used += run.cost.requestsAttempted;
        await deps.appendRun(source.auditJobId, run);
        log.info("aeo.google_aio_pilot.measured", {
          brandId: brand.id,
          questions: questions.length,
          credits: run.cost.credits,
          kr: run.summary.KR?.showRate ?? null,
          us: run.summary.US?.showRate ?? null,
        });
        outcomes.push({
          brandId: brand.id,
          status: "measured",
          questions: questions.length,
          credits: run.cost.credits,
        });
      } catch (error) {
        log.warn("aeo.google_aio_pilot.brand_failed", {
          brandId: brand.id,
          error: error instanceof Error ? error.name : "unknown",
        });
        outcomes.push({ brandId: brand.id, status: "error" });
      }
    }
  } catch (error) {
    log.warn("aeo.google_aio_pilot.failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  return {
    enabled: true,
    brands: outcomes,
    monthlyCap: cap,
    monthlyUsedAfter: used,
  };
}

// ── DB(실제) — JSON 키만 쓴다, 마이그레이션 없음 ─────────────────────
export const liveAeoPilotDeps: AeoPilotDeps = {
  fetchAio: fetchGoogleAio,
  listBrands: async (allowlist) => {
    const domains = allowlist.map(normalizePilotDomain);
    const rows = await database.brand.findMany({
      where: {
        // 내부 조직(영업 전용) 브랜드는 정기 파일럿 대상이 아니다(같은 도메인이어도).
        ...brandNotInInternalOrg,
        OR: [
          { id: { in: [...allowlist] } },
          { domain: { in: domains } },
          { domain: { in: domains.map((d) => `www.${d}`) } },
        ],
      },
      select: { id: true, name: true, domain: true, entityVariants: true },
      take: 10,
    });
    return rows;
  },
  monthlyRequests: async (since) => {
    const rows = (await database.$queryRawUnsafe(
      `SELECT COALESCE(SUM((run->'cost'->>'requestsAttempted')::int), 0)::int AS "used"
         FROM "AuditJob" j,
              jsonb_array_elements(j."result"->'aeoPilotRuns') AS run
        WHERE j."result" ? 'aeoPilotRuns'
          AND (run->>'measuredAt')::timestamptz >= $1`,
      since
    )) as Array<{ used: number | null }>;
    return Number(rows[0]?.used ?? 0);
  },
  lastRunAt: async (brandId) => {
    const rows = (await database.$queryRawUnsafe(
      `SELECT MAX((run->>'measuredAt')::timestamptz) AS "last"
         FROM "AuditJob" j,
              jsonb_array_elements(j."result"->'aeoPilotRuns') AS run
        WHERE j."brandId" = $1
          AND j."result" ? 'aeoPilotRuns'`,
      brandId
    )) as Array<{ last: Date | string | null }>;
    const last = rows[0]?.last;
    return last ? new Date(last) : null;
  },
  latestShadowSource: async (brandId, settledBefore) => {
    const rows = (await database.$queryRawUnsafe(
      `SELECT "id", "result"->'shadowPlanV2' AS "shadowPlanV2"
         FROM "AuditJob"
        WHERE "brandId" = $1
          AND "status" = 'completed'
          AND "completedAt" <= $2
          AND "result"->'shadowPlanV2' IS NOT NULL
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      brandId,
      settledBefore
    )) as Array<{ id: string; shadowPlanV2: unknown }>;
    const row = rows[0];
    return row ? { auditJobId: row.id, shadowPlanV2: row.shadowPlanV2 } : null;
  },
  appendRun: async (auditJobId, run) => {
    // 원자적 덧붙이기 — 다른 키는 건드리지 않는다.
    await database.$executeRawUnsafe(
      `UPDATE "AuditJob"
          SET "result" = jsonb_set(
                "result",
                '{aeoPilotRuns}',
                COALESCE("result"->'aeoPilotRuns', '[]'::jsonb) || jsonb_build_array($1::jsonb)
              )
        WHERE "id" = $2
          AND "status" = 'completed'
          AND jsonb_typeof("result") = 'object'`,
      JSON.stringify(run),
      auditJobId
    );
  },
};
