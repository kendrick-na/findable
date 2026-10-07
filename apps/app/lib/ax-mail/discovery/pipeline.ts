import "server-only";

import type { PrismaClient } from "@repo/database";
import type { ContactBasis } from "../contact-basis";
import { isMissingTableError, salesDiscoveryEnabled } from "./guard";
import { type SalesLeadStatusId, shouldAdvance } from "./view";

type PipelineDb = Pick<
  PrismaClient,
  "companyContact" | "contactBasis" | "salesLead"
>;

export type RecordDraftOutcome =
  | "recorded"
  | "disabled"
  | "db_not_ready"
  | "lead_missing";

/**
 * Gmail 초안 1건이 만들어진 뒤 — 영업 리드에 ① 수신 근거 행(이력, 덮어쓰지 않음) ② 연락처 연결 ③ 단계 drafted(앞으로만)를 남긴다.
 * 초안은 이미 만들어졌으므로 이 기록이 실패해도 throw 하지 않는다(테이블 없음은 db_not_ready, 그 밖은 호출부가 로그).
 */
export async function recordSalesDraft(
  db: PipelineDb,
  input: {
    basis: ContactBasis;
    recipient: string;
    salesLeadId: string;
    userId: string;
  },
  env: Record<string, string | undefined> = process.env
): Promise<RecordDraftOutcome> {
  if (!salesDiscoveryEnabled(env)) {
    return "disabled";
  }
  try {
    const lead = await db.salesLead.findUnique({
      where: { id: input.salesLeadId },
      select: { companyId: true, contactId: true, id: true, status: true },
    });
    if (!lead) {
      return "lead_missing";
    }
    await db.contactBasis.create({
      data: {
        date: input.basis.date,
        detail: input.basis.detail,
        email: input.recipient,
        kind: input.basis.kind,
        leadId: lead.id,
        recordedBy: input.userId,
      },
    });
    const contact = lead.contactId
      ? null
      : await db.companyContact.findUnique({
          where: {
            companyId_email: {
              companyId: lead.companyId,
              email: input.recipient,
            },
          },
          select: { id: true },
        });
    const advance = shouldAdvance(lead.status as SalesLeadStatusId, "drafted");
    if (advance || contact) {
      await db.salesLead.update({
        where: { id: lead.id },
        data: {
          ...(contact ? { contactId: contact.id } : {}),
          ...(advance
            ? { status: "drafted", statusChangedAt: new Date() }
            : {}),
        },
      });
    }
    return "recorded";
  } catch (error) {
    if (isMissingTableError(error)) {
      return "db_not_ready";
    }
    throw error;
  }
}
