/**
 * 🔴 **왜 이 테스트가 있나** (세션N-42 — 프로그램 참가 기업 초대 코드)
 *
 * KAIST 오버엣지 참여 기업에게 기간제 권한을 준다. 이 경로는 **돈을 안 받고 플랜을 올린다**
 * → 잘못 만들면 ① 영구 무료 ② 같은 코드 무한 재사용 ③ 결제 화면 오염이 된다.
 *
 * ⛔ **결제 경로 무접촉이 핵심 계약이다** — 카카오페이 심사 중(~9월 초)
 *   「상품명·가격·상세정보」는 유지해야 한다. 이 기능이 `packages/payments` 나
 *   요금제 카드 값을 건드리면 심사가 처음부터 다시 간다.
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — 소스의 계약만 검사한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REDEEM = join(process.cwd(), "app/actions/invite/redeem.ts");
const CRON = join(
  process.cwd(),
  "../web/app/api/cron/auto-refresh-tracking/route.ts"
);
const SCHEMA = join(
  process.cwd(),
  "../../packages/database/prisma/schema.prisma"
);

const redeemSource = readFileSync(REDEEM, "utf8");
const cronSource = readFileSync(CRON, "utf8");
const schemaSource = readFileSync(SCHEMA, "utf8");

// 정규식은 최상위에(lint: useTopLevelRegex).
/** 세션에서 org 를 재도출하는가(클라이언트가 org 를 지정하면 남의 조직을 올릴 수 있다). */
const SERVER_DERIVED_ORG = /await auth\(\)/;
/** 만료 시각을 **서버가** 계산하는가. */
const SERVER_COMPUTED_EXPIRY = /grantDays \* 24 \* 60 \* 60 \* 1000/;
/** DB 권위 write — plan 과 만료를 함께 쓴다. */
const WRITES_PLAN_AND_EXPIRY =
  /plan: invite\.grantPlan,\s*planExpiresAt: expiresAt/;
/** 결제·파트너와 같은 공용 헬퍼를 재사용하는가(로직 복제 금지). */
const REUSES_GRANT_PLAN = /grantPlan\(userId, invite\.grantPlan\)/;
/** 같은 org 재사용 차단(멱등이면 기간이 무한 연장된다). */
const BLOCKS_REUSE = /ALREADY_REDEEMED/;
/** 코드 정규화(사람이 손으로 옮겨 적는다). */
const NORMALIZES_CODE = /toUpperCase\(\)/;
/** 🔴 크론이 만료를 강하시키는가 — 없으면 영구 무료가 된다. */
const CRON_DOWNGRADES = /planExpiresAt: \{ not: null, lt: new Date\(now\) \}/;
/** 강하가 측정 선정 **앞**에 오는가(뒤면 만료 org 가 유료 측정을 한 번 더 받는다). */
const CRON_ORDER_MARKER = /expired_downgraded/;
/** Plan enum 본문 — 새 플랜 값이 추가되지 않았는지 본다. */
const PLAN_ENUM = /enum Plan\s*\{([^}]*)\}/;

describe("초대 코드 — 권한을 여는 경로의 안전장치", () => {
  it("🔒 org 를 세션에서 재도출한다 (남의 조직 승격 불가)", () => {
    expect(SERVER_DERIVED_ORG.test(redeemSource)).toBe(true);
  });

  it("🔒 만료 시각을 서버가 계산한다 (클라이언트가 기간을 못 정한다)", () => {
    expect(SERVER_COMPUTED_EXPIRY.test(redeemSource)).toBe(true);
  });

  it("🔴 DB 에 plan 과 만료를 **함께** 쓴다 (만료 없이 올리면 영구 무료)", () => {
    expect(WRITES_PLAN_AND_EXPIRY.test(redeemSource)).toBe(true);
  });

  it("결제·파트너와 같은 `grantPlan` 을 재사용한다 (Clerk push 로직 복제 금지)", () => {
    expect(REUSES_GRANT_PLAN.test(redeemSource)).toBe(true);
  });

  it("🔴 같은 조직의 재사용을 **거절**한다 (멱등이면 기간 무한 연장)", () => {
    expect(BLOCKS_REUSE.test(redeemSource)).toBe(true);
  });

  it("코드를 대문자로 정규화한다 (메일·PDF 에서 옮겨 적는다)", () => {
    expect(NORMALIZES_CODE.test(redeemSource)).toBe(true);
  });
});

describe("만료 처리 — 크론이 강하시킨다", () => {
  it("🔴 만료된 org 를 free 로 강하시키는 분기가 있다", () => {
    expect(CRON_DOWNGRADES.test(cronSource)).toBe(true);
  });

  it("🔴 강하가 **측정 선정보다 앞**에 온다 (원가 누수 방지)", () => {
    const downgradeAt = cronSource.search(CRON_ORDER_MARKER);
    const selectAt = cronSource.indexOf("자동 갱신 허용 플랜의 org");
    expect(downgradeAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(-1);
    expect(downgradeAt).toBeLessThan(selectAt);
  });
});

describe("⛔ 결제 경로 무접촉 (카카오페이 심사 보존)", () => {
  it("redeem 이 payments 를 import 하지 않는다", () => {
    expect(redeemSource).not.toContain("@repo/payments");
  });

  it("스키마에 초대 모델이 있고 기존 Plan enum 을 재사용한다", () => {
    // 🔴 `trial` 같은 **새 플랜 값을 추가하지 않는다** — Plan enum 변경은
    //   상품 구성 변경이라 심사 항목에 걸린다. 기존 growth 를 기간제로 줄 뿐이다.
    expect(schemaSource).toContain("model InviteCode");
    expect(schemaSource).toContain("model InviteRedemption");
    const planEnum = PLAN_ENUM.exec(schemaSource)?.[1] ?? "";
    expect(planEnum).not.toContain("trial");
  });
});
