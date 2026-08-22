import "server-only";

import { requireAdmin } from "@repo/auth/admin";
import type { PartnerStatus } from "@repo/auth/plan";
import { auth, clerkClient } from "@repo/auth/server";
import { database } from "@repo/database";

/**
 * 로그인 유저의 파트너 신청 상태 — DB 가 진실.
 * 신청 이력이 없으면 "none".
 */
export async function getMyPartnerStatus(): Promise<{
  status: PartnerStatus;
  reason: string | null;
  note: string | null;
}> {
  const { userId } = await auth();
  if (!userId) {
    return { status: "none", reason: null, note: null };
  }
  const app = await database.partnerApplication.findUnique({
    where: { userId },
  });
  if (!app) {
    return { status: "none", reason: null, note: null };
  }
  return { status: app.status, reason: app.reason, note: app.note };
}

// 목록에 실리는 신청은 DB 에 실재하므로 "none" 이 없다(=신청 이력 있음).
export type DecidedStatus = "pending" | "approved" | "rejected";

export interface PartnerApplicationRow {
  createdAt: Date;
  decidedAt: Date | null;
  email: string | null;
  id: string;
  // Clerk 에서 보강한 표시용 정보(없을 수 있음).
  name: string | null;
  note: string | null;
  reason: string | null;
  status: DecidedStatus;
  userId: string;
}

/**
 * 관리자용 신청 목록 — admin 전용.
 * status 필터 옵션. Clerk 에서 이름/이메일 보강(개별 조회).
 */
export async function listPartnerApplications(
  status?: "pending" | "approved" | "rejected"
): Promise<PartnerApplicationRow[]> {
  await requireAdmin();

  const apps = await database.partnerApplication.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  if (apps.length === 0) {
    return [];
  }

  const clerk = await clerkClient();

  // Clerk 유저 정보 보강(이름·이메일). 실패해도 목록 자체는 반환.
  const rows = await Promise.all(
    apps.map(async (app): Promise<PartnerApplicationRow> => {
      let name: string | null = null;
      let email: string | null = null;
      try {
        const user = await clerk.users.getUser(app.userId);
        name =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.username ||
          null;
        email = user.primaryEmailAddress?.emailAddress ?? null;
      } catch {
        // Clerk 조회 실패 → id 만으로 표시.
      }
      return {
        id: app.id,
        userId: app.userId,
        status: app.status,
        reason: app.reason,
        note: app.note,
        createdAt: app.createdAt,
        decidedAt: app.decidedAt,
        name,
        email,
      };
    })
  );

  return rows;
}
