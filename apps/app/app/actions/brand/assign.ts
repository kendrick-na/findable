"use server";

import { planCapabilities } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { requireOrg, scopedBrandById } from "@/lib/db/scoped";
import { isValidDomain, normalizeDomain } from "@/lib/domain";
import { scheduleSiteReadinessRun } from "@/lib/site-readiness/schedule";
import { startOrgTracking } from "./start-tracking";

/**
 * 브랜드 소유 지정 — org 멤버 self(관리 액션). admin 게이트 아님.
 *
 * 배경(실측): Brand 테이블은 프로덕션에서 비어있다(audit runner 는 AuditJob 만 write).
 *   그래서 이 액션은 "org 멤버가 자기 org 에 Brand 를 수동 생성/소유지정"하는 관리 기능이다.
 *
 * org 이중방어:
 *  1) requireOrg() — 비로그인·조직 미선택이면 throw(FORBIDDEN).
 *  2) 생성 시 organizationId 는 항상 현재 orgId 로 강제(입력으로 받지 않음).
 *  3) 기존 brand 소유 지정 시 scopedBrandById 로 "현재 org 소속 여부"를 먼저 검증
 *     → 남의 org brand id 를 URL/폼으로 찔러보는 접근을 차단(재사용, 중복 구현 금지).
 *
 * 반환타입은 decide.ts 패턴대로 { ok: true } | { error: string } 유니온이되,
 *   ok 쪽은 **측정 결과를 함께 싣는다**(재설계안 v2 §3-b ⑴). 아래 주석 참조.
 */

/**
 * 등록에 이어 자동 실행한 측정의 결말(재설계안 v2 §3-b ⑴).
 *
 * 🔴 이 자리가 없으면 **조용한 실패**가 난다: 무료 플랜 24시간 1회 한도에 걸려도
 *   반환에 담을 자리가 없어 화면은 "등록했어요"만 띄우고 측정은 실제로 안 돈다.
 *   화면이 약속한 것을 제품이 지키게 하려면 결말이 반환 타입에 **자리를 가져야** 한다.
 *
 *  · started      — 측정 job 생성됨. 대기 화면으로 보낸다.
 *  · rate_limited — 한도·진행중 차단. 이미 결과가 있으니 그리로 안내한다.
 *  · failed       — 시작하지 못함. 다시 시도할 수 있게 한다.
 */
export type BrandMeasurementOutcome = "started" | "rate_limited" | "failed";

export type AssignBrandOwnerResult =
  | {
      ok: true;
      measurement: BrandMeasurementOutcome;
      /** 가입/브랜드 등록과 함께 예약된 SEO·GEO 기술 진단 실행. */
      siteReadinessRunId?: string;
      /** 측정이 시작됐을 때만. 대기 화면이 이 id 로 진행 상태를 폴링한다. */
      jobId?: string;
      /** rate_limited·failed 사유를 사용자 말로. 토스트에 그대로 쓴다. */
      message?: string;
    }
  | { error: string };

export interface AssignBrandOwnerInput {
  /** 지정할 기존 brand id. 없으면 신규 생성. */
  brandId?: string;
  domain: string;
  /**
   * 업종(선택). 비우면 측정 시 도메인으로 자동 추론한다.
   * 2026-08-02: 업종을 모르면 crew 가 소비재 채널을 기본값처럼 처방하는 문제가 있어
   * (반도체 회사에 화장품 리뷰 채널) 사용자가 직접 고칠 수 있는 경로를 연다.
   */
  industry?: string;
  /**
   * 타깃 시장(선택). 비우면 측정 시 도메인·업종·언어로 자동 추정한다.
   * 점수의 **분모**를 정한다 — 국내 전용이면 글로벌 엔진이 빠져 "글로벌 0점"이 안 나온다.
   */
  marketScope?: string;
  /**
   * 브랜드 이름 — **필수**(2026-08-21 10번 · 👤 결정으로 선택→필수 전환).
   * 🔴 예전엔 비우면 도메인을 그대로 이름으로 썼다. 그런데 그 이름이 첫 측정
   *   프롬프트에 영구 반영돼(`resolveRunPrompts` → `persistFallbackPrompts`)
   *   "sulwhasoo.com 추천해줘" 같은 도메인 문자열 질의가 나갔다(N-49 실측).
   *   측정 품질에 직결되는 값이라 서버에서도 빈 값을 거부한다(아래 검증).
   * 🔴 여기서 LLM 으로 진짜 상호를 알아내려 하지 말 것: 러너가 측정 시 이미 부른다
   *   (`resolveBrandIdentity` · runner.ts:230). 폼에서 부르면 제출만 느려진다.
   *   자동 채움이 필요하면 정적 사전만(`suggestBrandName` · 원가 0) — 폼이 이미 쓴다.
   */
  name: string;
  /** 화면 출처. 실행 권한이 아니라 실행 이력의 원인만 구분한다. */
  source?: "onboarding" | "brand_create";
}

