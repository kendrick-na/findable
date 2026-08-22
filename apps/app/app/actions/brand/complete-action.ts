"use server";

// 액션 완료 처리 (2026-07-31 세션K-2) — 루프 닫기의 저장 측.
//
// 액션 자체는 매 측정마다 재생성되는 휘발성 데이터다(AuditJob.result.geoActions).
// 여기서는 **완료 표시만** 영속화하고, 완료 시점의 SoV·인지율을 함께 박아둔다.
// → 다음 측정에서 같은 액션이 다시 나오면 "이미 완료했고, 그때 대비 점수가 이렇게 변했다"를
//   보여줄 수 있다(Peec조차 impact 측정이 beta인 영역).
//
// 보안: start-tracking.ts 불변식 그대로 — orgId는 세션에서 도출하고,
//   brandId는 scopedBrandById 로 org 소속을 확인한 뒤에만 write 한다.

import { planCapabilities } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { scopedBrandById } from "@/lib/db/scoped";
import { isValidDomain, normalizeDomain } from "@/lib/domain";
import { ensureOrgBrand } from "./start-tracking";

export interface CompleteActionInput {
  brandId: string;
  /** 액션 종류(rank_strategy·prompt_gap·source_portfolio·content_fix·avoid). */
  kind: string;
  /** 완료 시점 인지율(0~1). before/after 대조용 스냅샷. */
  recognitionRate?: number;
  /** 완료 시점 SoV(0~100). */
  sov?: number;
  /** 같은 종류 안에서 대상 구분(프롬프트 원문·도메인). 없으면 빈 문자열. */
  target?: string;
}

export interface CompleteActionResult {
  completed: boolean;
  error?: string;
}

/**
 * 액션 완료/취소 토글. 이미 완료된 항목을 다시 호출하면 취소된다.
 */
