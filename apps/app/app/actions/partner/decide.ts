"use server";

import { requireAdmin } from "@repo/auth/admin";
import { grantPlan } from "@repo/auth/plan-grant";
import { clerkClient } from "@repo/auth/server";
import { database } from "@repo/database";
import { resend } from "@repo/email";
import { PartnerDecisionEmail } from "@repo/email/templates/partner-decision";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { env } from "@/env";

/**
 * 파트너 신청 승인/거절 — admin 전용.
 *
 * §4 2단계 write (드리프트 방지):
 *  1) DB 권위 write : PartnerApplication.status = approved|rejected (단일 진실)
 *  2) 승인이면 Clerk 캐시 push : publicMetadata.plan = "growth" (멱등·재시도)
 *     └ push 실패해도 DB 는 approved 유지 → 다음 로그인/재동기화 때 교정 가능.
 *     └ 파트너 승인 = Growth 상당 접근권 부여(요금제 이코노미 §3-C).
 *     └ push 로직은 공용 grantPlan(@repo/auth/plan-grant) 재사용(결제 경로와 동일).
 *  3) 결과 알림 메일 발송(신청자에게). best-effort — 실패해도 결정 자체는 성공.
 *     └ PartnerApplication 에 email 필드가 없어 Clerk 에서 userId 로 조회.
 *
 * ⚠️ Clerk push 실패를 삼키지 않고 경고로 반환한다(운영자가 재시도 판단).
 */

/**
 * 결정 결과 메일 발송(best-effort). 신청자 이메일은 Clerk 에서 userId 로 조회.
 * 실패는 로그만 남기고 삼킨다 — 메일 미발송이 승인/거절 트랜잭션을 막으면 안 됨.
 */
async function notifyPartnerDecision(
  userId: string,
  decision: "approved" | "rejected",
  note?: string
): Promise<void> {
  try {
    if (!(resend && env.RESEND_FROM)) {
      log.warn("[partner/notify] email not configured — skip");
      return;
    }
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const to = user.primaryEmailAddress?.emailAddress;
    if (!to) {
      log.warn(`[partner/notify] no primary email for user ${userId}`);
      return;
    }
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;

    await resend.emails.send({
      from: env.RESEND_FROM,
      to,
      subject:
        decision === "approved"
          ? "Findable 파트너 신청이 승인되었습니다"
          : "Findable 파트너 신청 결과 안내",
      react: PartnerDecisionEmail({
        decision,
        name,
        note,
        appUrl: env.NEXT_PUBLIC_APP_URL,
      }),
    });
  } catch (error) {
    // best-effort: 발송 실패는 삼키되 로그로 남긴다.
    log.error(
      `[partner/notify] send failed for ${userId}: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );
  }
}

export const approvePartner = async (
  applicationId: string
): Promise<
  { ok: true } | { ok: true; warning: string } | { error: string }
> => {
  try {
    const adminId = await requireAdmin();

    // 1) DB 권위 write
    const app = await database.partnerApplication.update({
      where: { id: applicationId },
      data: { status: "approved", decidedBy: adminId, decidedAt: new Date() },
    });

    // 2) Clerk 캐시 push (재시도) — 공용 grantPlan 재사용
    const pushed = await grantPlan(app.userId, "growth");

    // 3) 승인 알림 메일 (best-effort)
    await notifyPartnerDecision(app.userId, "approved");

    revalidatePath("/admin/partners");
    revalidatePath("/");

    if (!pushed) {
      return {
        ok: true,
        warning:
          "승인은 저장됐지만 접근권 반영(Clerk)이 지연됐습니다. 해당 유저가 다음 로그인 시 반영되거나, 잠시 후 다시 승인하면 재동기화됩니다.",
      };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("FORBIDDEN")) {
      return { error: "권한이 없습니다." };
    }
    return { error: "승인 처리 중 문제가 발생했습니다." };
  }
};

export const rejectPartner = async (
  applicationId: string,
  note?: string
): Promise<{ ok: true } | { error: string }> => {
  try {
    const adminId = await requireAdmin();

    const app = await database.partnerApplication.update({
      where: { id: applicationId },
      data: {
        status: "rejected",
        decidedBy: adminId,
        decidedAt: new Date(),
        note: note?.trim() || null,
      },
    });

    // 거절은 접근권 회수 케이스. 이전에 growth(파트너)였다면 free 로 되돌린다(멱등).
    // 신규 거절은 어차피 승인 전이므로 plan 변경 없이 DB 상태만 rejected.
    // (별도 재시도 없이 best-effort. 실패해도 DB 상태가 진실.)

    // 거절 알림 메일 (best-effort). 사유(note)가 있으면 함께 전달.
    await notifyPartnerDecision(
      app.userId,
      "rejected",
      note?.trim() || undefined
    );

    revalidatePath("/admin/partners");
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("FORBIDDEN")) {
      return { error: "권한이 없습니다." };
    }
    return { error: "거절 처리 중 문제가 발생했습니다." };
  }
};
