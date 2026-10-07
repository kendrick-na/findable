import "server-only";

import type { PrismaClient } from "@repo/database";
import type { ContactBasis } from "../contact-basis";
import { isMissingTableError, salesDiscoveryEnabled } from "./guard";
import { type SalesLeadStatusId, shouldAdvance } from "./view";

type PipelineDb = Pick<
  PrismaClient,
  "companyContact" | "contactBasis" | "salesLead"
>;

type SyncDb = Pick<PrismaClient, "auditJob" | "salesLead">;

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

const WWW_PREFIX_RE = /^www\./;

/** 한 번에 맞춰 보는 리드 수 상한(화면 열 때마다 돈다 — 무거워지지 않게). */
const SYNC_LIMIT = 2000;

/**
 * 영업 단계 자동 이동(앞으로만) — 「회사 찾기」 화면을 열 때마다 맞춘다.
 *  - 그 도메인의 측정(AuditJob)이 completed 이면 found → measured
 *  - 그 도메인의 리포트가 **발송 승인**(approvedReportUrlByDomain)됐으면 found·measured → reported (+ reportUrl)
 * 답장·미팅·종료 같은 뒤 단계는 건드리지 않는다(shouldAdvance). 고객 org·측정 한도와 무관한 읽기 + 영업 테이블 쓰기만.
 *
 * @param approvedReportUrls bareDomain → 발송 승인된 리포트 URL
 */
export async function syncLeadStages(
  db: SyncDb,
  approvedReportUrls: ReadonlyMap<string, string>,
  now: Date = new Date()
): Promise<{ measured: number; reported: number }> {
  const leads = await db.salesLead.findMany({
    where: { status: { in: ["found", "measured"] } },
    select: { company: { select: { domain: true } }, id: true, status: true },
    take: SYNC_LIMIT,
  });
  const domains = [
    ...new Set(
      leads
        .map((l) => l.company.domain?.toLowerCase())
        .filter((d): d is string => Boolean(d))
    ),
  ];
  if (domains.length === 0) {
    return { measured: 0, reported: 0 };
  }
  const completed = await db.auditJob.findMany({
    where: {
      domain: { in: [...domains, ...domains.map((d) => `www.${d}`)] },
      status: "completed",
    },
    select: { domain: true },
    distinct: ["domain"],
  });
  const measuredDomains = new Set(
    completed.map((j) => j.domain.toLowerCase().replace(WWW_PREFIX_RE, ""))
  );
  const toMeasured: string[] = [];
  let reported = 0;
  for (const lead of leads) {
    const domain = lead.company.domain?.toLowerCase();
    if (!domain) {
      continue;
    }
    const status = lead.status as SalesLeadStatusId;
    const reportUrl = approvedReportUrls.get(domain);
    if (reportUrl && shouldAdvance(status, "reported")) {
      await db.salesLead.update({
        where: { id: lead.id },
        data: { reportUrl, status: "reported", statusChangedAt: now },
      });
      reported++;
    } else if (
      measuredDomains.has(domain) &&
      shouldAdvance(status, "measured")
    ) {
      toMeasured.push(lead.id);
    }
  }
  if (toMeasured.length) {
    await db.salesLead.updateMany({
      // 경합 방지: 그사이 다른 단계로 옮겨졌으면 건드리지 않는다.
      where: { id: { in: toMeasured }, status: "found" },
      data: { status: "measured", statusChangedAt: now },
    });
  }
  return { measured: toMeasured.length, reported };
}
