"use server";

import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { revalidatePath } from "next/cache";

/**
 * 파트너 신청 — 로그인 유저 self 만.
 * DB PartnerApplication 이 신청의 단일 진실. 유저당 1건(재신청 시 pending 으로 되돌림).
 *
 * ⚠️ Clerk metadata 는 여기서 안 건드린다. 파트너 접근권(Growth)은 "승인"(decide.ts)에서만 부여.
 */
export const applyForPartner = async (
  reason?: string
): Promise<{ ok: true } | { error: string }> => {
  try {
    const { userId } = await auth();
    if (!userId) {
      return { error: "로그인이 필요합니다." };
    }

    const trimmed = reason?.trim() || null;

    const existing = await database.partnerApplication.findUnique({
      where: { userId },
    });

    // 이미 심사 대기/승인 상태면 중복 신청 무시.
    if (existing && existing.status !== "rejected") {
      return { ok: true };
    }

    // 신규 or 거절 후 재신청 → pending 으로 (기존 결정 이력은 덮되 재신청 의사 반영).
    await database.partnerApplication.upsert({
      where: { userId },
      create: { userId, status: "pending", reason: trimmed },
      update: {
        status: "pending",
        reason: trimmed,
        decidedBy: null,
        decidedAt: null,
        note: null,
      },
    });

    revalidatePath("/");
    return { ok: true };
  } catch (_error) {
    return {
      error: "신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
};
