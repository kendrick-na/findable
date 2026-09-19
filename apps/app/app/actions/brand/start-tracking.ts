"use server";

import { runAuditJob } from "@repo/audit/runner";
import { hasPlan } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { auth, clerkClient } from "@repo/auth/server";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { after } from "next/server";
import { requireOrg } from "@/lib/db/scoped";
import { isValidDomain, normalizeDomain } from "@/lib/domain";

/**
 * "측정 시작" 서버 액션 — 로그인 org 사용자가 브랜드의 AI 인용 audit을 트리거 (20번, P2).
 *
 * P2 전환(2026-07-29): 예전엔 이 버튼이 브라우저에서 www의 POST /api/audit/org를
 *   credentials:"include"로 크로스오리진 fetch 했다(→ CORS·크로스쿠키·오리진정합 의존의 원천).
 *   이제 러너가 @repo/audit 공유 패키지로 빠져서, app 서버에서 runAuditJob을 직접 import·실행한다.
 *   → HTTP 왕복 없음 → CORS 원천 소멸. auth()는 app 자기 세션 쿠키를 읽는다(크로스오리진 아님).
 *
 * 🔒 보안(www org route와 동일 불변식 유지):
 *   - orgId: 이 요청의 Clerk 세션에서 requireOrg()로 서버 재도출 → 위조 대상 없음.
 *   - brandId: 서버가 orgId 스코프 내에서 domain으로 도출/생성 → orgId↔brandId 정합 구조 보장.
 *   - 입력은 감사 대상(domain·brandName)만 받는다(confused-deputy 원천 차단).
 *
 * ⚠️ 실행 위치 이동에 따른 운영 주의:
 *   러너가 이제 app 프로세스에서 돌므로 AUDIT_DUAL_WRITE_ENABLED·AI Gateway 키·DATABASE_URL이
 *   app Vercel 프로젝트 env에도 있어야 한다(www에만 있으면 안 됨). flag OFF면 Tracking 적재 no-op.
 *   🆕 N-45: `AUDIT_BRIEFING_IN_MAIN_ENABLED`(네이버 브리핑 본류 편입)도 **같은 규칙**이다.
 *     app 에만 없으면 app 경로 측정은 브리핑을 건너뛰고 www 경로만 돌아 **결과가 갈린다**.
 *     ⚠️ 이 플래그는 **Firecrawl 크레딧을 쓴다** — 켜기 전 잔량 확인(👤).
 */

// ⚠️ 도메인 정규화·검증은 `@/lib/domain` 하나에만 둔다(이 파일은 `"use server"` 라
//   **동기 함수를 export 할 수 없다** — 하면 tsc·lint 는 통과하고 빌드에서만 터진다).

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** DB JSON 필드에 저장된 별칭만 안전하게 러너 입력으로 넘긴다. */
const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      )
    : [];

/**
 * org row가 DB에 있도록 보장(lazy 적재). relationMode="prisma"라 FK가 강제되지 않아
 *   org 없이 brand.create하면 고아 row가 조용히 생긴다 → 먼저 Clerk 기반 upsert로 채운다.
 *   ⚠️ apps/api 웹훅이 배포되면 org는 그쪽이 선적재 → findUnique에서 즉시 반환(거의 no-op).
 */
async function ensureOrgExists(
  orgId: string,
  fallbackOwnerId: string
): Promise<boolean> {
  const existing = await database.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (existing) {
    return true;
  }
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: orgId,
    });
    await database.organization.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        name: org.name ?? orgId,
        ownerId: org.createdBy ?? fallbackOwnerId,
      },
      update: {},
    });
    log.info("audit.org.lazy_created", { orgId });
    return true;
  } catch (error) {
    log.error("audit.org.lazy_failed", { orgId, error: parseError(error) });
    return false;
  }
}

