/**
 * 도메인 고정 시험 — 허용 목록 「brandId=기대도메인」 쌍과 DB 의 Brand.domain 이 다르면 점검을 거부하고 접속 0.
 * 외부 호출 없음(fetch 는 가짜, 공개 주소 검사는 통과로 바꿔 끼운다).
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRAND_ID,
  makeJob,
  makeWatchedDb,
  OTHER_BRAND_ID,
} from "./mcp-geo-fixtures";

vi.mock("@repo/audit/public-url-security", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@repo/audit/public-url-security")>();
  return { ...real, assertPublicUrl: vi.fn(async () => undefined) };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("허용 목록 해석(parseReadonlyBrandAllowlist)", () => {
  it("brandId 만 / brandId=도메인 쌍을 함께 읽는다", async () => {
    const { parseReadonlyBrandAllowlist } = await import(
      "../lib/mcp/geo-flags"
    );
    const out = parseReadonlyBrandAllowlist(
      ` ${BRAND_ID}=brand.example , ${OTHER_BRAND_ID} ,, `
    );
    expect([...out.ids].sort()).toEqual([BRAND_ID, OTHER_BRAND_ID].sort());
    expect([...out.pins]).toEqual([[BRAND_ID, "brand.example"]]);
    expect(out.rejected).toBe(0);
  });

  it("기대 도메인은 대소문자·www.·끝 점·국제화 도메인을 정규화한다", async () => {
    const { parseReadonlyBrandAllowlist } = await import(
      "../lib/mcp/geo-flags"
    );
    for (const [raw, expected] of [
      ["BRAND.Example", "brand.example"],
      ["www.brand.example", "brand.example"],
      ["brand.example.", "brand.example"],
      ["WWW.Brand.Example.", "brand.example"],
      ["bränd.example", "xn--brnd-moa.example"],
    ] as const) {
      const out = parseReadonlyBrandAllowlist(`${BRAND_ID}=${raw}`);
      expect(out.pins.get(BRAND_ID), raw).toBe(expected);
    }
  });

  it("형식 오류 항목은 그 brandId 를 통째로 뺀다(fail-closed)", async () => {
    const { parseReadonlyBrandAllowlist } = await import(
      "../lib/mcp/geo-flags"
    );
    for (const raw of [
      `${BRAND_ID}=`,
      `${BRAND_ID}=brand.example=x`,
      `${BRAND_ID}=https://brand.example`,
      `${BRAND_ID}=brand.example/path`,
      `${BRAND_ID}=brand.example:8443`,
      `${BRAND_ID}=user@brand.example`,
      `${BRAND_ID}=localhost`,
      `${BRAND_ID}=brand example.com`,
      `${BRAND_ID}=[::1]`,
    ]) {
      const out = parseReadonlyBrandAllowlist(raw);
      expect(out.ids.has(BRAND_ID), raw).toBe(false);
      expect(out.pins.has(BRAND_ID), raw).toBe(false);
      expect(out.rejected, raw).toBe(1);
    }
    // 앞이 빈 항목은 아무 것도 넣지 않는다.
    const empty = parseReadonlyBrandAllowlist("=brand.example");
    expect(empty.ids.size).toBe(0);
    expect(empty.rejected).toBe(1);
  });

  it("같은 brandId 에 다른 기대 도메인이 오면 그 brandId 를 뺀다(다른 항목은 유지)", async () => {
    const { parseReadonlyBrandAllowlist } = await import(
      "../lib/mcp/geo-flags"
    );
    const out = parseReadonlyBrandAllowlist(
      `${BRAND_ID}=a.example,${BRAND_ID}=b.example,${OTHER_BRAND_ID}=c.example`
    );
    expect([...out.ids]).toEqual([OTHER_BRAND_ID]);
    expect([...out.pins]).toEqual([[OTHER_BRAND_ID, "c.example"]]);
    // 같은 도메인을 정규화 후 두 번 적은 것은 충돌이 아니다.
    const same = parseReadonlyBrandAllowlist(
      `${BRAND_ID}=brand.example,${BRAND_ID}=WWW.brand.example.`
    );
    expect(same.pins.get(BRAND_ID)).toBe("brand.example");
  });

  it("환경변수 손잡이: brandId 만은 목록에는 들어가지만 도메인 고정에는 없다", async () => {
    vi.stubEnv(
      "FINDABLE_MCP_READONLY_BRAND_ALLOWLIST",
      `${BRAND_ID},${OTHER_BRAND_ID}=other.example`
    );
    const { readonlyBrandAllowlist, readonlyBrandDomainPins } = await import(
      "../lib/mcp/geo-flags"
    );
    expect(readonlyBrandAllowlist().has(BRAND_ID)).toBe(true);
    expect(readonlyBrandDomainPins().has(BRAND_ID)).toBe(false);
    expect(readonlyBrandDomainPins().get(OTHER_BRAND_ID)).toBe("other.example");
  });
});

describe("공식 사실 점검 — 도메인 고정", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(
      async () => new Response("<html></html>", { status: 200 })
    );
  });

  async function run(opts: {
    dbDomain: string;
    pins?: ReadonlyMap<string, string>;
    url: string;
  }) {
    const { guardedOfficialFacts, toReadonlyDb } = await import(
      "../lib/mcp/geo-tools"
    );
    return await guardedOfficialFacts(
      {
        allowlist: new Set([BRAND_ID]),
        db: toReadonlyDb(
          makeWatchedDb({
            brand: { id: BRAND_ID, name: "시험브랜드", domain: opts.dbDomain },
            job: makeJob(),
          }).db
        ),
        ...(opts.pins ? { domainPins: opts.pins } : {}),
        fetchImpl: fetchSpy as unknown as typeof fetch,
      },
      opts.url
    );
  }

  it("일치: 기대 도메인과 DB 도메인이 같으면 점검한다", async () => {
    const out = await run({
      dbDomain: "brand.example",
      pins: new Map([[BRAND_ID, "brand.example"]]),
      url: "https://brand.example",
    });
    expect("out" in out).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("정규화 일치: DB 쪽 대소문자·www.·끝 점·https 표기가 달라도 같은 도메인이면 점검한다", async () => {
    for (const dbDomain of [
      "BRAND.example",
      "www.brand.example",
      "brand.example.",
      "https://www.Brand.Example/",
    ]) {
      fetchSpy.mockClear();
      const out = await run({
        dbDomain,
        pins: new Map([[BRAND_ID, "brand.example"]]),
        url: "https://brand.example",
      });
      expect("out" in out, dbDomain).toBe(true);
      expect(fetchSpy, dbDomain).toHaveBeenCalled();
    }
  });

  it("불일치: DB 의 Brand.domain 이 바뀌었으면(오염·실수) 거부하고 접속 0", async () => {
    for (const [dbDomain, url] of [
      ["attacker.example", "https://attacker.example"],
      [
        "brand.example.attacker.example",
        "https://brand.example.attacker.example",
      ],
      ["sub.brand.example", "https://sub.brand.example"],
      ["169.254.169.254", "http://169.254.169.254"],
      ["brand.example", "https://brand.example"], // 아래 기대 도메인이 다른 경우
    ] as const) {
      fetchSpy.mockClear();
      const pins = new Map([
        [
          BRAND_ID,
          dbDomain === "brand.example" ? "other.example" : "brand.example",
        ],
      ]);
      const out = await run({ dbDomain, pins, url });
      expect(out, dbDomain).toEqual({ error: "not_available" });
      expect(fetchSpy, dbDomain).not.toHaveBeenCalled();
    }
  });

  it("쌍이 없으면(brandId 만, 고정 목록 생략·빈 목록) 점검은 거부하고 접속 0", async () => {
    for (const pins of [undefined, new Map<string, string>()]) {
      fetchSpy.mockClear();
      const out = await run({
        dbDomain: "brand.example",
        ...(pins ? { pins } : {}),
        url: "https://brand.example",
      });
      expect(out).toEqual({ error: "not_available" });
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it("다른 브랜드의 쌍만 있으면 이 브랜드는 점검하지 않는다", async () => {
    const out = await run({
      dbDomain: "brand.example",
      pins: new Map([[OTHER_BRAND_ID, "brand.example"]]),
      url: "https://brand.example",
    });
    expect(out).toEqual({ error: "not_available" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("요약 조회는 brandId 만으로도 허용(하위 호환)", () => {
  it("쌍이 없어도 get_brand_measurement_summary 본체는 결과를 낸다", async () => {
    const { runSummary, toReadonlyDb } = await import("../lib/mcp/geo-tools");
    const out = await runSummary(
      {
        allowlist: new Set([BRAND_ID]),
        db: toReadonlyDb(
          makeWatchedDb({
            brand: {
              id: BRAND_ID,
              name: "시험브랜드",
              domain: "brand.example",
            },
            job: makeJob(),
          }).db
        ),
        log: { error: vi.fn() },
      },
      BRAND_ID
    );
    expect("response" in out).toBe(true);
  });
});
