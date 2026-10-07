/**
 * 「회사 찾기」 화면 상태 ↔ URL ↔ 세그먼트 필터 — 순수 함수만(DB·서버 모듈 import 없음).
 *
 * 화면 상태는 전부 URL 쿼리에 둔다(서버 컴포넌트가 그대로 읽고, 칩은 링크로 토글):
 *   seg=<세그먼트 id> · ind=beauty,food · tag=venture · reg=서울,경기 · size=10-49
 *   grow=1 · site=1 · mail=1 · stage=<파이프라인 묶음> · sort=employees|growth|recent · page=2 · co=<회사 id>
 *
 * 칩 = 저장된 세그먼트 필터 위에 **덧붙이는** 조건이다(세그먼트를 고친 게 아니다 — 저장은 「새 조건」으로).
 */

import type { SegmentFilter } from "./segment-query";
import {
  INDUSTRIES,
  type IndustryId,
  REGIONS,
  type Region,
  SIZE_BUCKETS,
  type SizeBucket,
} from "./taxonomy";

/** 대표 지정(2026-10-07) 태그 칩 7개 — taxonomy KNOWN_TAGS 중 영업 필터에 쓰는 것만. */
export const DISCOVER_TAGS = [
  "venture",
  "vc_invested",
  "innobiz",
  "mainbiz",
  "commerce",
  "listed",
  "mfds_cosmetics",
] as const;

export type DiscoverTag = (typeof DISCOVER_TAGS)[number];

export const SORTS = ["employees", "growth", "recent"] as const;
export type DiscoverSort = (typeof SORTS)[number];

/** schema enum SalesLeadStatus 와 같은 순서(앞 → 뒤). */
export const SALES_LEAD_STATUSES = [
  "found",
  "measured",
  "reported",
  "drafted",
  "sent",
  "replied",
  "meeting",
  "won",
  "lost",
  "opted_out",
] as const;

export type SalesLeadStatusId = (typeof SALES_LEAD_STATUSES)[number];

/** 화면 하단 파이프라인 7칸: 발견 → 측정 → 리포트 → 메일 → 답장 → 미팅 → 계약/종료. */
export const PIPELINE_GROUPS = [
  { id: "found", statuses: ["found"] },
  { id: "measured", statuses: ["measured"] },
  { id: "reported", statuses: ["reported"] },
  { id: "mail", statuses: ["drafted", "sent"] },
  { id: "replied", statuses: ["replied"] },
  { id: "meeting", statuses: ["meeting"] },
  { id: "closed", statuses: ["won", "lost", "opted_out"] },
] as const satisfies readonly {
  id: string;
  statuses: readonly SalesLeadStatusId[];
}[];

export type PipelineGroupId = (typeof PIPELINE_GROUPS)[number]["id"];

export const PAGE_SIZE = 25;

/** 「성장 중」 칩 = 국민연금 비교 구간 가입자 증가율 > 0. 필터는 gte 라 아주 작은 양수로 둔다. */
export const GROWING_MIN = 0.001;

export interface DiscoverParams {
  companyId: string | null;
  growing: boolean;
  hasMail: boolean;
  hasSite: boolean;
  industries: IndustryId[];
  page: number;
  regions: Region[];
  segmentId: string | null;
  sizes: SizeBucket[];
  sort: DiscoverSort;
  stage: PipelineGroupId | null;
  tags: DiscoverTag[];
}

type RawParams = Record<string, string | string[] | undefined>;

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function listOf<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[]
): T[] {
  const seen = new Set<T>();
  for (const part of first(value).split(",")) {
    const v = part.trim();
    if ((allowed as readonly string[]).includes(v)) {
      seen.add(v as T);
    }
  }
  return allowed.filter((a) => seen.has(a));
}

function idOf(value: string | string[] | undefined): string | null {
  const v = first(value).trim();
  return ID_RE.test(v) ? v : null;
}

export function parseDiscoverParams(raw: RawParams): DiscoverParams {
  const sort = first(raw.sort);
  const stage = first(raw.stage);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    companyId: idOf(raw.co),
    growing: first(raw.grow) === "1",
    hasMail: first(raw.mail) === "1",
    hasSite: first(raw.site) === "1",
    industries: listOf(raw.ind, INDUSTRIES),
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1,
    regions: listOf(raw.reg, REGIONS),
    segmentId: idOf(raw.seg),
    sizes: listOf(raw.size, SIZE_BUCKETS),
    sort: (SORTS as readonly string[]).includes(sort)
      ? (sort as DiscoverSort)
      : "employees",
    stage: PIPELINE_GROUPS.some((g) => g.id === stage)
      ? (stage as PipelineGroupId)
      : null,
    tags: listOf(raw.tag, DISCOVER_TAGS),
  };
}