/** DB Industry enum(닫힌 집합). 유효값일 때만 저장하고 아니면 null(=자동 추론). */
const INDUSTRY_VALUES = [
  "beauty",
  "fashion",
  "food",
  "b2b_saas",
  "content_ip",
  "retail",
  "finance",
  "healthcare",
  "education",
  "manufacturing",
  "other",
] as const;

type IndustryValue = (typeof INDUSTRY_VALUES)[number];

const toIndustry = (value?: string): IndustryValue | null => {
  const v = value?.trim().toLowerCase();
  return v && (INDUSTRY_VALUES as readonly string[]).includes(v)
    ? (v as IndustryValue)
    : null;
};

/** DB MarketScope enum. 유효값 아니면 null(=자동 추정). */
const MARKET_SCOPE_VALUES = ["korea", "global", "both"] as const;

type MarketScopeValue = (typeof MARKET_SCOPE_VALUES)[number];

const toMarketScope = (value?: string): MarketScopeValue | null => {
  const v = value?.trim().toLowerCase();
  return v && (MARKET_SCOPE_VALUES as readonly string[]).includes(v)
    ? (v as MarketScopeValue)
    : null;
};

// ⚠️ 도메인 정규화·검증은 `@/lib/domain` 하나에만 둔다(2026-08-10 세션N-13).
//   이 파일에 같은 정규식이 **세 번째로 복제**돼 있었다(start-tracking·여기·신규 경로).
//   갈라지면 한쪽만 막는 값이 생기고, 같은 브랜드가 Brand 두 건으로 나뉜다.

/**
 * 등록에 이어 측정을 시작한다(재설계안 v2 §3-a "등록하고 측정 시작").
 *
 * 🔴 **측정 로직을 여기 복제하지 않는다.** `startOrgTracking` 을 그대로 부른다 —
 *   재측정 정책(24h 한도·진행중 중복 차단·stale 판정)·org 실재 보장·백그라운드 실행이
 *   전부 거기 있고, 복제하면 두 경로가 서로 다른 한도를 적용하게 된다.
 *   그쪽은 도메인으로 brand 를 재도출하는데(`ensureOrgBrand`) 방금 만든 것이 잡히므로
 *   중복 생성되지 않는다(org 스코프 내 domain 유일).
 *
 * ⚠️ 실패해도 **등록 자체는 성공**이다 — 브랜드는 이미 저장됐다. 결말만 호출부에 알린다.
 */
