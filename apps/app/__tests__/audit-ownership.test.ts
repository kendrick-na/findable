/*
 * 진단 결과 **소유자 판별** 테스트 — 2026-08-12 세션N-26.
 *
 * 🔴 **막는 사고**: 남의 진단 결과에서 **신청자 이메일(마스킹)이 새는 것**.
 *   예전엔 `/api/audit/[jobId]` 가 소유 검사 **없이** `emailMasked` 를 항상 줬고,
 *   방어는 `window.location` 을 읽는 **클라이언트 전용**이라
 *   ①주소창 URL 을 복사해 보내면 표식이 없어 제3자에게 보였고
 *   ②API 를 직접 부르면 방어가 **아예 없었다**.
 *
 * ⚠️ 이 판정은 **양방향으로 위험**하다:
 *   - 너무 좁으면 → 소유자가 자기 결과에서 이메일을 못 본다(가입 유도가 깨진다)
 *   - 너무 넓으면 → **남의 PII 가 샌다**(이쪽이 훨씬 나쁘다)
 *   그래서 "맞다"와 "아니다"를 **둘 다** 고정한다.
 *
 * @vitest-environment node
 */

import { isAuditOwner } from "@repo/audit/ownership";
import { describe, expect, test } from "vitest";

const JOB = { email: "owner@brand.com", organizationId: null };

describe("isAuditOwner — 소유자로 인정하는 경우", () => {
  test("로그인 이메일이 진단 신청 이메일과 같으면 소유자", () => {
    expect(isAuditOwner(JOB, { email: "owner@brand.com" })).toBe(true);
  });

  test("대소문자가 달라도 소유자 — 표기 차이로 본인을 막지 않는다", () => {
    expect(isAuditOwner(JOB, { email: "Owner@Brand.com" })).toBe(true);
  });

  test("주변 공백이 섞여도 소유자", () => {
    expect(isAuditOwner(JOB, { email: "  owner@brand.com  " })).toBe(true);
  });

  test("조직 FK 가 일치하면 소유자(정식 연결)", () => {
    const orgJob = { email: "someone@brand.com", organizationId: "org_123" };
    expect(isAuditOwner(orgJob, { orgId: "org_123" })).toBe(true);
  });

  test("레거시 `org:{orgId}` 이메일 표기도 소유자(FK backfill 이전 행)", () => {
    const legacy = { email: "org:org_123", organizationId: null };
    expect(isAuditOwner(legacy, { orgId: "org_123" })).toBe(true);
  });
});

describe("🔴 isAuditOwner — 소유자가 **아닌** 경우(PII 유출 방지)", () => {
  test("비로그인은 소유자가 아니다 — 링크를 안다는 건 증거가 아니다", () => {
    // 🔴 이 라우트는 비로그인 접근이 **정상**이다. "링크를 안다"를 소유 증거로
    //   쓰면 검사 자체가 무의미해진다(누구나 링크로 들어오니까).
    expect(isAuditOwner(JOB, {})).toBe(false);
    expect(isAuditOwner(JOB, { email: null, orgId: null })).toBe(false);
  });

  test("다른 사람이 로그인해 있어도 소유자가 아니다", () => {
    expect(isAuditOwner(JOB, { email: "someone-else@other.com" })).toBe(false);
  });

  test("🔴 다른 조직 id 로는 소유자가 아니다", () => {
    const orgJob = { email: "someone@brand.com", organizationId: "org_123" };
    expect(isAuditOwner(orgJob, { orgId: "org_999" })).toBe(false);
  });

  test("🔴 같은 도메인이라고 소유자가 되지 않는다 — 회사 동료도 남이다", () => {
    // `medicube.co.kr` 한 도메인에 이메일이 15개였다는 실측이 있다.
    expect(isAuditOwner(JOB, { email: "colleague@brand.com" })).toBe(false);
  });

  test("🔴 로컬파트만 같고 도메인이 다르면 소유자가 아니다", () => {
    expect(isAuditOwner(JOB, { email: "owner@evil.com" })).toBe(false);
  });

  test("🔴 gmail 의 `+alias`·`.` 을 같은 주소로 보지 않는다", () => {
    // 제공자마다 규칙이 달라 일반화하면 **남의 진단을 내 것으로** 판정할 수 있다.
    // 과잉 매칭이 과소 매칭보다 위험하다.
    const gmailJob = { email: "someone@gmail.com", organizationId: null };
    expect(isAuditOwner(gmailJob, { email: "someone+x@gmail.com" })).toBe(
      false
    );
    expect(isAuditOwner(gmailJob, { email: "some.one@gmail.com" })).toBe(false);
  });

  test("🔴 org id 가 없는데 job 이메일이 `org:` 로 시작해도 통과하지 않는다", () => {
    const legacy = { email: "org:org_123", organizationId: null };
    expect(isAuditOwner(legacy, { email: "org:org_123" })).toBe(true); // 이메일 일치
    expect(isAuditOwner(legacy, {})).toBe(false); // 비로그인은 여전히 차단
  });

  test("🔴 job.organizationId 가 null 인데 viewer.orgId 가 있어도 새지 않는다", () => {
    // 무료 진단(조직 없음)을 아무 조직 로그인 사용자가 열었을 때.
    expect(isAuditOwner(JOB, { orgId: "org_123" })).toBe(false);
  });
});
