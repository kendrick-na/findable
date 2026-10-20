/**
 * 교차 통합 시험(최소판, 프록시 지표): 고정 저장 회차 → aggregateRepeats(S1) → pairComparison(S1) →
 * assembleEvidenceSheet(S2) → 읽기 전용 MCP 응답(S3)까지 한 경로로 이어 붙여,
 * 같은 입력에서 같은 숫자가 나오는지와 「비교 불가·확인 불가」가 끝까지 전파되는지만 본다.
 * 계산·표기 규칙이 깨지지 않았는지만 보며, GEO 효과나 판정 정확도의 증거가 아니다.
 * 입력은 전부 가짜(익명)이고 외부 호출·실제 DB 는 없다.
 * @vitest-environment node
 */
import { assembleEvidenceSheet } from "@repo/audit/evidence-sheet";
import { pairComparison } from "@repo/audit/paired-comparison";
import {
  aggregateRepeats,
  normalizeQuestionText,
  type StoredRun,
} from "@repo/audit/repeat-aggregate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAND_ID,
  makeJob,
  makeResult,
  makeWatchedDb,
  rpc,
} from "./mcp-geo-fixtures";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@repo/database", () => ({
  Prisma: {},
  database: new Proxy(
    {},
    { get: (_t, prop) => (holder.db as Record<string, unknown>)[String(prop)] }
  ),
}));
vi.mock("@repo/audit/runner", () => ({ runAuditJob: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

type Row = Record<string, unknown>;

const MIN_REPEATS = 3; // 사전 등록 값 자리(임시) — MCP 기본값과 같다
const ENGINES = ["chatgpt", "claude", "perplexity", "gemini"];
const QUESTIONS = ["질문 A", "질문 B", "질문 C"];

// 칸(엔진×질문) 노출률은 0 또는 1 이다. 손계산:
//   처방군 = 질문 A(4칸): 전 0 → 후 1 → 변화 +1 ×4
//   대조군 = 질문 B(4칸): 전 1 → 후 1 → 변화 0 ×4   → 차이 = 1 − 0 = 1
//   질문 C 는 배정하지 않아 짝을 만들지 않는다.
const BEFORE_CONFIRMED = new Set(ENGINES.map((e) => `${e}|질문 B`));
const AFTER_CONFIRMED = new Set(
  ENGINES.flatMap((e) => [`${e}|질문 A`, `${e}|질문 B`])
);

function rowsFor(confirmed: ReadonlySet<string>, withError = false): Row[] {
  const rows: Row[] = ENGINES.flatMap((engineId) =>
    QUESTIONS.map((q) => {
      const yes = confirmed.has(`${engineId}|${q}`);
      return {
        engineId,
        promptKind: "brand",
        promptLang: "ko",
        promptText: q,
        brandMentioned: yes,
        mentionQuality: yes ? "confirmed" : undefined,
        errorMessage: null,
        isStub: false,
        citedSources: [],
      };
    })
  );
  if (withError) {
    rows.push({
      engineId: "chatgpt",
      promptKind: "brand",
      promptLang: "ko",
      promptText: "질문 D",
      errorMessage: "engine failed",
      isStub: false,
      citedSources: [],
    });
  }
  return rows;
}

function jobsOf(
  prefix: string,
  days: string[],
  confirmed: ReadonlySet<string>,
  withError = false
) {
  return days.map((day, i) =>
    makeJob(makeResult(rowsFor(confirmed, withError)), {
      id: `${prefix}-${i + 1}`,
      completedAt: `2026-10-${day}T01:00:00.000Z`,
    })
  );
}

function storedRuns(jobs: ReturnType<typeof makeJob>[]): StoredRun[] {
  return jobs.map((j) => ({
    completed_at: j.completedAt,
    job_id: j.id,
    result: j.result,
  }));
}

const OPTIONS = {
  is_publishable: () => true, // 게시 가능 판정은 MCP 쪽에서 실제 규칙으로 따로 확인한다
  min_repeats: MIN_REPEATS,
  suppression_threshold: null,
};

const ASSIGNMENT = {
  [normalizeQuestionText("질문 A")]: "treated",
  [normalizeQuestionText("질문 B")]: "control",
} as const;

function pairOf(
  before: ReturnType<typeof aggregateRepeats>,
  after: ReturnType<typeof aggregateRepeats>
) {
  return pairComparison({
    after: after.cohorts[0] ?? null,
    assignment: ASSIGNMENT,
    before: before.cohorts[0] ?? null,
    collection_shift_limit: 0.2,
    min_pairs_required: 4,
    min_repeats: MIN_REPEATS,
    prereg_id: "test-prereg",
  });
}

async function mcpSummary() {
  const out = await rpc("tools/call", {
    name: "get_brand_measurement_summary",
    arguments: { brand_id: BRAND_ID },
  });
  return out.body.result.structuredContent as Record<string, any>;
}

function setJobs(jobs: ReturnType<typeof makeJob>[]) {
  const latestFirst = [...jobs].reverse();
  holder.db = makeWatchedDb({
    brand: { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
    job: latestFirst[0] ?? null,
    jobs: latestFirst,
  }).db;
}

const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
});
afterEach(() => vi.unstubAllEnvs());

function sheetFrom(
  after: ReturnType<typeof aggregateRepeats>,
  pair: ReturnType<typeof pairOf>,
  mcp: Record<string, any>
) {
  const cohort = after.cohorts[0];
  if (!cohort) {
    throw new Error("cohort missing");
  }
  return assembleEvidenceSheet({
    as_of: "2026-10-27",
    before_after: { as_of: "2026-10-27", status: "known", value: pair },
    brand_ref: { brand_id: BRAND_ID, display_name: "시험브랜드" },
    language: cohort.cohort.language,
    limits: { limits_en: mcp.limits_en, limits_ko: mcp.limits_ko },
    min_repeats: MIN_REPEATS,
    observed: cohort.observed.ai_brand,
    ui_language: "ko",
    unmeasured: mcp.evidence.unmeasured,
  });
}

describe("교차 통합: 반복 3회 이상이면 같은 숫자가 끝까지 이어진다", () => {
  it("집계 → 짝짓기 → 증거 한 장 → MCP 응답의 숫자가 일치한다", async () => {
    const before = jobsOf("b", ["20", "21", "22"], BEFORE_CONFIRMED);
    const after = jobsOf("a", ["25", "26", "27"], AFTER_CONFIRMED);
    const beforeAgg = aggregateRepeats(storedRuns(before), OPTIONS);
    const afterAgg = aggregateRepeats(storedRuns(after), OPTIONS);
    expect(afterAgg.cohorts).toHaveLength(1);
    expect(afterAgg.cohorts[0]?.comparable).toBe(true);

    // S1: 전후 짝짓기 — 손계산(+1 / 0 → 차이 1)과 같다
    const pair = pairOf(beforeAgg, afterAgg);
    expect(pair.not_comparable).toBeNull();
    expect(pair.treated.mean_delta).toBeCloseTo(1, 12);
    expect(pair.control.mean_delta).toBeCloseTo(0, 12);
    expect(pair.difference).toBeCloseTo(1, 12);

    // S3: 같은 후 회차를 MCP 로 읽는다(저장 회차는 같은 입력)
    setJobs(after);
    const mcp = await mcpSummary();
    expect(mcp.status).toBe("ok");

    // S2: MCP 의 측정하지 못한 이유까지 받아 증거 한 장을 조립한다
    const sheet = sheetFrom(afterAgg, pair, mcp);
    expect(sheet.finding_kind).toBe("observed");

    // 숫자 일치: 칸 12개 중 8칸 확인(0.667), 판정이 끝난 36건 중 24건
    const sheetObs = sheet.envelope.observed;
    const mcpObs = asJson(mcp.evidence.observed);
    expect(sheetObs.status).toBe("known");
    expect(mcpObs.status).toBe("known");
    expect(mcpObs.value.exposure_count).toBe(24);
    expect(mcpObs.value.denominator).toBe(36);
    expect(asJson(sheetObs)).toEqual(mcpObs);
    expect(mcp.data.exposure_rate).toBeCloseTo(24 / 36, 12);
    expect(mcpObs.value.interval.status).toBe("known");
  });
});

describe("교차 통합: 비교 불가·확인 불가가 끝까지 전파된다", () => {
  it("반복이 2회뿐이면 짝짓기·증거 한 장·MCP 구간이 모두 「비교 불가/확인 불가」이고 0 이 아니다", async () => {
    const before = jobsOf("b", ["20", "21", "22"], BEFORE_CONFIRMED);
    const after = jobsOf("a", ["26", "27"], AFTER_CONFIRMED, true);
    const beforeAgg = aggregateRepeats(storedRuns(before), OPTIONS);
    const afterAgg = aggregateRepeats(storedRuns(after), OPTIONS);
    expect(afterAgg.cohorts[0]?.comparable).toBe(false);

    const pair = pairOf(beforeAgg, afterAgg);
    expect(pair.not_comparable).not.toBeNull();
    expect(pair.difference).toBeNull();
    expect(pair.treated.mean_delta).toBeNull();

    setJobs(after);
    const mcp = await mcpSummary();
    expect(mcp.status).toBe("ok");
    expect(mcp.evidence.observed.value.interval).toMatchObject({
      reason: "insufficient_sample",
      status: "unavailable",
    });
    // 측정하지 못한 답(엔진 오류 1건)은 사유 표에 남고 분모(판정이 끝난 답)에는 들어가지 않는다. 반복이 모자라 묶지 않으므로 최신 1회(12건)만 본다.
    const gap = mcp.evidence.unmeasured.find(
      (u: Record<string, unknown>) => u.code === "engine_error"
    );
    expect(gap).toMatchObject({ count: 1 });
    expect(mcp.evidence.observed.value.denominator).toBe(12);

    const sheet = sheetFrom(afterAgg, pair, mcp);
    expect(sheet.finding_kind).toBe("not_comparable");
    expect(sheet.before_after).toMatchObject({ status: "known" });
    const comparison = sheet.envelope.comparison;
    expect(comparison?.status).toBe("known");
    if (comparison?.status === "known") {
      expect(comparison.value.difference).toBeNull();
    }
  });

  it("질문 언어 기록이 없는 회차는 집계에서 빠지고 MCP 도 숫자 없이 확인 불가로 답한다", async () => {
    const rows = rowsFor(AFTER_CONFIRMED).map(
      ({ promptLang: _drop, ...rest }) => rest
    );
    const jobs = ["25", "26", "27"].map((day, i) =>
      makeJob(makeResult(rows), {
        id: `nl-${i + 1}`,
        completedAt: `2026-10-${day}T01:00:00.000Z`,
      })
    );
    const agg = aggregateRepeats(storedRuns(jobs), OPTIONS);
    expect(agg.cohorts).toHaveLength(0);
    expect(agg.excluded_runs.map((r) => r.reason)).toEqual([
      "not_recorded",
      "not_recorded",
      "not_recorded",
    ]);
    setJobs(jobs);
    const mcp = await mcpSummary();
    expect(mcp.status).toBe("unverifiable");
    expect(mcp.reason).toBe("not_recorded");
    expect(mcp.data).toBeNull();
  });
});

describe("교차 통합: 분류 도구 경로와 게시 불가 전파", () => {
  it("get_answer_verdict_breakdown 의 분류 건수·구간이 집계 결과와 같다", async () => {
    const after = jobsOf("a", ["25", "26", "27"], AFTER_CONFIRMED);
    const afterAgg = aggregateRepeats(storedRuns(after), OPTIONS);
    const observed = afterAgg.cohorts[0]?.observed.ai_brand;
    expect(observed?.status).toBe("known");
    setJobs(after);
    const out = await rpc("tools/call", {
      name: "get_answer_verdict_breakdown",
      arguments: { brand_id: BRAND_ID },
    });
    const brk = out.body.result.structuredContent as Record<string, any>;
    expect(brk.status).toBe("ok");
    if (observed?.status === "known") {
      expect(brk.data.groups.ai_brand.buckets).toEqual(observed.value.buckets);
      expect(brk.data.groups.ai_brand.adjudicated).toBe(
        observed.value.denominator
      );
      expect(asJson(brk.evidence.observed)).toEqual(asJson(observed));
    }
    // 손계산: 36건 중 확인 24건
    expect(brk.data.groups.ai_brand.buckets.confirmed).toBe(24);
  });

  it("게시 불가 회차는 집계에서 숫자를 내지 않고 MCP 도 숫자 없이 확인 불가로 답한다(0 아님)", async () => {
    // 실제 게시 기준(기본 is_publishable)을 쓴다: 답변 4건뿐인 회차는 게시 불가.
    const few = rowsFor(AFTER_CONFIRMED).slice(0, 4);
    const jobs = ["25", "26", "27"].map((day, i) =>
      makeJob(makeResult(few), {
        id: `few-${i + 1}`,
        completedAt: `2026-10-${day}T01:00:00.000Z`,
      })
    );
    const agg = aggregateRepeats(storedRuns(jobs), {
      min_repeats: MIN_REPEATS,
      suppression_threshold: null,
    });
    const cohort = agg.cohorts[0];
    expect(cohort?.repeat_count).toBe(0);
    expect(cohort?.comparable).toBe(false);
    expect(cohort?.observed.ai_brand).toMatchObject({
      reason: "withheld_not_publishable",
      status: "unavailable",
    });
    setJobs(jobs);
    const mcp = await mcpSummary();
    expect(mcp.status).toBe("unverifiable");
    expect(mcp.reason).toBe("withheld_not_publishable");
    expect(mcp.data).toBeNull();
    // 증거 한 장도 숫자 없이 비교 불가로 조립된다.
    if (cohort) {
      const sheet = assembleEvidenceSheet({
        as_of: "2026-10-27",
        before_after: null,
        brand_ref: { brand_id: BRAND_ID, display_name: "시험브랜드" },
        language: cohort.cohort.language,
        limits: { limits_en: mcp.limits_en, limits_ko: mcp.limits_ko },
        min_repeats: MIN_REPEATS,
        observed: cohort.observed.ai_brand,
        ui_language: "ko",
        unmeasured: [],
      });
      expect(sheet.finding_kind).toBe("not_comparable");
      expect(sheet.envelope.observed.status).toBe("unavailable");
    }
  });
});
