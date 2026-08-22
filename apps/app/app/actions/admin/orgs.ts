"use server";

import { requireAdmin } from "@repo/auth/admin";
import { type Plan, planCapabilities } from "@repo/auth/plan";
import { grantPlan } from "@repo/auth/plan-grant";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";

/**
 * 운영 콘솔 — 가입 조직·초대 코드 조회/조작 (세션N-42).
 *
 * 🔴 **왜 필요한가**: KAIST 오버엣지 참여 기업이 코드로 들어오는데,
 *   **누가 가입했는지 앱에서 볼 방법이 0곳**이었다(실측: `User`·`Organization` 을
 *   조회하는 admin 화면이 없다). 운영자가 매번 SQL 을 돌려야 하는 상태였다.
 *
 * ⚠️ **Clerk 때문이 아니다** — 가입자 데이터(`User`·`Organization`)는 **우리 DB 에 있다**.
 *   Clerk 는 로그인 처리와 plan **캐시**만 담당하고 진실은 DB 다(`plan-grant.ts` 주석).
 *   즉 인증을 바꿀 이유가 없고, **화면만 없었다**.
 *
 * 🔒 모든 함수가 `requireAdmin()` 으로 시작한다 — admin 이 아니면 throw.
 *   (클라이언트 클레임을 믿지 않는다. 서버에서 매번 재확인.)
 */

export interface OrgRow {
  /** 자동 재측정 주기(시간). null = 수동만(free). */
  autoRefreshHours: number | null;
  brandCount: number;
  createdAt: Date;
  id: string;
  memberCount: number;
  name: string;
  plan: Plan;
  /** 만료일. 초대 코드로 받은 기간이 여기 보인다. null = 만료 없음(정상 유료·free). */
  planExpiresAt: Date | null;
  /** 이 조직이 실제로 측정을 돌렸는지 — "가입만 하고 안 쓰는" 곳을 가른다. */
  trackingCount: number;
}

/** 가입 조직 목록 — 최근 가입 순. */
export async function listOrgs(): Promise<OrgRow[]> {
  await requireAdmin();
  const orgs = await database.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      plan: true,
      planExpiresAt: true,
      createdAt: true,
      _count: { select: { brands: true, users: true } },
    },
    take: 200,
  });

  // 측정 횟수는 브랜드를 거쳐야 한다(Tracking 은 org 직결이 아니다).
  const trackingByOrg = await database.tracking.groupBy({
    by: ["brandId"],
    _count: { _all: true },
  });
  const brandOwners = await database.brand.findMany({
    select: { id: true, organizationId: true },
  });
  const orgOfBrand = new Map(brandOwners.map((b) => [b.id, b.organizationId]));
  const trackingCount = new Map<string, number>();
  for (const row of trackingByOrg) {
    const orgId = orgOfBrand.get(row.brandId);
    if (orgId) {
      trackingCount.set(
        orgId,
        (trackingCount.get(orgId) ?? 0) + row._count._all
      );
    }
  }

  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    plan: o.plan,
    planExpiresAt: o.planExpiresAt,
    createdAt: o.createdAt,
    brandCount: o._count.brands,
    memberCount: o._count.users,
    trackingCount: trackingCount.get(o.id) ?? 0,
    autoRefreshHours: planCapabilities(o.plan).autoRefreshHours,
  }));
}

export interface InviteRow {
  code: string;
  grantDays: number;
  grantPlan: Plan;
  id: string;
  label: string;
  maxRedemptions: number | null;
  /** 실제로 쓴 조직들 — "코드를 뿌렸는데 아무도 안 썼다"를 바로 본다. */
  redeemedBy: Array<{ organizationId: string; redeemedAt: Date }>;
  redeemedCount: number;
  validUntil: Date | null;
}