export async function toggleActionCompletion(
  input: CompleteActionInput
): Promise<CompleteActionResult> {
  try {
    const { orgId, userId } = await auth();
    if (!(orgId && userId)) {
      return { completed: false, error: "로그인이 필요합니다." };
    }

    // org 소속 확인 — 남의 brandId 를 찔러보는 접근 차단.
    const brand = await scopedBrandById(input.brandId);
    if (!brand) {
      return { completed: false, error: "브랜드를 찾을 수 없습니다." };
    }

    const target = input.target ?? "";
    const existing = await database.actionCompletion.findUnique({
      where: {
        brandId_kind_target: {
          brandId: input.brandId,
          kind: input.kind,
          target,
        },
      },
      select: { id: true },
    });

    if (existing) {
      await database.actionCompletion.delete({ where: { id: existing.id } });
      revalidatePath("/actions");
      return { completed: false };
    }

    await database.actionCompletion.create({
      data: {
        brandId: input.brandId,
        kind: input.kind,
        target,
        sovAtCompletion: input.sov ?? null,
        recognitionAtCompletion: input.recognitionRate ?? null,
        completedBy: userId,
      },
    });
    revalidatePath("/actions");
    return { completed: true };
  } catch (error) {
    log.error("action.completion.failed", {
      brandId: input.brandId,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return { completed: false, error: "처리 중 문제가 발생했습니다." };
  }
}

// ──────────────────────────────────────────────────────────────────
// 무료 진단 경로 (2026-08-10 세션N-13)
// ──────────────────────────────────────────────────────────────────

export interface CompleteByDomainInput {
  /** 브랜드명(없으면 domain 을 이름으로 쓴다). */
  brandName?: string;
  /** 무료 진단이 측정한 도메인. 이걸로 org 안에서 Brand 를 도출/생성한다. */
  domain: string;
  kind: string;
  recognitionRate?: number;
  sov?: number;
  target?: string;
}

/**
 * 도메인 기준 액션 완료 토글 — **무료 진단만 받은 사용자용**.
 *
 * 🔴 **왜 필요한가(실측으로 드러난 구멍, 2026-08-10)**
 *   `ActionCompletion` 은 **72건 진단·7개 브랜드에도 실데이터 0건**이었다.
 *   원인은 버그가 아니라 **입구가 좁아서**다:
 *     · 처방(`/actions`)은 무료 진단 가입자에게도 **폴백으로 보인다**(`ReadOnlyActions`)
 *     · 그런데 **완료 체크는 `brandId` 를 요구**하고, `ActionCompletion.brandId` 는
 *       `Brand` FK 필수 → **무료 진단자는 저장할 곳 자체가 없었다**
 *   즉 "완료로 표시하면 다음 측정에서 점수 변화를 보여준다"는 **약속이 무료 경로에서
 *   이행 불가**였다. 이 함수가 그 구멍을 닫는다.
 *
 * 🔗 **왜 중요한가**: `ActionCompletion` 이 0건이면 **before/after 케이스를 영원히
 *   만들 수 없다**(투두 "만들지 말 것" 항목의 유일한 해소 경로가 이것이다).
 *   조치 기록이 쌓여야 "진단→조치→재측정" 루프가 데이터로 증명된다.
 *
 * 🔒 **보안 불변식은 기존 경로와 동일**:
 *   · orgId 는 **세션에서 서버 도출**(클라이언트가 보내지 않는다)
 *   · brandId 는 **그 org 스코프 안에서** domain 으로 도출/생성 → org↔brand 정합 보장
 *   · 클라이언트 입력은 **감사 대상(domain·brandName)과 액션 식별자뿐**
 *     → 남의 brandId 를 찔러볼 대상이 애초에 없다(confused-deputy 원천 차단)
 *
 * ⚠️ **부수효과 있음(의도된 것)**: 완료를 처음 누르면 **Brand 가 생성된다**.
 *   "완료 체크 = 이 브랜드를 내 것으로 등록"이라는 뜻이라 `/brand` 목록에 나타난다.
 *   프롬프트가 없으므로 **자동 측정은 시작되지 않는다**(추적 시작은 여전히 별도 행동).
 */
export async function toggleActionCompletionByDomain(
  input: CompleteByDomainInput
): Promise<CompleteActionResult> {
  const { orgId } = await auth();
  if (!orgId) {
    return { completed: false, error: "로그인이 필요합니다." };
  }

  // 🔒 교차검증(같은 세션)에서 잡은 구멍 ①: **도메인 형식 검증**.
  //   `startOrgTracking` 은 `DOMAIN_RE` 로 막는데 이 경로엔 없었다.
  //   `AuditJob.domain` 은 우리가 통제하지 않는 값이라(실측: 경로·www 포함 3종)
  //   형식이 깨진 값으로 Brand 가 생기면 이후 측정·매칭이 조용히 어긋난다.
  const domain = normalizeDomain(input.domain ?? "");
  if (!(domain && isValidDomain(domain))) {
    return { completed: false, error: "도메인 형식이 올바르지 않습니다." };
  }

  // 🔒 교차검증에서 잡은 구멍 ②: **브랜드 수 게이팅**.
  //   무료 플랜은 `brandLimit: 1` 이다. 완료 체크가 Brand 를 만드는 부수효과를 갖는 이상
  //   이 경로도 한도를 봐야 한다(안 보면 완료 버튼이 요금제 우회로가 된다).
  //   ⚠️ **이미 있는 브랜드면 통과**시킨다 — 한도는 "신규 생성"에만 걸리는 것이고
  //     (`assign.ts` 와 같은 규칙), 그러지 않으면 한도에 찬 유저가 **이미 등록한
  //     브랜드의 완료 체크마저 막힌다**(있는 데이터를 못 쓰게 되는 퇴행).
  const existing = await database.brand.findFirst({
    where: { organizationId: orgId, domain },
    select: { id: true },
  });
  if (!existing) {
    const { brandLimit } = planCapabilities(await getCurrentPlan());
    if (Number.isFinite(brandLimit)) {
      const brandCount = await database.brand.count({
        where: { organizationId: orgId },
      });
      if (brandCount >= brandLimit) {
        return {
          completed: false,
          error: `현재 플랜은 브랜드를 ${brandLimit}개까지 등록할 수 있어요. 완료 표시는 요금제를 올린 뒤 이어서 할 수 있습니다.`,
        };
      }
    }
  }

  // ⚠️ 브랜드 도출/생성 로직을 여기 복제하지 않는다(CLAUDE.md §3).
  //   start-tracking 과 같은 함수를 써야 "org 내 domain 유일" 불변식이 한 곳에서 관리된다.
  const brandId = await ensureOrgBrand(orgId, domain, input.brandName);
  if (!brandId) {
    return { completed: false, error: "브랜드를 연결하지 못했습니다." };
  }

  log.info("action.completion.by_domain", {
    orgId,
    domain,
    brandCreated: !existing,
  });

  const result = await toggleActionCompletion({
    brandId,
    kind: input.kind,
    target: input.target,
    sov: input.sov,
    recognitionRate: input.recognitionRate,
  });

  // 🔴 2차 교차검증에서 잡음: Brand 를 새로 만들었으면 `/brand` 목록과 대시보드가
  //   즉시 반영돼야 한다(`assign.ts` 와 같은 규칙). `toggleActionCompletion` 은
  //   `/actions` 만 revalidate 하므로, 완료를 눌러 브랜드가 생겨도 **목록에 안 보였다**
  //   = "등록됐다"고 안내해놓고 화면엔 없는 상태.
  if (!existing) {
    revalidatePath("/brand");
    revalidatePath("/");
  }

  return result;
}
