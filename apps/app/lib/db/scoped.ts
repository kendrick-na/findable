import "server-only";

import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database, type Prisma } from "@repo/database";

/**
 * 조직(org) 스코핑 헬퍼 — 서버 전용.
 *
 * 배경(실측): DB 모델 중 `organizationId` 직접 보유 = User·Brand·Report 뿐.
 *   Prompt·Tracking·AuditJob 은 org 키가 **없다**. 특히 Tracking 은 brand 경유로만
 *   조직에 매인다(brandId → Brand.organizationId).
 *
 * ⚠️ 위험: Tracking 을 org 필터 없이 직접 쿼리하면 다른 조직 데이터가 샌다.
 *   → 이 파일의 헬퍼로만 접근해 "brand 경유 org 필터"를 강제한다.
 *
 * ⚠️ 서버 컴포넌트/서버 액션에서만 사용(server-only). 클라이언트는 이 값에 접근 못 함.
 */

/**
 * 현재 로그인 컨텍스트의 조직 id. 없으면 throw(비로그인·조직 미선택).
 * 게이팅이 필요한 모든 org 스코프 쿼리의 첫 줄에서 호출.
 */
export async function requireOrg(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error("FORBIDDEN: organization required");
  }
  return orgId;
}

/**
 * 현재 org 의 Brand 만. Brand 는 organizationId 직접 보유라 단순 필터.
 * @param where  추가 조건(선택). org 필터는 항상 강제 병합.
 */