/**
 * org 스코프 내에서 domain으로 Brand를 도출/생성. orgId는 세션 도출값이라
 *   여기서 만들어지는 brandId는 항상 현재 org 소속(위조 불가).
 *
 * ⚠️ export 이유(2026-08-10 세션N-13): 무료 진단만 받은 사용자가 액션을 완료 체크할 때도
 *   `ActionCompletion.brandId` FK 를 채우려면 같은 도출/생성이 필요하다.
 *   **로직을 복제하지 말고 이걸 쓸 것**(CLAUDE.md §3 중복 구현 금지) — 복제하면
 *   "org 스코프 내 domain 유일" 불변식이 두 곳에서 각자 관리된다.
 *
 * 🔒 **정규화를 함수 안에서 한다**(같은 세션): 호출부가 잊어도 안전해야 한다.
 *   `AuditJob.domain` 은 정규화가 보장되지 않아(`www.sulwhasoo.com` 과 `sulwhasoo.com`
 *   이 **DB에 둘 다 존재**) 날것으로 넣으면 같은 브랜드가 **두 건으로 갈라진다**.
 *   기존 호출부는 이미 정규화된 값을 넘기므로 멱등이라 결과가 바뀌지 않는다.
 */
export async function ensureOrgBrand(
  organizationId: string,
  rawDomain: string,
  brandName: string | undefined
): Promise<string | null> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    return null;
  }
  try {
    return await database.$transaction(async (tx) => {
      const existing = await tx.brand.findFirst({
        where: { organizationId, domain },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
      const created = await tx.brand.create({
        data: {
          organizationId,
          domain,
          name: brandName?.trim() || domain,
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    log.error("audit.org.brand_ensure_failed", {
      organizationId,
      domain,
      error: parseError(error),
    });
    return null;
  }
}

export interface StartTrackingInput {
  brandName?: string;
  domain: string;
  language?: "ko" | "en" | "both";
}

export type StartTrackingResult =
  | { ok: true; jobId: string }
  // upgrade=true 면 플랜 업그레이드로 풀리는 제한 → 버튼이 "요금제 보기" 액션을 함께 띄운다.
  | {
      error: string;
      code?: "unauthorized" | "rate_limited";
      upgrade?: boolean;
    };

/**
 * 재측정 정책(원가·429 보호) — UX 개선(2026-07-30). 차단이면 에러 결과, 통과면 null.
 *   · dedup 스코프를 도메인 전역 → **내 org**(email=`org:${orgId}`)로 한정.
 *     예전엔 다른 조직/게스트의 측정이 내 측정권을 막아 "왜 안 되지" 혼란의 원천이었다.
 *   · 진행 중(≤5분) 중복 실행은 전 플랜 차단(동시 이중 실행 방지).
 *   · 무료 플랜만 도메인당 24시간 1회. 유료(starter 이상=첫 결제 플랜)는 즉시 재측정.
 *   · stale(5분 넘게 안 끝난 진행 건)은 죽은 것으로 보고 재측정 허용.
 */
async function checkRemeasurePolicy(
  orgId: string,
  domain: string
): Promise<StartTrackingResult | null> {
  const recent = await database.auditJob.findFirst({
    where: {
      email: `org:${orgId}`,
      domain,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!recent || recent.status === "failed") {
    return null;
  }

  const age = Date.now() - recent.createdAt.getTime();
  const isRunning =
    recent.status === "processing" || recent.status === "queued";
  if (isRunning && age <= STALE_THRESHOLD_MS) {
    return {
      error:
        "이 도메인은 지금 측정이 진행 중이에요. 1~3분 뒤 대시보드에서 결과를 확인해 주세요.",
      code: "rate_limited",
    };
  }
  if (isRunning) {
    // stale → 재측정 허용.
    return null;
  }

  const plan = await getCurrentPlan();
  if (hasPlan(plan, "starter")) {
    return null;
  }
  return {
    error:
      "무료 플랜은 같은 도메인을 24시간에 1회 측정할 수 있어요. 유료 플랜에서는 언제든 다시 측정할 수 있습니다.",
    code: "rate_limited",
    upgrade: true,
  };
}

/**
 * 트리거 진입점. 서버 액션이므로 반환은 { ok, jobId } | { error } 유니온(assign.ts 패턴).
 *   무거운 audit 실행은 after()로 응답 후 백그라운드에서(www org route와 동일).
 */
export const startOrgTracking = async (
  input: StartTrackingInput
): Promise<StartTrackingResult> => {
  // 1) 인증 — orgId·userId를 app 자기 세션에서 재도출(입력 아님). 없으면 unauthorized.
  const { userId } = await auth();
  let orgId: string;
  try {
    orgId = await requireOrg();
  } catch {
    return { error: "로그인 후 조직을 선택해 주세요.", code: "unauthorized" };
  }
  if (!userId) {
    return { error: "로그인 후 조직을 선택해 주세요.", code: "unauthorized" };
  }

  // 2) 입력 검증(감사 대상만).
  const domain = normalizeDomain(input.domain ?? "");
  if (!(domain && isValidDomain(domain))) {
    return { error: "도메인 형식이 올바르지 않습니다. 예: example.com" };
  }
  const language = input.language ?? "both";
  const brandName = input.brandName?.trim() || undefined;

  try {
    // 3) 부모 Org 실재 보장(relationMode="prisma" 고아 방지).
    const orgReady = await ensureOrgExists(orgId, userId);
    if (!orgReady) {
      return {
        error:
          "조직 정보 동기화 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      };
    }

    // 4) org 스코프 brand 도출/생성.
    const brandId = await ensureOrgBrand(orgId, domain, brandName);
    if (!brandId) {
      return { error: "브랜드 준비 중 문제가 발생했습니다." };
    }

    // 5) 재측정 정책 — 차단 사유가 있으면 에러 결과 반환.
    const blocked = await checkRemeasurePolicy(orgId, domain);
    if (blocked) {
      return blocked;
    }

    // 브랜드에 저장된 업종을 job 으로 승계한다(2026-08-02).
    //   업종을 모르면 crew 가 소비재 채널을 기본값처럼 처방한다(반도체에 화장품 채널).
    //   비어 있으면 러너가 도메인으로 자동 추론하므로 기존 동작과 동일하다.
    const brandRecord = await database.brand.findUnique({
      where: { id: brandId },
      select: { entityVariants: true, industry: true, marketScope: true },
    });

    // 6) AuditJob 생성. email은 org 트리거 식별자(비로그인 intake와 스코프 구분).
    //    P5 8-b(2026-07-30): nullable FK forward-fill — org 트리거 job 을 그래프에 직접 연결.
    const job = await database.auditJob.create({
      data: {
        email: `org:${orgId}`,
        domain,
        language,
        organizationId: orgId,
        brandId,
        industry: brandRecord?.industry ?? null,
      },
      select: { id: true },
    });

    log.info("audit.org.job_created", {
      jobId: job.id,
      orgId,
      brandId,
      domain,
    });

    // 7) 백그라운드 실행 — P2 핵심: HTTP fetch 없이 러너를 app 서버에서 직접 호출.
    //    org/brandId를 서버 도출값으로 넘긴다(dual-write 게이트 충족).
    after(async () => {
      try {
        await runAuditJob({
          jobId: job.id,
          domain,
          language,
          brandName,
          // 가입/설정 단계에서 저장한 한글·영문·제품 별칭도 판정기에 전달한다.
          // 비어 있으면 러너가 도메인 기반으로 추론한 별칭을 그대로 사용한다.
          brandVariants: stringList(brandRecord?.entityVariants),
          organizationId: orgId,
          brandId,
          // 동명이인 분별 단서(mention-verdict). 없으면 기존과 동일 동작.
          industry: brandRecord?.industry ?? undefined,
          // 점수 분모를 정하는 타깃 시장. 없으면 러너가 자동 추정.
          marketScope: brandRecord?.marketScope ?? undefined,
        });
      } catch (jobError) {
        log.error("audit.org.job_uncaught", {
          jobId: job.id,
          error: parseError(jobError),
        });
      }
    });

    return { ok: true, jobId: job.id };
  } catch (error) {
    log.error("audit.org.request_unhandled", { error: parseError(error) });
    return { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }
};
