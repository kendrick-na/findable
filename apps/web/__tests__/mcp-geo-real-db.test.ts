/**
 * 읽기 전용 MCP 실DB 통합시험 — 모의 DB 없이 진짜 Prisma 클라이언트로 POST /api/mcp 를 부른다.
 *
 * 켜는 법: 환경변수 TEST_DATABASE_URL 에 「시험용 Postgres 주소」를 준다(Prisma 스키마가 이미 적용된 DB).
 * 없으면 이 파일 전체가 「건너뜀」으로 표시된다(DB 없음). 방법은 docs/_적용/geo-입구/통합시험_실DB_방법.md.
 *
 * 안전장치
 *  - 운영 DB 로 보이는 주소(supabase 호스트·이름에 prod/production)는 시험이 시작 전에 거부한다.
 *  - 시험이 넣는 행은 이 파일이 만든 고유 ID 뿐이며 끝나면 지운다(남의 행은 건드리지 않는다).
 *  - 도구 호출 구간에서 쓰기가 0임은 「전 테이블 행 수 + Brand·AuditJob 내용 해시」 전후 비교로 확인한다.
 * 외부 호출(AI 엔진·사이트 접속)은 없다. check_official_facts 는 이 시험의 대상이 아니다(토큰 꺼짐 → 미등록).
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { allKeys, FIXTURE_ROWS, makeResult, rpc } from "./mcp-geo-fixtures";

const TEST_URL = (process.env.TEST_DATABASE_URL ?? "").trim();
const HAS_DB = TEST_URL !== "";

/** 운영 DB 로 보이면 이유를 돌려준다(시험용 DB 라는 보증은 아니며, 명백한 실수만 막는 최소 안전장치). */
function looksLikeProduction(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "주소 형식이 올바르지 않습니다.";
  }
  if (/supabase\.(co|com)$/i.test(parsed.hostname)) {
    return "supabase 호스트(운영 DB 후보)입니다.";
  }
  if (/prod/i.test(parsed.pathname) || /prod/i.test(parsed.hostname)) {
    return "주소에 prod 가 들어 있습니다.";
  }
  const live = process.env.FINDABLE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (
    live &&
    live === url &&
    !/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)
  ) {
    return "현재 앱이 쓰는 DB 주소와 같습니다.";
  }
  return null;
}

const MAX_BYTES = 64 * 1024;

const ORG_ID = randomUUID();
const ids = {
  allowed: randomUUID(), // 허용 목록 안·결과 있음
  outside: randomUUID(), // DB 에는 있고 허용 목록 밖
  empty: randomUUID(), // 허용 목록 안·완료 회차 없음
  allError: randomUUID(), // 허용 목록 안·전부 측정 실패
  manyUrls: randomUUID(), // 허용 목록 안·출처 주소 61개
  missing: randomUUID(), // DB 에 없음(허용 목록 안)
};
const createdJobIds: string[] = [];

type Db = typeof import("@repo/database").database;
let db: Db;

const TABLE_SQL = `select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;

/** 전 테이블 행 수 + Brand·AuditJob 내용 해시. 이 값이 호출 전후 같으면 쓰기(추가·삭제·수정)가 없었다. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(TABLE_SQL);
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int as n from "${table_name}"`
    );
    out[table_name] = String(rows[0]?.n ?? "?");
  }
  for (const name of ["Brand", "AuditJob"]) {
    const rows = await db.$queryRawUnsafe<{ h: string | null }[]>(
      `select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as h from "${name}" t`
    );
    out[`${name}#hash`] = rows[0]?.h ?? "";
  }
  return out;
}

async function call(name: string, brand_id: string) {
  const out = await rpc("tools/call", { name, arguments: { brand_id } });
  const result = out.body.result as Record<string, any>;
  const text: string = result.content?.[0]?.text ?? "";
  return {
    result,
    bytes: Buffer.byteLength(text, "utf8"),
    structured: result.structuredContent as Record<string, any> | undefined,
  };
}

function citedRows(urls: string[]) {
  return (FIXTURE_ROWS as Record<string, unknown>[]).map((r, i) =>
    i === 0
      ? {
          ...r,
          usage: { webSearchRequests: 1 },
          citedSources: urls.map((url) => ({ url })),
        }
      : r
  );
}