/** 초대 코드 목록 + 사용 현황. */
export async function listInviteCodes(): Promise<InviteRow[]> {
  await requireAdmin();
  const codes = await database.inviteCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      redemptions: {
        select: { organizationId: true, redeemedAt: true },
        orderBy: { redeemedAt: "desc" },
      },
    },
  });
  return codes.map((c) => ({
    id: c.id,
    code: c.code,
    label: c.label,
    grantPlan: c.grantPlan,
    grantDays: c.grantDays,
    validUntil: c.validUntil,
    maxRedemptions: c.maxRedemptions,
    redeemedCount: c.redeemedCount,
    redeemedBy: c.redemptions,
  }));
}

export type AdminResult = { ok: true } | { error: string };

/** 코드 형식 — 영문 대문자·숫자·-·_ 4~40자(최상위: lint useTopLevelRegex). */
const CODE_RE = /^[A-Z0-9_-]{4,40}$/;

/**
 * 초대 코드 생성 — 기간·한도를 운영자가 직접 정한다.
 *
 * ⚠️ 코드는 **대문자로 정규화**해 저장한다(redeem 도 대문자로 조회 — 양쪽이 같아야 한다).
 */
export async function createInviteCode(input: {
  code: string;
  grantDays: number;
  label: string;
  maxRedemptions: number | null;
  validUntil: Date | null;
}): Promise<AdminResult> {
  const adminId = await requireAdmin();
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return { error: "코드는 영문 대문자·숫자·-·_ 로 4~40자여야 해요." };
  }
  if (input.grantDays < 1 || input.grantDays > 3650) {
    return { error: "기간은 1~3650일 사이여야 해요." };
  }
  if (!input.label.trim()) {
    return { error: "어떤 코드인지 이름을 적어주세요." };
  }
  try {
    await database.inviteCode.create({
      data: {
        code,
        label: input.label.trim(),
        // ⛔ 부여 플랜은 growth 고정 — `Plan` enum 을 넓히면 상품 구성 변경이라
        //   카카오페이 심사에 걸린다(~9월 초). 필요해지면 그때 연다.
        grantPlan: "growth",
        grantDays: input.grantDays,
        validUntil: input.validUntil,
        maxRedemptions: input.maxRedemptions,
      },
    });
  } catch (error) {
    // unique 충돌이 가장 흔하다 — 사용자에게 그대로 알린다.
    log.warn("admin.invite.create_failed", { code, error: String(error) });
    return { error: "이미 있는 코드예요. 다른 코드를 써주세요." };
  }
  log.info("admin.invite.created", { code, by: adminId });
  revalidatePath("/admin/orgs");
  return { ok: true };
}

/** 기간·한도 수정. 이미 쓴 조직의 만료일은 **바뀌지 않는다**(그건 org 쪽 값이다). */
export async function updateInviteCode(input: {
  grantDays: number;
  id: string;
  maxRedemptions: number | null;
}): Promise<AdminResult> {
  await requireAdmin();
  if (input.grantDays < 1 || input.grantDays > 3650) {
    return { error: "기간은 1~3650일 사이여야 해요." };
  }
  await database.inviteCode.update({
    where: { id: input.id },
    data: {
      grantDays: input.grantDays,
      maxRedemptions: input.maxRedemptions,
    },
  });
  revalidatePath("/admin/orgs");
  return { ok: true };
}

/**
 * 조직 기간 연장/회수 — 운영자가 손으로 조정.
 *
 * 🔴 `days === 0` 이면 **즉시 회수**(free 강하)한다. 크론을 기다리지 않는다.
 * ⚠️ Clerk 캐시도 함께 밀어준다 — 안 하면 화면 게이팅이 한 박자 늦는다.
 *   (`ownerId` 로 push. 조직 멤버 전원이 아니라 소유자 기준 — 캐시일 뿐 진실은 DB.)
 */
