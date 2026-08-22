/**
 * 도메인 정규화·검증 회귀 테스트 (2026-08-10 세션N-13).
 *
 * 여기서 지키는 것 = **"같은 사이트는 언제나 같은 Brand 한 건"**.
 *
 * 🔴 왜 중요한가(실측): `AuditJob.domain` 은 정규화가 보장되지 않는다.
 *   프로덕션 29종 중 3종이 `www.`·경로 포함이었고, 특히
 *   **`sulwhasoo.com` 과 `www.sulwhasoo.com` 이 둘 다 존재**했다.
 *   정규화 없이 Brand 를 도출하면 같은 브랜드가 **두 건으로 갈라지고
 *   완료 기록(ActionCompletion)도 갈라진다** → before/after 가 성립하지 않는다.
 *
 * ⚠️ 이 규칙은 한때 **세 파일에 복제**돼 있었다(start-tracking·assign·신규 경로).
 *   `@/lib/domain` 하나로 통합했고, 이 테스트가 그 단일 진실을 지킨다.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { isValidDomain, normalizeDomain } from "../lib/domain";

describe("normalizeDomain", () => {
  it("🔴 www 유무가 같은 값으로 합쳐진다 (실측 사고: sulwhasoo 중복)", () => {
    expect(normalizeDomain("www.sulwhasoo.com")).toBe(
      normalizeDomain("sulwhasoo.com")
    );
  });

  it("프로토콜·경로·대소문자·공백을 제거한다", () => {
    for (const raw of [
      "https://nike.com",
      "http://www.nike.com",
      "  NIKE.com  ",
      "https://www.nike.com/kr/ko",
      "nike.com/",
    ]) {
      expect(normalizeDomain(raw)).toBe("nike.com");
    }
  });

  it("🔴 실측 이상값도 호스트만 남긴다 (경로 포함 job 이 실재했다)", () => {
    expect(
      normalizeDomain(
        "5throck.github.io/multi-agent-harness-handbook/index.html"
      )
    ).toBe("5throck.github.io");
  });

  it("멱등 — 이미 정규화된 값을 다시 넣어도 그대로", () => {
    const once = normalizeDomain("https://www.Medicube.co.kr/path");
    expect(normalizeDomain(once)).toBe(once);
    expect(once).toBe("medicube.co.kr");
  });

  it("빈 입력은 빈 문자열 (호출부가 falsy 로 거른다)", () => {
    expect(normalizeDomain("")).toBe("");
    expect(normalizeDomain("   ")).toBe("");
  });
});

describe("isValidDomain", () => {
  it("정상 호스트를 통과시킨다", () => {
    for (const d of [
      "nike.com",
      "medicube.co.kr",
      "5throck.github.io",
      "dr-overedge.vercel.app",
    ]) {
      expect(isValidDomain(d)).toBe(true);
    }
  });

  it("🔴 형식이 깨진 값을 막는다 (이게 통과하면 이후 측정·매칭이 조용히 어긋난다)", () => {
    for (const d of [
      "", // 빈 값
      "nike", // 점 없음
      "nike..com", // 빈 라벨
      "-nike.com", // 하이픈 시작
      "nike-.com", // 하이픈 끝
      "nike.com/path", // 경로 잔존
      "https://nike.com", // 프로토콜 잔존
      "쿠팡.com", // 정규식이 허용하지 않는 문자
    ]) {
      expect(isValidDomain(d)).toBe(false);
    }
  });

  it("🔴 정규화를 거친 값은 통과해야 한다 (두 함수가 짝이 맞는지)", () => {
    for (const raw of [
      "https://www.sulwhasoo.com",
      "  NIKE.com/kr  ",
      "http://themedicube.co.kr/about",
    ]) {
      expect(isValidDomain(normalizeDomain(raw))).toBe(true);
    }
  });
});