export async function scopedBrands(where?: Prisma.BrandWhereInput) {
  const orgId = await requireOrg();
  return database.brand.findMany({
    where: { ...where, organizationId: orgId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 대시보드 집계에 필요한 최소 필드만. rawResponse(Text)·citedSources(Json)는 행당 수 KB라
 *   수백 행 시계열 조회에서 제외한다(원문이 필요하면 단건 전용 헬퍼를 따로 만들 것).
 */
const TRACKING_DASHBOARD_SELECT = {
  id: true,
  brandId: true,
  promptId: true,
  engineId: true,
  brandMentioned: true,
  mentionPosition: true,
  // 순위의 분모(세션N-10) — "N개 중 M번째". 도입 전 행은 null.
  mentionListSize: true,
  sentiment: true,
  shareOfVoice: true,
  trackedAt: true,
  brand: { select: { name: true, domain: true } },
  // "밀리는 질문"(2026-08-07) — 프롬프트별 성적표에 원문이 필요하다.
  //   ⚠️ rawResponse(수 KB)와 달리 프롬프트 텍스트는 행당 수십 바이트라
  //   1400행 조회에서도 부담이 없다(제외 기준은 "행당 수 KB"였다).
  prompt: { select: { text: true } },
} as const;

// 1회 측정 ≈ 프롬프트 4 × 엔진 ≤7 = ≤28행 → 1400행 ≈ 최근 50회분. 시계열엔 충분.
const TRACKING_DASHBOARD_TAKE = 1400;

/**
 * 현재 org 의 Tracking 만 — **brand 경유** org 필터(Tracking 은 org 키 없음).
 * org 키 없는 모델의 유일 방어. 반드시 이 헬퍼로만 Tracking 을 org 스코프 조회할 것.
 * P5 8-d(2026-07-30)에서 첫 활성화: 대시보드 시계열의 1차 소스.
 * @param brandId  특정 브랜드로 좁힐 때(선택). 지정 시 그 브랜드가 현재 org 소속인지도 함께 검증됨.
 */
export async function scopedTracking(brandId?: string) {
  const orgId = await requireOrg();
  return database.tracking.findMany({
    where: {
      // Tracking → brand 로 org 필터를 건다(relation filter). brandId 지정 시 추가로 좁힘.
      brand: { organizationId: orgId },
      ...(brandId ? { brandId } : {}),
    },
    orderBy: { trackedAt: "desc" },
    select: TRACKING_DASHBOARD_SELECT,
    take: TRACKING_DASHBOARD_TAKE,
  });
}

/** scopedTracking 이 반환하는 행 타입(대시보드 집계 입력). */
export type ScopedTrackingRow = Awaited<
  ReturnType<typeof scopedTracking>
>[number];

/**
 * CSV 내보내기 전용 select — 대시보드 select 에 `citedSources` 만 더 싣는다.
 * `rawResponse`(행당 수 KB, AI 응답 전체 텍스트)는 제외한다 — 스프레드시트 셀 하나에
 * 문단이 들어가면 정렬·필터가 깨지고, 이미 `/sources`·`/compare` 화면에서 보여주는
 * 정보라 CSV 로 또 실을 이유가 약하다.
 */
const TRACKING_EXPORT_SELECT = {
  ...TRACKING_DASHBOARD_SELECT,
  citedSources: true,
} as const;

// 상한 없이 기간으로만 거른다 — CSV는 화면 렌더 성능 제약이 없다.
const TRACKING_EXPORT_TAKE = 20_000;

/**
 * 내보내기(CSV)용 Tracking 조회 — org 스코프 + 선택적 기간 필터.
 * `scopedTracking` 과 달리 최근 1400행 상한이 없고, 기간(`since`)으로만 좁힌다.
 * @param brandId 특정 브랜드로 좁힐 때(선택). 지정 시 org 소속 여부도 함께 검증됨.
 * @param since 이 시각 이후 행만. 없으면 전체 기간.
 */
export async function scopedTrackingForExport(brandId?: string, since?: Date) {
  const orgId = await requireOrg();
  return database.tracking.findMany({
    where: {
      brand: { organizationId: orgId },
      ...(brandId ? { brandId } : {}),
      ...(since ? { trackedAt: { gte: since } } : {}),
    },
    orderBy: { trackedAt: "desc" },
    select: TRACKING_EXPORT_SELECT,
    take: TRACKING_EXPORT_TAKE,
  });
}

/**
 * 분석(경쟁사·인용) 전용 select — 대시보드 select 가 성능 때문에 제외한 무거운 두 필드를
 * 여기서만 싣는다(위 TRACKING_DASHBOARD_SELECT 주석의 "단건 전용 헬퍼" 지침).
 *   · rawResponse(Text): 경쟁사 순위 파싱 원문. 행당 수 KB.
 *   · citedSources(Json): 인용 도메인 집계 원본.
 * 그래서 조회 범위를 **최신 측정 1회분**으로 강하게 좁힌다(아래 take 근거).
 */
const TRACKING_ANALYSIS_SELECT = {
  id: true,
  brandId: true,
  promptId: true,
  engineId: true,
  brandMentioned: true,
  rawResponse: true,
  citedSources: true,
  trackedAt: true,
  // 🔴 2026-08-17(N-37) 추가 — 「진실의 거울」이 읽는다.
  //   `sentiment`=좋게 말하는가 · `errorMessage`=측정 실패(≠"모른다") ·
  //   `mentionPosition`=몇 번째로 말하나. 셋 다 이미 저장돼 있는데 **안 읽고 있었다**
  //   (쿼리 비용 증가 0 — 같은 행에서 컬럼만 더 가져온다).
  sentiment: true,
  errorMessage: true,
  mentionPosition: true,
  // 🔴 N-44 추가 — 👤 승인 ⓐ: 고객이 등록한 경쟁사를 **표기 병합 사전**으로 쓴다.
  //   ⚠️ 거르는 용도가 아니다(화이트리스트로 쓰면 SoV 분모가 바뀐다).
  //   쿼리 비용 증가 0 — 같은 행에서 컬럼만 더 가져온다.
  brand: {
    select: {
      name: true,
      domain: true,
      entityVariants: true,
      competitors: true,
    },
  },
} as const;

// 1회 측정 = 프롬프트 ≤8 × 엔진 ≤7 = ≤56행. 여유 2배(=최근 2회분 상한)로 잡아도
// rawResponse 포함 페이로드가 수백 KB 수준을 넘지 않게 한다.
const TRACKING_ANALYSIS_TAKE = 120;

/**
 * 특정 브랜드의 **가장 최근 측정 1회분** Tracking 행(원문·인용 포함).
 * 경쟁사 SoV·인용 도메인 분석의 공용 소스.
 *
 * 왜 "최신 1회분"인가: 경쟁 지형과 인용 출처는 시점 스냅샷으로 읽는 지표다. 여러 run 을
 * 섞으면 과거 답변의 경쟁사가 현재 지형에 합산돼 오독을 만든다(대시보드 SoV 추세가 최신
 * 브랜드로 스코프되는 것과 같은 이유 — dashboard-data.ts 참조).
 *
 * @param brandId 없으면 org 에서 가장 최근 측정된 브랜드를 자동 선택.
 * @returns 행이 없으면 빈 배열(측정 전 org).
 */
export async function scopedLatestRunTracking(brandId?: string) {
  const orgId = await requireOrg();

  // 1) 대상 run 특정: (brandId, trackedAt) 이 measurement run 의 키(persistAuditTracking 이
  //    한 측정의 모든 행에 동일 trackedAt 을 찍는다).
  const latest = await database.tracking.findFirst({
    where: {
      brand: { organizationId: orgId },
      ...(brandId ? { brandId } : {}),
    },
    orderBy: { trackedAt: "desc" },
    select: { brandId: true, trackedAt: true },
  });
  if (!latest) {
    return [];
  }

  // 2) 그 run 의 행만. org 필터는 여기서도 유지(brandId 를 URL 로 찔러보는 접근 차단).
  return database.tracking.findMany({
    where: {
      brand: { organizationId: orgId },
      brandId: latest.brandId,
      trackedAt: latest.trackedAt,
    },
    select: TRACKING_ANALYSIS_SELECT,
    take: TRACKING_ANALYSIS_TAKE,
  });
}

/** scopedLatestRunTracking 이 반환하는 행 타입(분석 집계 입력). */
export type ScopedAnalysisRow = Awaited<
  ReturnType<typeof scopedLatestRunTracking>
>[number];

/**
 * 특정 Brand 가 현재 org 소속인지 확인하고 반환. 아니면 null.
 * 단건 상세 페이지 등에서 "남의 org 브랜드 id 를 URL 로 찔러보는" 접근 차단용.
 */
export async function scopedBrandById(brandId: string) {
  const orgId = await requireOrg();
  return database.brand.findFirst({
    where: { id: brandId, organizationId: orgId },
  });
}

/** 현재 org가 소유한 퍼블리셔 콘텐츠. Publisher → Brand 경유 스코프를 항상 강제한다. */
type ContentFilterStatus =
  | "draft"
  | "publisher_review"
  | "quality_check"
  | "moderation_review"
  | "scheduled"
  | "published"
  | "archived";

export async function scopedContents(filters?: {
  query?: string;
  status?: ContentFilterStatus;
}) {
  const orgId = await requireOrg();
  return database.content.findMany({
    where: {
      publisher: { brand: { organizationId: orgId } },
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.query
        ? {
            OR: [
              { title: { contains: filters.query, mode: "insensitive" } },
              { excerpt: { contains: filters.query, mode: "insensitive" } },
              { tags: { has: filters.query } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      publisher: true,
      qualityChecks: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

/** 콘텐츠 편집 상세용 org 격리 조회. URL의 contentId로 다른 조직 글을 읽지 못하게 한다. */
export async function scopedContentById(contentId: string) {
  const orgId = await requireOrg();
  const owned = await database.content.findFirst({
    where: {
      id: contentId,
      publisher: { brand: { organizationId: orgId } },
    },
    include: {
      publisher: { include: { brand: true } },
      revisions: { orderBy: { version: "desc" }, take: 1 },
      qualityChecks: { orderBy: { createdAt: "desc" }, take: 1 },
      reviewEvents: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (owned || !(await isAdmin())) {
    return owned;
  }
  return database.content.findUnique({
    where: { id: contentId },
    include: {
      publisher: { include: { brand: true } },
      revisions: { orderBy: { version: "desc" }, take: 1 },
      qualityChecks: { orderBy: { createdAt: "desc" }, take: 1 },
      reviewEvents: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
}

// 한 브랜드의 추세 구간에 꽂히는 주석 수 상한. 차트가 핀으로 뒤덮이면 읽을 수 없다.
const ANNOTATION_TAKE = 200;

/**
 * 현재 org 의 추세 주석(감사 D2). `Annotation` 도 org 컬럼이 없어 **brand 경유** 필터가 유일 방어.
 * @param brandId 특정 브랜드로 좁힐 때(선택). 지정 시 org 소속 여부도 함께 검증된다.
 */
export async function scopedAnnotations(brandId?: string) {
  const orgId = await requireOrg();
  return database.annotation.findMany({
    where: {
      brand: { organizationId: orgId },
      ...(brandId ? { brandId } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: ANNOTATION_TAKE,
  });
}

// ──────────────────────────────────────────────────
// D11(2026-08-07): 헤더 상주 지표 전용 경량 조회.
//
// 📕 리서치 `02:50` Sistrix(1차 출처): 히어로 숫자가 **헤더에 상주** — 개요 페이지뿐 아니라
//   **모든 화면에서 보임**. 감사 D11 = "히어로가 헤더에 상주 안 함".
//
// ⚠️ 왜 scopedTracking 을 재사용하지 않나: 그건 시계열용이라 **1400행**을 끌어온다.
//   헤더 숫자 하나 때문에 그걸 **14개 화면 전부**에서 돌리면 낭비다.
//   여기선 최신 측정 1회분(≤56행)만 읽고 등장률을 계산한다.
// ──────────────────────────────────────────────────

// 1회 측정 = 프롬프트 ≤8 × 엔진 ≤7 = ≤56행. 여유 2배.
const HEADER_METRIC_TAKE = 120;

/**
 * 헤더에 상주할 최신 등장률. 측정이 없으면 null(헤더가 아무것도 안 그린다).
 * 반환: `{ brandName, sov }` — sov 는 0~100 정수(대시보드 히어로와 같은 식:
 *   언급 행 / 성공 행. Tracking 은 실패·stub 을 저장하지 않으므로 전체 행이 곧 분모다).
 */
export async function scopedHeaderMetric(): Promise<{
  brandName: string;
  sov: number;
} | null> {
  const orgId = await requireOrg();

  // 1) 가장 최근 측정된 브랜드·시각을 먼저 특정(대시보드 기본 선택과 같은 규칙).
  const latest = await database.tracking.findFirst({
    orderBy: { trackedAt: "desc" },
    select: {
      brand: { select: { domain: true, name: true } },
      brandId: true,
      trackedAt: true,
    },
    where: { brand: { organizationId: orgId } },
  });
  if (!latest) {
    return null;
  }

  // 2) 그 run 의 행만. (brandId, trackedAt) 이 measurement run 의 키다.
  //    ⚠️ org 필터를 **여기서도 유지**한다 — 1단계에서 특정한 brandId 라 논리적으로는
  //    중복이지만, 이 파일의 규칙(Tracking 은 항상 brand 경유 org 필터)을 예외 없이
  //    지키는 편이 안전하다. scopedLatestRunTracking 도 같은 방식이다.
  const rows = await database.tracking.findMany({
    select: { brandMentioned: true },
    take: HEADER_METRIC_TAKE,
    where: {
      brand: { organizationId: orgId },
      brandId: latest.brandId,
      trackedAt: latest.trackedAt,
    },
  });
  if (rows.length === 0) {
    return null;
  }

  const mentioned = rows.filter((row) => row.brandMentioned).length;
  return {
    brandName: latest.brand.name || latest.brand.domain,
    sov: Math.round((mentioned / rows.length) * 100),
  };
}
