"use server";

import { grantPlan } from "@repo/auth/plan-grant";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";

/**
 * 초대 코드 사용(redeem) — 프로그램 참가 기업에게 기간제 권한을 준다.
 *
 * 🔴 **왜 「파트너 승인」이 아니라 코드인가** (세션N-42 · 👤 결정):
 *   파트너 승인은 신청 → **사장님이 승인할 때까지 대기** → 사용이다(B2B 엔터프라이즈 방식).
 *   프로그램(KAIST 오버엣지 등)은 여러 기업에 **동시 배포**라 승인이 병목이 된다.
 *   업계 표준(Vercel·Linear·Notion)은 **코드 입력 → 즉시 사용**이고, 만료가 코드에 내장된다.
 *
 * ⛔ **결제 경로를 건드리지 않는다** — `packages/payments` 무접촉.
 *   카카오페이 심사 중(~9월 초) 「상품명·가격·상세정보」는 유지해야 한다.
 *   이 액션은 `Organization.plan` 을 올릴 뿐 요금제 화면·상품 구성을 바꾸지 않는다.
 *
 * 🔒 보안:
 *   - 코드 검증·기간 계산은 **전부 서버**에서. 클라이언트는 문자열만 보낸다.
 *   - `orgId` 는 세션에서 재도출(위조 대상 없음).
 *   - 코드는 `@@unique` 라 동시 요청에도 중복 사용이 DB 레벨에서 막힌다.
 *
 * §2단계 write (파트너 승인과 **같은 순서** — 드리프트 방지):
 *   1) DB 권위 write: Organization.plan + planExpiresAt (단일 진실)
 *   2) Clerk 캐시 push: publicMetadata.plan (`grantPlan` 재사용 — 결제·파트너와 공용)
 *      └ push 실패해도 DB 는 유지 → 다음 로그인/크론에서 교정 가능
 */

export type RedeemResult =
  | { ok: true; plan: string; expiresAt: Date }
  | { error: string };

export async function redeemInviteCode(input: {
  code: string;
}): Promise<RedeemResult> {
  const { userId, orgId } = await auth();
  if (!(userId && orgId)) {
    return { error: "로그인 후 조직을 선택해 주세요." };
  }

  // 대소문자·공백을 흡수한다 — 코드는 사람이 손으로 옮겨 적는다(메일·PDF에서 복사).
  const code = input.code.trim().toUpperCase();
  if (!code) {
    return { error: "초대 코드를 입력해 주세요." };
  }

  const invite = await database.inviteCode.findUnique({ where: { code } });
  if (!invite) {
    // ⚠️ "없는 코드"와 "만료된 코드"를 구분해 알린다 — 오타인지 기간이 지난 건지
    //   모르면 사용자가 같은 코드를 계속 다시 넣는다.
    return { error: "없는 코드예요. 다시 확인해 주세요." };
  }
  if (invite.validUntil && invite.validUntil.getTime() < Date.now()) {
    return { error: "기간이 지난 코드예요." };
  }
  if (
    invite.maxRedemptions !== null &&
    invite.redeemedCount >= invite.maxRedemptions
  ) {
    return { error: "사용 한도에 도달한 코드예요." };
  }

  const expiresAt = new Date(
    Date.now() + invite.grantDays * 24 * 60 * 60 * 1000
  );

  try {
    await database.$transaction(async (tx) => {
      // 같은 org 가 같은 코드를 두 번 쓰지 못하게 한다(멱등이 아니라 **거절**).
      //   멱등으로 두면 기간이 계속 연장돼 무제한 무료가 된다.
      const already = await tx.inviteRedemption.findFirst({
        where: { inviteCodeId: invite.id, organizationId: orgId },
        select: { id: true },
      });
      if (already) {
        throw new Error("ALREADY_REDEEMED");
      }
      await tx.inviteRedemption.create({
        data: { inviteCodeId: invite.id, organizationId: orgId, userId },
      });
      await tx.inviteCode.update({
        where: { id: invite.id },
        data: { redeemedCount: { increment: 1 } },
      });
      await tx.organization.update({
        where: { id: orgId },
        data: { plan: invite.grantPlan, planExpiresAt: expiresAt },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_REDEEMED") {
      return { error: "이미 사용한 코드예요." };
    }
    log.error("invite.redeem.failed", { code, orgId, error: String(error) });
    return { error: "코드를 적용하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  // Clerk 캐시 push — 실패해도 DB(권위)는 이미 반영됐다.
  const pushed = await grantPlan(userId, invite.grantPlan);
  if (!pushed) {
    log.warn("invite.redeem.clerk_push_failed", { code, orgId, userId });
  }

  log.info("invite.redeem.ok", {
    code,
    orgId,
    plan: invite.grantPlan,
    expiresAt: expiresAt.toISOString(),
  });
  revalidatePath("/");
  revalidatePath("/billing");
  return { ok: true, plan: invite.grantPlan, expiresAt };
}