/** URL 상태 → 쿼리 문자열(기본값은 생략). */
export function discoverQuery(params: DiscoverParams): string {
  const q = new URLSearchParams();
  if (params.segmentId) {
    q.set("seg", params.segmentId);
  }
  if (params.industries.length) {
    q.set("ind", params.industries.join(","));
  }
  if (params.tags.length) {
    q.set("tag", params.tags.join(","));
  }
  if (params.regions.length) {
    q.set("reg", params.regions.join(","));
  }
  if (params.sizes.length) {
    q.set("size", params.sizes.join(","));
  }
  if (params.growing) {
    q.set("grow", "1");
  }
  if (params.hasSite) {
    q.set("site", "1");
  }
  if (params.hasMail) {
    q.set("mail", "1");
  }
  if (params.stage) {
    q.set("stage", params.stage);
  }
  if (params.sort !== "employees") {
    q.set("sort", params.sort);
  }
  if (params.page > 1) {
    q.set("page", String(params.page));
  }
  if (params.companyId) {
    q.set("co", params.companyId);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const DISCOVER_PATH = "/admin/ax-mail/discover";

/**
 * 상태 일부를 바꾼 링크. 필터가 바뀌면 1쪽으로 돌아가고 열린 카드는 닫는다
 * (page·companyId 를 직접 바꾸는 경우만 유지).
 */
export function discoverHref(
  params: DiscoverParams,
  patch: Partial<DiscoverParams>
): string {
  const keepsPosition = Object.keys(patch).every(
    (k) => k === "page" || k === "companyId"
  );
  const next: DiscoverParams = {
    ...params,
    ...(keepsPosition ? {} : { page: 1, companyId: null }),
    ...patch,
  };
  return `${DISCOVER_PATH}${discoverQuery(next)}`;
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/**
 * 세그먼트 필터 + 칩 → 실제 조회 필터.
 * 업종·지역·규모 칩은 고르면 세그먼트 값을 대신하고(같은 칸), 태그 칩은 「하나라도」로 덧붙인다.
 */
export function filterFromParams(
  params: DiscoverParams,
  segment: SegmentFilter | null
): SegmentFilter {
  const filter: SegmentFilter = { ...(segment ?? {}) };
  if (params.industries.length) {
    filter.industries = params.industries;
  }
  if (params.regions.length) {
    filter.regions = params.regions;
  }
  if (params.sizes.length) {
    filter.sizes = params.sizes;
  }
  if (params.tags.length) {
    filter.tagsAny = params.tags;
  }
  if (params.growing) {
    filter.employeeGrowthMin = Math.max(
      filter.employeeGrowthMin ?? GROWING_MIN,
      GROWING_MIN
    );
  }
  if (params.hasSite) {
    filter.hasWebsite = true;
  }
  if (params.hasMail) {
    filter.hasEmail = true;
  }
  return filter;
}

export function statusesOf(stage: PipelineGroupId): SalesLeadStatusId[] {
  const group = PIPELINE_GROUPS.find((g) => g.id === stage);
  return group ? [...group.statuses] : [];
}

/** 상태별 수 → 파이프라인 칸별 수. */
export function pipelineCounts(
  byStatus: Partial<Record<SalesLeadStatusId, number>>
): Record<PipelineGroupId, number> {
  const out = {} as Record<PipelineGroupId, number>;
  for (const group of PIPELINE_GROUPS) {
    out[group.id] = group.statuses.reduce(
      (sum, s) => sum + (byStatus[s] ?? 0),
      0
    );
  }
  return out;
}

/**
 * 자동 전이(초안 저장 → drafted 등)는 **앞으로만** 간다 — 이미 답장·미팅까지 간 리드를 되돌리지 않는다.
 * 종료 상태(won·lost·opted_out)에서는 자동으로 움직이지 않는다.
 */
export function shouldAdvance(
  current: SalesLeadStatusId,
  target: SalesLeadStatusId
): boolean {
  if (current === "won" || current === "lost" || current === "opted_out") {
    return false;
  }
  return (
    SALES_LEAD_STATUSES.indexOf(target) > SALES_LEAD_STATUSES.indexOf(current)
  );
}

// ── 연락처 역할 라벨 ──────────────────────────────────────────────────────

export type ContactRoleLabel =
  | "partnership"
  | "overseas"
  | "general"
  | "cs"
  | "privacy"
  | "press"
  | "other";

const OVERSEAS_RE = /해외|oversea|海外|global|export|수출|international/i;

/** 역할(contact-email ContactRole) + 주소 옆 글자 → 화면 라벨(제휴/해외/대표/CS/개인정보…). */
export function contactRoleLabel(
  role: string,
  label: string | null,
  email: string
): ContactRoleLabel {
  if (role === "privacy") {
    return "privacy";
  }
  if (
    (role === "partnership" || role === "other") &&
    (OVERSEAS_RE.test(label ?? "") || OVERSEAS_RE.test(email.split("@")[0]))
  ) {
    return "overseas";
  }
  switch (role) {
    case "partnership":
    case "general":
    case "cs":
    case "press":
      return role;
    default:
      return "other";
  }
}
