"use server";

import { requireAdmin } from "@repo/auth/admin";
import { database, type Prisma } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withDiscovery } from "@/lib/ax-mail/discovery/guard";
import { prismaCompanyStore } from "@/lib/ax-mail/discovery/ingest";
import {
  defaultFetchers,
  type IngestSourceResult,
  runDiscoveryIngest,
} from "@/lib/ax-mail/discovery/ingest-runner";
import {
  type ContactView,
  contactViews,
  mergeContacts,
} from "@/lib/ax-mail/discovery/screen";
import { segmentFilterSchema } from "@/lib/ax-mail/discovery/segment-query";
import {
  DISCOVER_PATH,
  SALES_LEAD_STATUSES,
} from "@/lib/ax-mail/discovery/view";
import { findContactEmails } from "@/lib/ax-mail/sources/contact-email";
import { assignBrandOwner } from "../brand/assign";
import { runMeasureOne } from "./measure";

/**
 * 「회사 찾기」 서버액션 — 2026-10-07.
 *
 * 🔒 모든 함수 첫 줄이 `requireAdmin()` 이다(측정 콘솔과 같은 규칙).
 * 🔒 모든 DB 접근은 `withDiscovery` 안에서 — 플래그 꺼짐 → disabled, 테이블 없음 → db_not_ready(500 아님).
 * 측정은 새로 만들지 않는다: 같은 도메인 브랜드가 있으면 관리자 1건 측정(runMeasureOne),
 *   없으면 기존 브랜드 등록 흐름(assignBrandOwner → startOrgTracking)이 등록과 측정을 같이 건다.
 */

interface Failure {
  error:
    | "disabled"
    | "db_not_ready"
    | "invalid"
    | "not_found"
    | "no_domain"
    | "failed";
  message?: string;
  ok: false;
}

const idSchema = z.uuid();

function blocked(state: "disabled" | "db_not_ready"): Failure {
  return { ok: false, error: state };
}

// ── 세그먼트 ──────────────────────────────────────────────────────────────

const segmentInput = z.object({
  filter: segmentFilterSchema,
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(80),
});

export async function saveSegment(
  input: unknown
): Promise<{ ok: true; id: string } | Failure> {
  const adminId = await requireAdmin();
  const parsed = segmentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }
  const { id, name, filter } = parsed.data;
  const json = filter as Prisma.InputJsonValue;
  const guarded = await withDiscovery(async () => {
    if (id) {
      const updated = await database.segment.updateMany({
        where: { id },
        data: { filter: json, name },
      });
      return updated.count ? id : null;
    }
    const created = await database.segment.create({
      data: { createdBy: adminId, filter: json, name },
      select: { id: true },
    });
    return created.id;
  });
  if (guarded.state !== "ready") {
    return blocked(guarded.state);
  }
  if (!guarded.value) {
    return { ok: false, error: "not_found" };
  }
  revalidatePath(DISCOVER_PATH);
  return { ok: true, id: guarded.value };
}

// ── 영업 목록 ─────────────────────────────────────────────────────────────

const addInput = z.object({
  companyIds: z.array(idSchema).min(1).max(200),
  segmentId: idSchema.nullish(),
});

/** 선택한 회사 → SalesLead(found). 이미 있는 회사는 건드리지 않는다(진행 중 단계 보존). */
export async function addCompaniesToSalesList(
  input: unknown
): Promise<{ ok: true; added: number } | Failure> {
  await requireAdmin();
  const parsed = addInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }
  const { companyIds, segmentId } = parsed.data;
  const guarded = await withDiscovery(async () => {
    const existing = await database.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true },
    });
    const created = await database.salesLead.createMany({
      data: existing.map(({ id }) => ({
        companyId: id,
        segmentId: segmentId ?? null,
        status: "found" as const,
      })),
      skipDuplicates: true,
    });
    return created.count;
  });
  if (guarded.state !== "ready") {
    return blocked(guarded.state);
  }
  revalidatePath(DISCOVER_PATH);
  return { ok: true, added: guarded.value };
}

const statusInput = z.object({
  companyId: idSchema,
  status: z.enum(SALES_LEAD_STATUSES),
});

/** 사람이 단계를 직접 옮긴다(답장·미팅·계약은 자동으로 알 수 없다). 리드가 없으면 만든다. */
export async function setSalesLeadStatus(
  input: unknown
): Promise<{ ok: true } | Failure> {
  const adminId = await requireAdmin();
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }
  const { companyId, status } = parsed.data;
  const guarded = await withDiscovery(async () => {
    const company = await database.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      return false;
    }
    await database.salesLead.upsert({
      where: { companyId },
      create: { companyId, status },
      update: { status, statusChangedAt: new Date() },
    });
    return true;
  });
  if (guarded.state !== "ready") {
    return blocked(guarded.state);
  }
  if (!guarded.value) {
    return { ok: false, error: "not_found" };
  }
  log.info("admin.sales_discovery.status", { adminId, companyId, status });
  revalidatePath(DISCOVER_PATH);
  return { ok: true };
}

