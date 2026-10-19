import { describe, expect, it } from "vitest";
import {
  isCertSiblingFlagOn,
  parseCertAltNames,
  readMethods,
  registrableDomain,
  siblingHostCandidates,
} from "./site-read-policy";

const NODE_MESSAGE =
  "Hostname/IP does not match certificate's altnames: Host: app.example.co.kr. is not in the cert's altnames: DNS:example.co.kr, DNS:www.example.co.kr, DNS:*.dev.example.co.kr, DNS:other-company.com";

describe("인증서 이름 읽기", () => {
  it("Node 오류 문구에서 DNS 이름을 읽고 와일드카드는 base·www.base 로 푼다", () => {
    expect(parseCertAltNames(NODE_MESSAGE).sort()).toEqual(
      [
        "dev.example.co.kr",
        "example.co.kr",
        "other-company.com",
        "www.dev.example.co.kr",
        "www.example.co.kr",
      ].sort()
    );
  });
  it("이름 목록이 없으면 빈 배열", () => {
    expect(parseCertAltNames("fetch failed")).toEqual([]);
  });
});

describe("형제 호스트 후보 — 같은 가족만", () => {
  it("등록 도메인 근사(co.kr 같은 2단 접미사 처리)", () => {
    expect(registrableDomain("app.example.co.kr")).toBe("example.co.kr");
    expect(registrableDomain("www.example.com")).toBe("example.com");
    expect(registrableDomain("example.com")).toBe("example.com");
  });
  it("다른 회사 이름은 거르고, 요청 호스트 자신은 뺀다(최대 3개)", () => {
    const names = parseCertAltNames(NODE_MESSAGE);
    const out = siblingHostCandidates("app.example.co.kr", names);
    expect(out).not.toContain("other-company.com");
    expect(out).not.toContain("app.example.co.kr");
    expect(out).toContain("example.co.kr");
    expect(out.length).toBeLessThanOrEqual(3);
  });
});

describe("플래그·읽기 방법 기록", () => {
  it("형제 호스트 플래그는 기본 꺼짐", () => {
    expect(isCertSiblingFlagOn({})).toBe(false);
    expect(isCertSiblingFlagOn({ SITE_CERT_SIBLING_HOST_ENABLED: "1" })).toBe(
      true
    );
  });
  it("특별한 방법이 없으면 plain, 있으면 사용한 것만 중복 없이", () => {
    expect(readMethods({})).toEqual(["plain"]);
    expect(
      readMethods({ httpFallback: true, imageText: true, render: true })
    ).toEqual(["http_fallback", "render", "image_text"]);
    expect(readMethods({ certSiblingHost: true })).toEqual([
      "cert_sibling_host",
    ]);
  });
});