describe.skipIf(!HAS_DB)("읽기 전용 MCP — 실제 DB(Prisma) 통합", () => {
  beforeAll(async () => {
    const reason = looksLikeProduction(TEST_URL);
    if (reason) {
      throw new Error(`TEST_DATABASE_URL 거부: ${reason}`);
    }
    vi.resetModules();
    // 앱 코드와 같은 경로(@repo/database)가 이 주소를 읽는다. 값은 출력하지 않는다.
    vi.stubEnv("FINDABLE_DATABASE_URL", TEST_URL);
    vi.stubEnv("DATABASE_URL", TEST_URL);
    vi.stubEnv("FINDABLE_MCP_ENABLED", "true");
    vi.stubEnv("FINDABLE_MCP_READONLY_MODE_ENABLED", "true");
    vi.stubEnv(
      "FINDABLE_MCP_READONLY_BRAND_ALLOWLIST",
      [ids.allowed, ids.empty, ids.allError, ids.manyUrls, ids.missing].join(
        ","
      )
    );
    ({ database: db } = await import("@repo/database"));

    await db.organization.create({
      data: { id: ORG_ID, name: "통합시험 조직", ownerId: `test_${ORG_ID}` },
    });
    const mkBrand = (id: string, name: string, domain: string) =>
      db.brand.create({
        data: {
          id,
          organizationId: ORG_ID,
          name,
          domain,
          // 응답에 새면 안 되는 값들
          legalName: "비공개법인명(주)",
          businessNumber: "123-45-67890",
        },
      });
    await mkBrand(ids.allowed, "실DB시험브랜드", "brand.example");
    await mkBrand(ids.outside, "남의브랜드", "other.example");
    await mkBrand(ids.empty, "결과없음브랜드", "empty.example");
    await mkBrand(ids.allError, "전부실패브랜드", "err.example");
    await mkBrand(ids.manyUrls, "주소많은브랜드", "many.example");

    const mkJob = async (
      brandId: string,
      domain: string,
      result: unknown,
      completedAt = "2026-10-20T01:00:00.000Z"
    ) => {
      const id = randomUUID();
      createdJobIds.push(id);
      await db.auditJob.create({
        data: {
          id,
          email: "seed@example.invalid",
          domain,
          status: "completed",
          brandId,
          organizationId: ORG_ID,
          createdAt: new Date(Date.parse(completedAt) - 5 * 60_000),
          completedAt: new Date(completedAt),
          result: result as never,
        },
      });
    };
    await mkJob(ids.allowed, "brand.example", makeResult());
    await mkJob(ids.outside, "other.example", makeResult());
    await mkJob(
      ids.allError,
      "err.example",
      makeResult(
        (FIXTURE_ROWS as Record<string, unknown>[])
          .filter((r) => r.engineId !== "naver")
          .map((r) => ({ ...r, errorMessage: "engine failed" }))
      )
    );
    await mkJob(
      ids.manyUrls,
      "many.example",
      makeResult(
        citedRows([
          `https://long.example/${"x".repeat(300)}`,
          ...Array.from({ length: 60 }, (_v, i) => `https://s.example/p${i}`),
        ])
      )
    );
  });

  afterAll(async () => {
    if (db) {
      await db.auditJob.deleteMany({ where: { id: { in: createdJobIds } } });
      await db.brand.deleteMany({ where: { organizationId: ORG_ID } });
      await db.organization.deleteMany({ where: { id: ORG_ID } });
      await db.$disconnect();
    }
    vi.unstubAllEnvs();
  });

  it("실제 Prisma 클라이언트가 시험 DB 로 붙어 있다(모의가 아님)", async () => {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int as n from "Brand" where id = '${ids.allowed}'`
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("허용 목록 밖 브랜드와 DB 에 없는 브랜드는 같은 not_available 이고 이름이 새지 않는다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      const outside = await call(name, ids.outside); // DB 에 있으나 목록 밖
      const missing = await call(name, ids.missing); // 목록 안이나 DB 에 없음
      const absentAndOutside = await call(name, randomUUID()); // 둘 다 아님
      for (const r of [outside, missing, absentAndOutside]) {
        expect(r.result.isError).toBe(true);
      }
      const a = JSON.parse(outside.result.content[0].text);
      const b = JSON.parse(missing.result.content[0].text);
      expect(a).toEqual(b);
      expect(a.error.code).toBe("not_available");
      expect(JSON.stringify(a)).not.toContain("남의브랜드");
    }
  });

  it("저장 결과 요약: 분모·노출률이 손으로 센 값(5/11)과 같다", async () => {
    // 고정 입력 12행: 제대로 5 · 다른 회사 1 · 모름 5 · 실패 1 → 판정이 끝난 11건 중 5건
    const { structured, result } = await call(
      "get_brand_measurement_summary",
      ids.allowed
    );
    expect(result.isError).not.toBe(true);
    expect(structured?.status).toBe("ok");
    expect(structured?.data.brand_name).toBe("실DB시험브랜드");
    expect(structured?.data.exposure_denominator).toBe(11);
    expect(structured?.data.exposure_rate).toBeCloseTo(5 / 11, 12);
    expect(structured?.evidence.observed.value.buckets).toEqual({
      confirmed: 5,
      different_entity: 1,
      unknown: 5,
      engine_error: 1,
      unverified: 0,
    });
    // 측정 실패 1건은 0 이 아니라 「측정하지 못한 이유」 표에 건수로 남는다.
    expect(
      structured?.evidence.unmeasured.find(
        (u: { code: string }) => u.code === "engine_error"
      )
    ).toMatchObject({ count: 1 });
    // 반복이 1회뿐이라 신뢰구간은 0 이 아니라 확인 불가.
    expect(structured?.evidence.observed.value.interval).toMatchObject({
      status: "unavailable",
      reason: "insufficient_sample",
    });
  });

  it("분포 응답: 5분류 건수·분모(판정 끝난 답변)·측정 실패는 비율에서 제외", async () => {
    const { structured } = await call(
      "get_answer_verdict_breakdown",
      ids.allowed
    );
    const g = structured?.data.groups.ai_brand;
    expect(g.buckets).toEqual({
      confirmed: 5,
      different_entity: 1,
      unknown: 5,
      engine_error: 1,
      unverified: 0,
    });
    expect(g.adjudicated).toBe(11);
    expect(g.total).toBe(12);
    expect(g.rates.confirmed).toBeCloseTo(5 / 11, 12);
    expect(Object.keys(g.rates).sort()).toEqual([
      "confirmed",
      "different_entity",
      "unknown",
    ]);
  });

  it("확인 불가: 완료 회차가 없으면 거부가 아니라 unverifiable, 전부 실패면 숫자를 내지 않는다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      for (const id of [ids.empty, ids.allError]) {
        const { structured, result } = await call(name, id);
        expect(result.isError).not.toBe(true);
        expect(structured?.status).toBe("unverifiable");
        // 숫자 0 으로 위장하지 않는다.
        expect(structured?.data?.exposure_rate ?? null).toBeNull();
      }
    }
  });

  it("비공개 정보(법인명·사업자번호·이메일·원문)가 어떤 응답에도 없다", async () => {
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      const { result, structured } = await call(name, ids.allowed);
      const text = JSON.stringify(result);
      expect(text).not.toContain("비공개법인명");
      expect(text).not.toContain("123-45-67890");
      expect(text).not.toContain("000-00-00000"); // 답변 원문 안의 번호
      expect(text).not.toContain("seed@example.invalid");
      expect(text).not.toContain("원문 전체");
      const keys = allKeys(structured);
      for (const forbidden of [
        "rawResponse",
        "businessNumber",
        "legalName",
        "email",
        "ipAddress",
      ]) {
        expect(keys.has(forbidden)).toBe(false);
      }
    }
  });

  it("DB 쓰기 0: 모든 도구·모든 경로 호출 전후로 전 테이블 행 수와 Brand·AuditJob 내용이 같다", async () => {
    const before = await snapshot();
    const list = await rpc("tools/list");
    const toolNames = (list.body.result.tools as { name: string }[]).map(
      (t) => t.name
    );
    expect(toolNames).not.toContain("start_ai_visibility_check");
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      for (const id of Object.values(ids)) {
        await call(name, id);
      }
    }
    // 측정 시작 도구를 이름으로 불러도 없는 도구이며 DB 는 그대로.
    await rpc("tools/call", {
      name: "start_ai_visibility_check",
      arguments: { url: "brand.example" },
    });
    const after = await snapshot();
    expect(after).toEqual(before);
  });

  it("점검 장치 자체 확인: 일부러 한 줄 고치면 전후 비교가 달라진다(쓰기 감지가 살아 있음)", async () => {
    const before = await snapshot();
    await db.brand.update({
      where: { id: ids.outside },
      data: { name: "남의브랜드(수정)" },
    });
    const after = await snapshot();
    await db.brand.update({
      where: { id: ids.outside },
      data: { name: "남의브랜드" },
    });
    expect(after["Brand#hash"]).not.toBe(before["Brand#hash"]);
  });

  it("응답 크기 상한: 출처 주소 61개 입력은 50개로 줄고 truncated 표시, 모든 응답이 64KB 이하", async () => {
    const { structured, bytes } = await call(
      "get_brand_measurement_summary",
      ids.manyUrls
    );
    const urls: string[] = structured?.evidence.retrieval.value.source_urls;
    expect(urls).toHaveLength(50);
    expect(urls.every((u) => u.length <= 300)).toBe(true);
    expect(structured?.truncation).toEqual({
      source_urls_returned: 50,
      source_urls_total: 61,
      truncated: true,
    });
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
    for (const name of [
      "get_brand_measurement_summary",
      "get_answer_verdict_breakdown",
    ]) {
      for (const id of Object.values(ids)) {
        expect((await call(name, id)).bytes).toBeLessThanOrEqual(MAX_BYTES);
      }
    }
  });
});

// DB 가 없을 때도 항상 도는 가벼운 시험: 안전장치 자체와 「건너뜀」 표시.
describe("실DB 통합시험 안전장치", () => {
  it("운영 DB 로 보이는 주소는 거부한다", () => {
    expect(
      looksLikeProduction("postgresql://u:p@db.abc.supabase.co/postgres")
    ).not.toBeNull();
    expect(
      looksLikeProduction("postgresql://u:p@h.example/findable-prod")
    ).not.toBeNull();
    expect(looksLikeProduction("not a url")).not.toBeNull();
    expect(
      looksLikeProduction("postgresql://test@127.0.0.1:54329/mcp_test")
    ).toBeNull();
  });

  it.skipIf(HAS_DB)(
    "TEST_DATABASE_URL 이 없으면 실DB 시험은 건너뜀(DB 없음)",
    () => {
      expect(HAS_DB).toBe(false);
    }
  );
});
