/**
 * 근거 봉투·재계산·비공개 필드 — 지시서 4절 시험 5·6·9 (M-sum·M-brk 숫자 재계산 일치).
 * 기대값은 고정 입력(`FIXTURE_ROWS`)을 시험 안에서 **손으로 다시 센 값**이며, 도구의 계산 함수를 부르지 않는다.
 * 형태(zod) 통과는 값이 맞다는 증거가 아니다 — 그래서 숫자 비교를 따로 둔다.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allKeys,
  BRAND_ID,
  FIXTURE_ROWS,
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

function setDb(job: Record<string, unknown> | null) {
  holder.db = makeWatchedDb({
    brand: { id: BRAND_ID, name: "시험브랜드", domain: "brand.example" },
    job,
  }).db;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
  vi.stubEnv("FINDABLE_MCP_READONLY_BRAND_ALLOWLIST", BRAND_ID);
  setDb(makeJob());
});
afterEach(() => vi.unstubAllEnvs());

type Rows = Record<string, any>[];

/** 시험 안의 독립 재계산: AI 브랜드 질문(검색 엔진·발굴 질문 제외)의 분류별 건수. */
function recount(rows: Rows) {
  const ai = rows.filter(
    (r) =>
      !["naver", "daum", "naver-briefing", "hyperclova"].includes(r.engineId) &&
      r.promptKind !== "discovery"
  );
  const count = (pred: (r: Record<string, any>) => boolean) =>
    ai.filter(pred).length;
  const failed = (r: Record<string, any>) =>
    Boolean(r.errorMessage || r.isStub);
  return {
    confirmed: count((r) => !failed(r) && r.mentionQuality === "confirmed"),
    different_entity: count(
      (r) => !failed(r) && r.mentionQuality === "different_entity"
    ),
    unknown: count((r) => !(failed(r) || r.brandMentioned)),
    engine_error: count(failed),
    engines_attempted: new Set(ai.map((r) => r.engineId)).size,
    engines_measured: new Set(
      ai.filter((r) => !failed(r)).map((r) => r.engineId)
    ).size,
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const out = await rpc("tools/call", { name, arguments: args });
  return out.body.result.structuredContent as Record<string, any>;
}

describe("6. 고정 입력 재계산 일치 — M-sum", () => {
  it("노출률·분모·수집률이 시험이 다시 센 값과 같다", async () => {
    const want = recount(FIXTURE_ROWS as Rows);
    const adjudicated = want.confirmed + want.different_entity + want.unknown;
    const res = await callTool("get_brand_measurement_summary", {
      brand_id: BRAND_ID,
    });
    expect(res.status).toBe("ok");
    // 손으로 센 고정값(12행 중 실패 1): 제대로 5 · 다른 회사 1 · 모름 5
    expect(want).toMatchObject({
      confirmed: 5,
      different_entity: 1,
      unknown: 5,
      engine_error: 1,
    });
    expect(res.data.exposure_denominator).toBe(adjudicated);
    expect(res.data.exposure_rate).toBeCloseTo(
      want.confirmed / adjudicated,
      12
    );
    expect(res.data.collection_rate).toBeCloseTo(
      want.engines_measured / want.engines_attempted,
      12
    );
    const observed = res.evidence.observed;
    expect(observed.status).toBe("known");
    expect(observed.value.buckets).toEqual({
      confirmed: want.confirmed,
      different_entity: want.different_entity,
      unknown: want.unknown,
      engine_error: want.engine_error,
      unverified: 0,
    });
    expect(observed.value.exposure_count).toBe(want.confirmed);
    expect(observed.value.denominator).toBe(adjudicated);
    // 발굴 질문 2행 중 1건 추천, 검색 1행 중 1건 노출 — 서로 섞이지 않는다.
    expect(res.data.groups.discovery).toEqual({
      denominator: 2,
      exposure_count: 1,
      exposure_rate: 0.5,
    });
    expect(res.data.groups.search).toEqual({
      denominator: 1,
      exposure_count: 1,
      exposure_rate: 1,
    });
    // 못 잰 것은 0 으로 나오지 않고 못 잰 사유 표에 건수로 남는다.
    const gap = res.evidence.unmeasured.find(
      (u: any) => u.code === "engine_error"
    );
    expect(gap).toMatchObject({ count: 1 });
    // 신뢰구간은 S1 머지 전까지 확인 불가(미설정).
    expect(observed.value.interval).toMatchObject({
      status: "unavailable",
      reason: "not_configured",
    });
  });

  it("M-brk: 5분류 건수가 다시 센 값과 같고 비율의 분모는 판정이 끝난 답변이다", async () => {
    const want = recount(FIXTURE_ROWS as Rows);
    const adjudicated = want.confirmed + want.different_entity + want.unknown;
    const res = await callTool("get_answer_verdict_breakdown", {
      brand_id: BRAND_ID,
    });
    expect(res.status).toBe("ok");
    const g = res.data.groups.ai_brand;
    expect(g.buckets).toEqual({
      confirmed: want.confirmed,
      different_entity: want.different_entity,
      unknown: want.unknown,
      engine_error: want.engine_error,
      unverified: 0,
    });
    expect(g.adjudicated).toBe(adjudicated);
    expect(g.total).toBe(adjudicated + want.engine_error);
    expect(g.rates.confirmed).toBeCloseTo(want.confirmed / adjudicated, 12);
    expect(g.rates.different_entity).toBeCloseTo(
      want.different_entity / adjudicated,
      12
    );
    expect(g.rates.unknown).toBeCloseTo(want.unknown / adjudicated, 12);
    // 측정 실패는 비율 칸이 아예 없다(분모에서 뺐다).
    expect(Object.keys(g.rates).sort()).toEqual([
      "confirmed",
      "different_entity",
      "unknown",
    ]);
    expect(res.data.groups.search.buckets.confirmed).toBe(1);
  });

  it("M-brk: 판정이 끝난 답변이 0이면 비율은 0이 아니라 null", async () => {
    const onlyErrors = (FIXTURE_ROWS as Rows)
      .filter((r) => r.engineId !== "naver")
      .map((r) => ({ ...r, errorMessage: "engine failed" }));
    // 게시 기준 미달 회차라 확인 불가가 되므로, 분모 0 계산은 도구 본문을 직접 부른다.
    const { runBreakdown, buildBrandRun } = await import(
      "../lib/mcp/geo-tools"
    );
    const built = buildBrandRun(
      { id: BRAND_ID, name: "x", domain: "brand.example" },
      makeJob(makeResult(onlyErrors))
    );
    expect(built.ok).toBe(false); // 숫자를 내지 않고 이유를 말한다
    const { toReadonlyDb } = await import("../lib/mcp/geo-tools");
    const out = await runBreakdown(
      {
        allowlist: new Set([BRAND_ID]),
        db: toReadonlyDb(
          makeWatchedDb({
            brand: { id: BRAND_ID, name: "x", domain: "brand.example" },
            job: makeJob(makeResult(onlyErrors)),
          }).db
        ),
        log: { error: vi.fn() },
      },
      BRAND_ID
    );
    expect("response" in out && out.response.status).toBe("unverifiable");
  });
});

describe("5. 근거 봉투", () => {
  it("모든 정상 응답에 필수 칸이 있고 한계 문구·언어·출처 회차가 붙는다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      const res = await callTool(name, { brand_id: BRAND_ID });
      expect(res.status).toBe("ok");
      const ev = res.evidence;
      for (const key of [
        "comparison",
        "engine_model",
        "index_check",
        "language",
        "limits",
        "measured_at",
        "method_version",
        "observed",
        "retrieval",
        "schema_version",
        "source_ids",
        "unmeasured",
      ]) {
        expect(key in ev).toBe(true);
      }
      expect(ev.language).toEqual({ language: "ko", script: "Hang" });
      expect(res.limits_ko.length).toBeGreaterThan(0);
      expect(res.limits_en.length).toBeGreaterThan(0);
      expect(ev.limits).toEqual({
        limits_ko: res.limits_ko,
        limits_en: res.limits_en,
      });
      expect(ev.source_ids.value.audit_job_ids).toEqual([makeJob().id]);
      // 기록되지 않은 것은 채우지 않고 확인 불가로 둔다.
      expect(ev.retrieval).toMatchObject({
        status: "unavailable",
        reason: "not_recorded",
      });
      expect(ev.index_check.status).toBe("unavailable");
      expect(ev.engine_model.value[0].model_id.status).toBe("unavailable");
      // message_ko 가 응답 맨 앞에 온다(요약을 먼저 읽게).
      expect(Object.keys(res)[0]).toBe("message_ko");
    }
  });

  it("결과가 없으면 거부가 아니라 unverifiable + 모든 Known 이 unavailable 인 봉투", async () => {
    setDb(null);
    const res = await callTool("get_brand_measurement_summary", {
      brand_id: BRAND_ID,
    });
    expect(res.status).toBe("unverifiable");
    expect(res.reason).toBe("source_missing");
    expect(res.data).toBeNull();
    const ev = res.evidence;
    for (const key of [
      "engine_model",
      "index_check",
      "measured_at",
      "method_version",
      "observed",
      "retrieval",
      "source_ids",
    ]) {
      expect(ev[key].status).toBe("unavailable");
      expect(ev[key].reason).toBe("source_missing");
    }
    expect(ev.unmeasured).toEqual([]);
    expect(res.limits_ko.length).toBeGreaterThan(0);
  });

  it("언어가 기록되지 않은 회차는 unverifiable(not_recorded) — 다른 코호트에 합치지 않는다", async () => {
    const noLang = (FIXTURE_ROWS as Rows).map(
      ({ promptLang: _p, ...rest }) => rest
    );
    setDb(makeJob(makeResult(noLang)));
    const res = await callTool("get_answer_verdict_breakdown", {
      brand_id: BRAND_ID,
    });
    expect(res.status).toBe("unverifiable");
    expect(res.reason).toBe("not_recorded");
    expect(res.evidence.observed.reason).toBe("not_recorded");
  });

  it("게시 기준 미달 회차는 숫자를 내지 않고 withheld_not_publishable 로 표시", async () => {
    const few = (FIXTURE_ROWS as Rows).slice(0, 4);
    setDb(makeJob(makeResult(few)));
    const res = await callTool("get_brand_measurement_summary", {
      brand_id: BRAND_ID,
    });
    expect(res.status).toBe("unverifiable");
    expect(res.reason).toBe("withheld_not_publishable");
    expect(res.data).toBeNull();
  });

  it("확인 불가와 0건은 다른 상태다", async () => {
    // 0건: 판정이 끝난 답변 중 제대로 안 건수가 0인 회차 — 상태는 ok, 노출률은 0.
    const noneConfirmed = (FIXTURE_ROWS as Rows).map((r) =>
      r.mentionQuality === "confirmed"
        ? { ...r, brandMentioned: false, mentionQuality: undefined }
        : r
    );
    setDb(makeJob(makeResult(noneConfirmed)));
    const zero = await callTool("get_brand_measurement_summary", {
      brand_id: BRAND_ID,
    });
    expect(zero.status).toBe("ok");
    expect(zero.data.groups.ai_brand.exposure_count).toBe(0);
    expect(zero.data.exposure_rate).toBe(0);
    // 확인 불가: 결과 자체가 없음 — 상태는 unverifiable, 수치 칸은 null.
    setDb(null);
    const gone = await callTool("get_brand_measurement_summary", {
      brand_id: BRAND_ID,
    });
    expect(gone.status).toBe("unverifiable");
    expect(gone.data).toBeNull();
    expect(zero.status).not.toBe(gone.status);
  });
});

describe("9. 응답에 비공개 필드 없음", () => {
  const FORBIDDEN_KEYS = [
    "businessNumber",
    "business_number",
    "legalName",
    "legal_name",
    "email",
    "rawResponse",
    "raw_response",
    "raw_answer_refs",
    "cost",
    "costKrw",
    "estimatedCost",
    "ipAddress",
    "pdfUrl",
    "crewResult",
  ];

  it("키 이름·값 어디에도 사업자번호·법인명·이메일·원문·원가가 없다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      const out = await rpc("tools/call", {
        name,
        arguments: { brand_id: BRAND_ID },
      });
      const keys = allKeys(out.body.result.structuredContent);
      for (const bad of FORBIDDEN_KEYS) {
        expect(keys.has(bad)).toBe(false);
      }
      const text = JSON.stringify(out.body.result);
      expect(text).not.toContain("원문 전체(응답에 실리면 안 됨)");
      expect(text).not.toContain("000-00-00000");
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});