export async function setOrgPlanDays(input: {
  days: number;
  orgId: string;
}): Promise<AdminResult> {
  const adminId = await requireAdmin();
  const org = await database.organization.findUnique({
    where: { id: input.orgId },
    select: { ownerId: true },
  });
  if (!org) {
    return { error: "조직을 찾을 수 없어요." };
  }

  const revoke = input.days <= 0;
  const plan: Plan = revoke ? "free" : "growth";
  const planExpiresAt = revoke
    ? null
    : new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);

  await database.organization.update({
    where: { id: input.orgId },
    data: { plan, planExpiresAt },
  });
  const pushed = await grantPlan(org.ownerId, plan);
  if (!pushed) {
    log.warn("admin.org.clerk_push_failed", { orgId: input.orgId, plan });
  }
  log.info("admin.org.plan_set", {
    orgId: input.orgId,
    plan,
    days: input.days,
    by: adminId,
  });
  revalidatePath("/admin/orgs");
  revalidatePath("/");
  return { ok: true };
}

// ──────────────────────────────────────────────────
// 조직 상세 — 「누가 무엇을 넣었나」 (N-46 · 👤 *"CMS 로서도 기능하도록"*)
//
// 🔴 **왜 목록이 아니라 상세인가**: 목록(`listOrgs`)은 200행까지 뽑는다.
//   거기에 브랜드·질문·멤버를 전부 join 하면 **N+1 이 200배**로 터진다.
//   운영자는 *"이 조직 뭐 쓰나"* 를 **한 곳씩** 본다 → 펼칠 때만 부른다.
//
// 🔒 `requireAdmin()` 재확인. 이 함수는 **남의 조직 데이터**를 그대로 돌려주므로
//   게이트가 뚫리면 전 고객 정보가 샌다. 클라이언트 클레임을 믿지 않는다.
//
// ⚠️ **이메일은 우리 DB 에 있다** — Clerk API 를 부르지 않는다(실측: `User.email`
//   7/7 채워져 있음). Clerk 왕복은 느리고 rate limit 이 있다.
// ──────────────────────────────────────────────────

export interface OrgMemberRow {
  createdAt: Date;
  email: string;
  id: string;
  name: string | null;
}

export interface OrgBrandRow {
  /** 고객이 등록한 경쟁사 — 없으면 빈 배열(측정마다 AI 가 새로 추측한다는 뜻). */
  competitors: string[];
  createdAt: Date;
  domain: string;
  /** 브랜드 표기 변형(Korean Entity Grounding). */
  entityVariants: string[];
  id: string;
  industry: string | null;
  /** null = 자동 추정(도메인·업종·측정 언어로 정한다). */
  marketScope: string | null;
  name: string;
  /** 이 브랜드에 등록된 추적 질문 — 무엇을 물어보는지가 결과를 정한다. */
  prompts: string[];
  trackingCount: number;
}

export interface OrgDetail {
  brands: OrgBrandRow[];
  members: OrgMemberRow[];
}

/** JSON 컬럼을 문자열 배열로 안전 변환 — 스키마가 `Json` 이라 무엇이든 들어올 수 있다. */
function toNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      // competitors 는 `{ name, domain }` 형태로도 저장된다.
      if (item && typeof item === "object" && "name" in item) {
        const name = (item as { name?: unknown }).name;
        return typeof name === "string" ? name : "";
      }
      return "";
    })
    .filter((s) => s.length > 0);
}

/** 조직 하나의 상세 — 가입자·등록 브랜드·추적 질문. */
export async function getOrgDetail(orgId: string): Promise<OrgDetail> {
  await requireAdmin();

  const [members, brands] = await Promise.all([
    database.user.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    database.brand.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        marketScope: true,
        competitors: true,
        entityVariants: true,
        createdAt: true,
        prompts: { select: { text: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { trackings: true } },
      },
    }),
  ]);

  return {
    members,
    brands: brands.map((b) => ({
      id: b.id,
      name: b.name,
      domain: b.domain,
      industry: b.industry,
      marketScope: b.marketScope,
      competitors: toNameList(b.competitors),
      entityVariants: toNameList(b.entityVariants),
      prompts: b.prompts.map((p) => p.text),
      trackingCount: b._count.trackings,
      createdAt: b.createdAt,
    })),
  };
}
