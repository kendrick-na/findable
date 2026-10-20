/**
 * 사설·메타데이터·IPv4 매핑 IPv6·혼합 해석 주소 차단 시험 — 실제 assertPublicUrl 에 모의 DNS 만 끼운다.
 * 외부 호출 없음(DNS·fetch 모두 가짜).
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BRAND_ID, makeJob, makeWatchedDb } from "./mcp-geo-fixtures";

const dns = vi.hoisted(() => ({
  records: new Map<string, { address: string; family: number }[]>(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn((host: string) => {
    const found = dns.records.get(host);
    return found
      ? Promise.resolve(found)
      : Promise.reject(new Error("ENOTFOUND"));
  }),
}));

beforeEach(() => {
  dns.records.clear();
});

const v4 = (address: string) => ({ address, family: 4 });
const v6 = (address: string) => ({ address, family: 6 });

async function blocked(url: string): Promise<string> {
  const { assertPublicUrl } = await import("@repo/audit/public-url-security");
  try {
    await assertPublicUrl(new URL(url));
    return "allowed";
  } catch (error) {
    return error instanceof Error ? error.message : "error";
  }
}

describe("주소 리터럴 차단(실제 assertPublicUrl)", () => {
  it("클라우드 메타데이터 주소(169.254.169.254)와 사설·루프백·링크로컬 IPv4 를 막는다", async () => {
    for (const host of [
      "169.254.169.254",
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      expect(await blocked(`http://${host}/`), host).toBe("URL_PRIVATE");
    }
  });

  it("IPv4 를 IPv6 로 감싼 주소(::ffff:…)·루프백 IPv6 는 허용으로 새지 않는다", async () => {
    for (const host of [
      "[::ffff:127.0.0.1]",
      "[::ffff:169.254.169.254]",
      "[::ffff:10.0.0.1]",
      "[::1]",
      "[fd00::1]",
      "[fe80::1]",
    ]) {
      expect(await blocked(`http://${host}/`), host).not.toBe("allowed");
    }
  });
});

describe("도메인이 사설 주소로 해석되는 경우(모의 DNS)", () => {
  it("사설 주소로만 해석되면 막는다", async () => {
    dns.records.set("a.example", [v4("10.0.0.5")]);
    expect(await blocked("https://a.example/")).toBe("URL_PRIVATE");
  });

  it("메타데이터 주소로 해석되면 막는다", async () => {
    dns.records.set("m.example", [v4("169.254.169.254")]);
    expect(await blocked("https://m.example/")).toBe("URL_PRIVATE");
  });

  it("IPv4 공개 + IPv6 사설이 섞여 해석되면(하나라도 사설) 막는다", async () => {
    dns.records.set("mix.example", [v4("93.184.216.34"), v6("fd00::1")]);
    expect(await blocked("https://mix.example/")).toBe("URL_PRIVATE");
  });

  it("IPv4 공개 + IPv4 매핑 IPv6(사설)이 섞여도 막는다", async () => {
    dns.records.set("map.example", [
      v4("93.184.216.34"),
      v6("::ffff:127.0.0.1"),
    ]);
    expect(await blocked("https://map.example/")).toBe("URL_PRIVATE");
  });

  it("해석에 실패하면 막는다(URL_DNS)", async () => {
    expect(await blocked("https://nx.example/")).toBe("URL_DNS");
  });

  it("전부 공개 주소로 해석되면 통과한다(대조군)", async () => {
    dns.records.set("ok.example", [v4("93.184.216.34")]);
    expect(await blocked("https://ok.example/")).toBe("allowed");
  });
});

describe("공식 정보 점검 — 사설 해석이면 네트워크 요청이 나가지 않는다", () => {
  async function run(domain: string, url: string, fetchSpy: typeof fetch) {
    const { guardedOfficialFacts, toReadonlyDb } = await import(
      "../lib/mcp/geo-tools"
    );
    return await guardedOfficialFacts(
      {
        allowlist: new Set([BRAND_ID]),
        domainPins: new Map([[BRAND_ID, domain]]),
        db: toReadonlyDb(
          makeWatchedDb({
            brand: { id: BRAND_ID, name: "시험브랜드", domain },
            job: makeJob(),
          }).db
        ),
        fetchImpl: fetchSpy,
      },
      url
    );
  }

  it("등록 도메인이 사설·혼합·메타데이터로 해석되면 fetch 호출 0", async () => {
    const cases: [string, { address: string; family: number }[]][] = [
      ["priv.example", [v4("10.1.2.3")]],
      ["meta.example", [v4("169.254.169.254")]],
      ["mix.example", [v4("93.184.216.34"), v6("fd00::1")]],
    ];
    for (const [domain, records] of cases) {
      dns.records.set(domain, records);
      const spy = vi.fn(() =>
        Promise.resolve(new Response("x"))
      ) as unknown as typeof fetch;
      await expect(
        run(domain, `https://${domain}`, spy),
        domain
      ).rejects.toThrow(/URL_PRIVATE/);
      expect(spy, domain).not.toHaveBeenCalled();
    }
  });
});
