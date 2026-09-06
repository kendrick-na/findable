"use server";

import { isUsableRun, metricsOf, scoreOf } from "@repo/audit/run-quality";
import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import type { SiteReadinessReport } from "@/lib/site-readiness/types";

const NOTE_MAX_LENGTH = 2000;

export interface ConsultingEngineResponse {
  brandMentioned: boolean;
  citedSources: Array<{ domain: string; title: string | null; url: string }>;
  engineId: string;
  errorMessage: string | null;
  excerpt: string;
  mentionPosition: number | null;
  mentionQuality: string | null;
}

export interface ConsultingAudit {
  completedAt: Date | null;
  createdAt: Date;
  engineResponses: ConsultingEngineResponse[];
  errorCount: number;
  errorMessage: string | null;
  failedEngineIds: string[];
  geoScore: number | null;
  id: string;
  measuredAt: Date;
  mentionedResponses: number;
  responseCount: number;
  sov: number | null;
  status: string;
  usable: boolean;
}

export interface ConsultingReadiness {
  completedAt: Date | null;
  createdAt: Date;
  errorCode: string | null;
  report: SiteReadinessReport | null;
  status: string;
  trigger: string;
}

export interface ConsultingSearchConnection {
  daily: Array<{
    averagePosition: number | null;
    clicks: number | null;
    ctr: number | null;
    date: Date;
    engagedSessions: number | null;
    impressions: number | null;
    keyEvents: number | null;
    sessions: number | null;
    totalRevenue: number | null;
  }>;
  lastErrorCode: string | null;
  lastSyncedAt: Date | null;
  propertyName: string | null;
  provider: string;
  status: string;
}

export interface ConsultingBrand {
  audits: ConsultingAudit[];
  domain: string;
  id: string;
  lastAudit: ConsultingAudit | null;
  name: string;
  promptCount: number;
  readiness: ConsultingReadiness | null;
  searchConnections: ConsultingSearchConnection[];
  trackingCount: number;
}

export interface ConsultingNote {
  body: string;
  createdAt: Date;
  createdBy: string;
  id: string;
  nextCheckAt: Date | null;
}