const startMeasurementAfterAssign = async (
  domain: string,
  name: string
): Promise<{
  measurement: BrandMeasurementOutcome;
  jobId?: string;
  message?: string;
}> => {
  try {
    const result = await startOrgTracking({ domain, brandName: name });
    if ("error" in result) {
      return {
        measurement: result.code === "rate_limited" ? "rate_limited" : "failed",
        message: result.error,
      };
    }
    return { measurement: "started", jobId: result.jobId };
  } catch (error) {
    log.error(
      `[brand/assign] auto-measure failed: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );
    return {
      measurement: "failed",
      message: "측정을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
    };
  }
};

/**
 * 도메인 등록 직후의 기술 준비도 진단을 예약한다.
 *
 * 사이트 스캐너 실행은 `after()`에서 이어지므로 가입 응답을 기다리게 하지 않는다.
 * 예약 실패는 브랜드 저장과 AI 노출도 측정을 막지 않으며, 실패 원인은 scheduler가 기록한다.
 */
const scheduleReadinessAfterAssign = async ({
  brandId,
  domain,
  orgId,
  trigger,
}: {
  brandId: string;
  domain: string;
  orgId: string;
  trigger: "onboarding" | "brand_create" | "domain_change";
}) =>
  scheduleSiteReadinessRun({
    brandId,
    organizationId: orgId,
    targetUrl: domain,
    trigger,
  });

export const assignBrandOwner = async (
  input: AssignBrandOwnerInput
): Promise<AssignBrandOwnerResult> => {
  // 1) 미로그인/org 없음 — requireOrg throw 를 여기서 흡수.
  let orgId: string;
  try {
    orgId = await requireOrg();
  } catch {
    return { error: "로그인 후 조직을 선택해 주세요." };
  }

  // 2) 입력 검증 — **도메인·이름 둘 다 필수**(2026-08-21 10번 · 👤 결정으로 전환).
  //    🔴 이전엔 이름이 비면 도메인을 그대로 이름으로 썼다("재설계안 v2 §3-a").
  //    그런데 그 폴백이 첫 측정 프롬프트에 도메인 문자열을 그대로 박았다
  //    (`sulwhasoo.com 추천해줘` — N-49 실측). 측정 품질에 직결되는 값이라
  //    클라이언트 폼만으로는 부족해 서버에서도 막는다(폼 우회 방어).
  const domain = normalizeDomain(input.domain ?? "");
  if (!(domain && isValidDomain(domain))) {
    return { error: "도메인 형식이 올바르지 않습니다. 예: example.com" };
  }
  const name = input.name?.trim() ?? "";
  if (!name) {
    return { error: "브랜드 이름(또는 회사명)을 입력해 주세요." };
  }
  // 업종은 선택 입력이다. 유효하지 않거나 비어있으면 null → 측정 시 자동 추론.
  const industry = toIndustry(input.industry);
  const marketScope = toMarketScope(input.marketScope);

  try {
    // 3-A) 기존 brand 소유 지정 — 남의 org 접근 차단.
    if (input.brandId) {
      const owned = await scopedBrandById(input.brandId);
      if (!owned) {
        // 존재하지 않거나 다른 org 소속 → 존재 여부를 흘리지 않도록 동일 메시지.
        return { error: "해당 브랜드에 접근할 수 없습니다." };
      }
      const domainChanged = owned.domain !== domain;
      await database.brand.update({
        where: { id: owned.id },
        // organizationId 는 재확인차 현재 org 로 고정(이미 owned 이므로 멱등).
        data: { name, domain, organizationId: orgId, industry, marketScope },
      });
      revalidatePath("/brand");
      revalidatePath("/");
      const siteReadinessRunId = domainChanged
        ? await scheduleReadinessAfterAssign({
            brandId: owned.id,
            domain,
            orgId,
            trigger: "domain_change",
          })
        : undefined;
      return {
        ok: true,
        ...(await startMeasurementAfterAssign(domain, name)),
        siteReadinessRunId: siteReadinessRunId ?? undefined,
      };
    }

    // 3-B) 신규 생성 — org 내 동일 도메인 중복 차단.
    const dup = await database.brand.findFirst({
      where: { organizationId: orgId, domain },
    });
    if (dup) {
      return { error: "이미 등록된 도메인의 브랜드가 있습니다." };
    }

    // 브랜드 수 게이팅(planCapabilities SoT). free 1·starter 3·growth 5·scale+ 무제한.
    //   신규 생성일 때만(기존 소유지정 3-A 는 개수 불변). 서버 판정(우회 불가).
    const brandLimit = planCapabilities(await getCurrentPlan()).brandLimit;
    if (Number.isFinite(brandLimit)) {
      const brandCount = await database.brand.count({
        where: { organizationId: orgId },
      });
      if (brandCount >= brandLimit) {
        return {
          error: `현재 플랜은 브랜드를 ${brandLimit}개까지 등록할 수 있어요. 더 등록하려면 요금제를 올려주세요.`,
        };
      }
    }

    const brand = await database.brand.create({
      // organizationId 는 입력이 아니라 현재 orgId 강제(남의 org 생성 불가).
      data: { name, domain, organizationId: orgId, industry, marketScope },
    });
    revalidatePath("/brand");
    revalidatePath("/");
    const siteReadinessRunId = await scheduleReadinessAfterAssign({
      brandId: brand.id,
      domain,
      orgId,
      trigger: input.source ?? "brand_create",
    });
    return {
      ok: true,
      ...(await startMeasurementAfterAssign(domain, name)),
      siteReadinessRunId: siteReadinessRunId ?? undefined,
    };
  } catch (error) {
    // 6) DB 실패 — 로그만 남기고 사용자에겐 일반 메시지.
    log.error(
      `[brand/assign] failed for org ${orgId}: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );
    return { error: "브랜드 저장 중 문제가 발생했습니다." };
  }
};
