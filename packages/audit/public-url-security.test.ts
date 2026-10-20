/**
 * IPv6 변환 주소(NAT64·6to4·Teredo·IPv4 호환/매핑/변환) 안의 사설 IPv4 차단 시험.
 * 판정은 **더 엄격하게만** 바뀌어야 한다 — 공개 대조군은 계속 통과해야 한다.
 * 외부 호출 없음(DNS 는 가짜).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  assertPublicUrl,
  isPrivateAddress,
  normalizePublicUrl,
} from "./public-url-security";

beforeEach(() => {
  dns.records.clear();
});

describe("IPv6 변환 주소 안의 사설·루프백·메타데이터 IPv4", () => {
  const privateCases: [string, string][] = [
    // NAT64 공용 접두사 64:ff9b::/96
    ["NAT64 루프백", "64:ff9b::7f00:1"],
    ["NAT64 루프백(점 표기)", "64:ff9b::127.0.0.1"],
    ["NAT64 메타데이터", "64:ff9b::a9fe:a9fe"],
    ["NAT64 사설 10/8", "64:ff9b::a00:5"],
    ["NAT64 사설 192.168", "64:ff9b::c0a8:101"],
    // NAT64 지역 전용 64:ff9b:1::/48 — 통째로 막는다
    ["NAT64 지역 전용(공개 IPv4 포함)", "64:ff9b:1::808:808"],
    ["NAT64 지역 전용(사설)", "64:ff9b:1:abcd::a00:1"],
    // 6to4 2002::/16
    ["6to4 루프백", "2002:7f00:1::1"],
    ["6to4 메타데이터", "2002:a9fe:a9fe::"],
    ["6to4 사설 172.16", "2002:ac10:1::1"],
    ["6to4 0.0.0.0", "2002::1"],
    // Teredo 2001::/32 — 서버(3·4칸) 또는 뒤집힌 클라이언트(끝 두 칸)
    ["Teredo 서버 사설", "2001:0:a00:1::1"],
    ["Teredo 클라이언트 루프백(뒤집힘)", "2001:0:808:808:0:0:80ff:fffe"],
    ["Teredo 클라이언트 메타데이터(뒤집힘)", "2001:0:808:808::5601:5601"],
    // IPv4 호환 ::a.b.c.d (폐지 형식 — 통째로 막는다)
    ["IPv4 호환 루프백", "::127.0.0.1"],
    ["IPv4 호환 메타데이터", "::169.254.169.254"],
    ["IPv4 호환 공개도 막음", "::8.8.8.8"],
    // IPv4 매핑을 펼쳐 쓴 형태(기존 문자열 판정이 놓치던 모양)
    ["IPv4 매핑 펼친 형태", "0:0:0:0:0:ffff:127.0.0.1"],
    ["IPv4 매핑 16진 형태", "::ffff:a9fe:a9fe"],
    // IPv4 변환 ::ffff:0:a.b.c.d (RFC 2765)
    ["IPv4 변환 사설", "::ffff:0:10.0.0.1"],
    // 그 밖의 특수 대역(새로 막는 것)
    ["멀티캐스트", "ff02::1"],
    ["사이트 로컬(폐지)", "fec0::1"],
    ["버림 전용", "100::1"],
    ["문서용 펼친 형태", "2001:0db8:0:0:0:0:0:1"],
  ];

  for (const [label, address] of privateCases) {
    it(`${label}: ${address} → 사설`, () => {
      expect(isPrivateAddress(address)).toBe(true);
    });
  }

  it("DNS 가 변환 주소(사설 IPv4 포함)를 돌려주면 assertPublicUrl 이 막는다", async () => {
    const cases: [string, string][] = [
      ["nat64.example", "64:ff9b::a9fe:a9fe"],
      ["sixtofour.example", "2002:7f00:1::1"],
      ["teredo.example", "2001:0:a00:1::1"],
      ["compat.example", "::127.0.0.1"],
      ["local64.example", "64:ff9b:1::808:808"],
    ];
    for (const [host, address] of cases) {
      dns.records.set(host, [{ address, family: 6 }]);
      await expect(
        assertPublicUrl(new URL(`https://${host}/`)),
        host
      ).rejects.toThrow("URL_PRIVATE");
    }
  });
});

describe("기존 판정 유지(회귀)", () => {
  it("기존 사설 IPv6·IPv4 는 계속 사설이다", () => {
    for (const address of [
      "::",
      "::1",
      "fd00::1",
      "fc00::1",
      "fe80::1",
      "fe80::1%en0",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("IP 가 아닌 문자열은 사설로 본다(fail-closed)", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("공개 대조군 — 계속 통과해야 한다", () => {
  const publicCases = [
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
    "2404:6800:4004:80a::200e", // 공개 IPv6 예
    "2a00:1450:4001:82a::200e",
    "64:ff9b::808:808", // NAT64 안의 공개 IPv4(8.8.8.8)
    "2002:808:808::1", // 6to4 안의 공개 IPv4(8.8.8.8)
    "2001:0:808:808:0:0:f7f7:f7f7", // Teredo: 서버·클라이언트(8.8.8.8) 모두 공개
    "::ffff:8.8.8.8", // IPv4 매핑 공개(기존에도 통과)
    "::ffff:93.184.216.34",
    "8.8.8.8",
    "93.184.216.34",
  ];

  for (const address of publicCases) {
    it(`${address} → 공개`, () => {
      expect(isPrivateAddress(address)).toBe(false);
    });
  }

  it("공개 IPv6 로만 해석되는 도메인은 assertPublicUrl 을 통과한다", async () => {
    dns.records.set("ok6.example", [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ]);
    await expect(
      assertPublicUrl(new URL("https://ok6.example/"))
    ).resolves.toBeUndefined();
  });
});

describe("IPv6 리터럴 주소(대괄호)·영역 표시", () => {
  const forged = (hostname: string) =>
    ({
      protocol: "http:",
      username: "",
      password: "",
      port: "",
      hostname,
    }) as URL;

  it("공개 IPv6 리터럴은 DNS 조회 없이 통과한다", async () => {
    for (const url of [
      "https://[2606:4700:4700::1111]/",
      "https://[2001:4860:4860:0:0:0:0:8888]/",
      "http://[64:ff9b::8.8.8.8]/",
    ]) {
      await expect(assertPublicUrl(new URL(url)), url).resolves.toBeUndefined();
    }
  });

  it("사설·루프백·매핑·변환 IPv6 리터럴은 URL_PRIVATE 로 막는다(압축·IPv4 꼬리 조합 포함)", async () => {
    for (const url of [
      "http://[::1]/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[0:0:0:0:0:ffff:169.254.169.254]/",
      "http://[::127.0.0.1]/",
      "http://[64:ff9b::10.0.0.1]/",
      "http://[64:ff9b:0:0:0:0:a9fe:a9fe]/",
      "http://[2002:c0a8:101::]/",
      "http://[fe80::1]/",
      "http://[fd12:3456::1]/",
    ]) {
      await expect(assertPublicUrl(new URL(url)), url).rejects.toThrow(
        "URL_PRIVATE"
      );
    }
  });

  it("영역 표시(%)가 붙은 주소는 거부한다", async () => {
    // WHATWG URL 은 [fe80::1%25en0] 자체를 만들지 못한다 → 입력 단계에서 URL_INVALID.
    expect(() => normalizePublicUrl("http://[fe80::1%25en0]/")).toThrow(
      "URL_INVALID"
    );
    // URL 객체를 거치지 않고 들어와도 막는다.
    await expect(assertPublicUrl(forged("[fe80::1%en0]"))).rejects.toThrow(
      "URL_PRIVATE"
    );
    await expect(
      assertPublicUrl(forged("[2606:4700:4700::1111%eth0]"))
    ).rejects.toThrow("URL_PRIVATE");
    expect(isPrivateAddress("fe80::1%en0")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111%eth0")).toBe(true);
  });

  it("대괄호 안이 IPv6 가 아니면 거부한다", async () => {
    await expect(assertPublicUrl(forged("[brand.example]"))).rejects.toThrow(
      "URL_PRIVATE"
    );
  });

  it("DNS 결과가 공개 IPv6 이면 통과, 공개+사설 혼합이면 막는다", async () => {
    dns.records.set("v6only.example", [
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
    await expect(
      assertPublicUrl(new URL("https://v6only.example/"))
    ).resolves.toBeUndefined();
    dns.records.set("v6mix.example", [
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "64:ff9b::7f00:1", family: 6 },
    ]);
    await expect(
      assertPublicUrl(new URL("https://v6mix.example/"))
    ).rejects.toThrow("URL_PRIVATE");
  });
});