export interface ConsultingWorkspace {
  brands: ConsultingBrand[];
  notes: ConsultingNote[];
  organization: { id: string; name: string; plan: string };
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sourceDomain(
  row: Record<string, unknown> | null,
  url: string
): string {
  const storedDomain = stringOf(row?.domain);
  if (storedDomain) {
    return storedDomain;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sourceRows(value: unknown): ConsultingEngineResponse["citedSources"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((source) => {
    const row = recordOf(source);
    const url = stringOf(row?.url);
    if (!url) {
      return [];
    }
    return [
      {
        url,
        domain: sourceDomain(row, url),
        title: stringOf(row?.title),
      },
    ];
  });
}

function toAuditSnapshot(audit: {
  completedAt: Date | null;
  createdAt: Date;
  errorMessage: string | null;
  id: string;
  result: unknown;
  status: string;
}): ConsultingAudit {
  const result = recordOf(audit.result);
  const responses = Array.isArray(result?.engineResponses)
    ? result.engineResponses.flatMap((response) => {
        const row = recordOf(response);
        const engineId = stringOf(row?.engineId);
        if (!engineId) {
          return [];
        }
        return [
          {
            engineId,
            brandMentioned: row?.brandMentioned === true,
            mentionQuality: stringOf(row?.mentionQuality),
            mentionPosition: finiteNumber(row?.mentionPosition),
            excerpt: stringOf(row?.excerpt) ?? "",
            errorMessage: stringOf(row?.errorMessage),
            citedSources: sourceRows(row?.citedSources),
          },
        ];
      })
    : [];
  const metrics = metricsOf(audit.result);
  const sov = finiteNumber(metrics?.sov);
  const failedEngineIds = [
    ...(metrics?.errors?.map((error) => error.engineId) ?? []),
    ...responses.flatMap((response) =>
      response.errorMessage ? [response.engineId] : []
    ),
  ].filter((engineId, index, values) => values.indexOf(engineId) === index);

  return {
    id: audit.id,
    status: audit.status,
    createdAt: audit.createdAt,
    completedAt: audit.completedAt,
    measuredAt: audit.completedAt ?? audit.createdAt,
    errorMessage: audit.errorMessage,
    geoScore: scoreOf(audit.result),
    sov,
    usable: isUsableRun(audit.result),
    responseCount: responses.length,
    mentionedResponses: responses.filter((response) => response.brandMentioned)
      .length,
    errorCount: failedEngineIds.length,
    failedEngineIds,
    engineResponses: responses,
  };
}

/** 고객사 하나의 컨설팅 화면 데이터. admin 검증은 이 경계를 넘기기 전에 끝낸다. */
export async function getConsultingWorkspace(
  organizationId: string
): Promise<ConsultingWorkspace | null> {
  await requireAdmin();

  const organization = await database.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      plan: true,
      brands: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          domain: true,
          _count: { select: { prompts: true, trackings: true } },
          auditJobs: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              completedAt: true,
              createdAt: true,
              errorMessage: true,
              result: true,
            },
            take: 12,
          },
          siteReadinessRuns: {
            orderBy: { createdAt: "desc" },
            select: {
              status: true,
              trigger: true,
              report: true,
              errorCode: true,
              createdAt: true,
              completedAt: true,
            },
            take: 1,
          },
          searchPerformanceConnections: {
            orderBy: { provider: "asc" },
            select: {
              provider: true,
              status: true,
              propertyName: true,
              lastSyncedAt: true,
              lastErrorCode: true,
              daily: {
                orderBy: { date: "desc" },
                take: 30,
                select: {
                  date: true,
                  clicks: true,
                  impressions: true,
                  ctr: true,
                  averagePosition: true,
                  sessions: true,
                  engagedSessions: true,
                  keyEvents: true,
                  totalRevenue: true,
                },
              },
            },
          },
        },
      },
      consultationNotes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          body: true,
          nextCheckAt: true,
          createdBy: true,
          createdAt: true,
        },
        take: 50,
      },
    },
  });
  if (!organization) {
    return null;
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      plan: organization.plan,
    },
    brands: organization.brands.map((brand) => {
      const audits = brand.auditJobs.map(toAuditSnapshot);
      const readiness = brand.siteReadinessRuns[0];
      return {
        id: brand.id,
        name: brand.name,
        domain: brand.domain,
        promptCount: brand._count.prompts,
        trackingCount: brand._count.trackings,
        audits,
        // 실패·전 엔진 오류 회차가 최신이어도 고객이 마지막으로 받은 정상 점수를 보여준다.
        lastAudit:
          audits.find(
            (audit) => audit.status === "completed" && audit.usable
          ) ??
          audits[0] ??
          null,
        readiness: readiness
          ? {
              status: readiness.status,
              trigger: readiness.trigger,
              errorCode: readiness.errorCode,
              createdAt: readiness.createdAt,
              completedAt: readiness.completedAt,
              report: recordOf(readiness.report)
                ? (readiness.report as unknown as SiteReadinessReport)
                : null,
            }
          : null,
        searchConnections: brand.searchPerformanceConnections,
      };
    }),
    notes: organization.consultationNotes,
  };
}

export type ConsultationNoteResult = { ok: true } | { error: string };

/** 운영자 피드백을 고객사별로 저장한다. 고객사 데이터 수정 권한과 섞지 않는다. */
export async function createConsultationNote(input: {
  body: string;
  nextCheckAt: string | null;
  organizationId: string;
}): Promise<ConsultationNoteResult> {
  const adminId = await requireAdmin();
  const body = input.body.trim();
  if (!body) {
    return { error: "피드백 내용을 적어주세요." };
  }
  if (body.length > NOTE_MAX_LENGTH) {
    return {
      error: `피드백은 ${NOTE_MAX_LENGTH.toLocaleString("ko-KR")}자 이내로 적어주세요.`,
    };
  }

  const nextCheckAt = input.nextCheckAt ? new Date(input.nextCheckAt) : null;
  if (nextCheckAt && Number.isNaN(nextCheckAt.getTime())) {
    return { error: "다음 점검 날짜를 다시 확인해주세요." };
  }
  const organization = await database.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true },
  });
  if (!organization) {
    return { error: "고객사를 찾을 수 없어요." };
  }

  await database.consultationNote.create({
    data: {
      organizationId: organization.id,
      body,
      nextCheckAt,
      createdBy: adminId,
    },
  });
  log.info("admin.consultation_note.created", {
    adminId,
    organizationId: organization.id,
  });
  revalidatePath(`/admin/orgs/${organization.id}`);
  return { ok: true };
}