// ── 공개 메일 찾기 ────────────────────────────────────────────────────────

/**
 * 회사 사이트에서 공개 연락 메일을 지금 찾는다(contact-email.ts — robots·무단수집 거부 게시 준수).
 * 찾은 후보는 CompanyContact 로 남기고, 저장된 것과 합쳐 전부 돌려준다.
 */
export async function findCompanyContacts(companyId: string): Promise<
  | {
      ok: true;
      contacts: ContactView[];
      defaultRecipients: string[];
      status: string;
    }
  | Failure
> {
  await requireAdmin();
  if (!idSchema.safeParse(companyId).success) {
    return { ok: false, error: "invalid" };
  }
  const guarded = await withDiscovery(async () => {
    const company = await database.company.findUnique({
      where: { id: companyId },
      select: { contacts: true, domain: true, legalName: true },
    });
    if (!company) {
      return { kind: "not_found" as const };
    }
    if (!company.domain) {
      return { kind: "no_domain" as const };
    }
    const found = await findContactEmails({
      brandNames: [company.legalName],
      domain: company.domain,
    });
    for (const c of found.candidates) {
      const data = {
        confidence: c.confidence,
        fetchedAt: new Date(c.fetchedAt),
        label: c.label || null,
        personalName: c.personalName,
        role: c.role,
        sourceUrl: c.sourceUrl,
      };
      await database.companyContact.upsert({
        where: { companyId_email: { companyId, email: c.email } },
        create: { ...data, companyId, email: c.email },
        update: data,
      });
    }
    return {
      kind: "ok" as const,
      merged: mergeContacts(company.contacts, found.candidates),
      status: found.status,
    };
  });
  if (guarded.state !== "ready") {
    return blocked(guarded.state);
  }
  const value = guarded.value;
  if (value.kind !== "ok") {
    return { ok: false, error: value.kind };
  }
  revalidatePath(DISCOVER_PATH);
  return { ok: true, ...contactViews(value.merged), status: value.status };
}

// ── 측정 ──────────────────────────────────────────────────────────────────

export type MeasureCompanyResult =
  | {
      ok: true;
      path: "admin_measure" | "brand_register";
      jobId: string | null;
      outcome: "started" | "already_running" | "rate_limited" | "failed";
      message?: string;
    }
  | Failure;

export async function measureCompany(
  companyId: string
): Promise<MeasureCompanyResult> {
  const adminId = await requireAdmin();
  if (!idSchema.safeParse(companyId).success) {
    return { ok: false, error: "invalid" };
  }
  const guarded = await withDiscovery(async () => {
    const company = await database.company.findUnique({
      where: { id: companyId },
      select: { domain: true, industry: true, legalName: true },
    });
    if (company) {
      // 측정 대상이 된 회사는 영업 목록에 올린다(이미 있으면 그대로).
      await database.salesLead.createMany({
        data: [{ companyId, status: "found" }],
        skipDuplicates: true,
      });
    }
    return company;
  });
  if (guarded.state !== "ready") {
    return blocked(guarded.state);
  }
  const company = guarded.value;
  if (!company) {
    return { ok: false, error: "not_found" };
  }
  if (!company.domain) {
    return { ok: false, error: "no_domain" };
  }
  const domain = company.domain;
  log.info("admin.sales_discovery.measure", { adminId, companyId });
  const brand = await database.brand.findFirst({
    where: { domain: { in: [domain, `www.${domain}`] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (brand) {
    const run = await runMeasureOne(brand.id);
    if (!run.ok) {
      return { ok: false, error: "failed", message: run.error };
    }
    return {
      ok: true,
      jobId: run.started.jobId,
      outcome: run.started.skipped ? "already_running" : "started",
      path: "admin_measure",
    };
  }
  const registered = await assignBrandOwner({
    domain,
    industry: company.industry ?? undefined,
    name: company.legalName,
    source: "brand_create",
  });
  if ("error" in registered) {
    return { ok: false, error: "failed", message: registered.error };
  }
  return {
    ok: true,
    jobId: registered.jobId ?? null,
    message: registered.message,
    outcome: registered.measurement,
    path: "brand_register",
  };
}

// ── 데이터 불러오기 ───────────────────────────────────────────────────────

export async function ingestDiscoverySources(): Promise<
  { ok: true; results: IngestSourceResult[] } | Failure
> {
  const adminId = await requireAdmin();
  const guarded = await withDiscovery(() =>
    runDiscoveryIngest(prismaCompanyStore(database), defaultFetchers())
  );
  if (guarded.state !== "ready") {
    return blocked(guarded.state);
  }
  log.info("admin.sales_discovery.ingest", {
    adminId,
    results: guarded.value.map((r) => ({
      created: r.result?.created ?? 0,
      source: r.source,
      status: r.status,
    })),
  });
  revalidatePath(DISCOVER_PATH);
  return { ok: true, results: guarded.value };
}
