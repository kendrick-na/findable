"use server";

import { checkMeasureOne, startMeasureOne } from "@repo/audit/measure-one";
import { runAuditJob } from "@repo/audit/runner";
import { requireAdmin } from "@repo/auth/admin";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

/**
 * 관리자 콘솔 서버액션 — 2026-08-17 세션N-37.
 *
 * 🔒 **모든 함수 첫 줄이 `requireAdmin()`** 이다(Clerk `publicMetadata.role === "admin"`).
 *   ⚠️ 클라이언트가 보낸 값을 권한 판정에 쓰지 않는다 — 서버에서 세션으로 재도출한다.
 *
 * 🔴 **삭제 설계 — 이 저장소엔 영구 소실 이력이 있다.**
 *   그래서 지우는 힘은 주되 **실수로는 안 지워지게** 만들었다:
 *   ① 삭제 함수는 **브랜드명을 인자로 다시 받아** DB 값과 대조한다(오타면 거부).
 *   ② 지우기 전 **무엇이 함께 지워지는지 세어서 반환**한다(측정·시계열 동반 삭제 경고).
 *   ③ 전건 `log.warn` 으로 누가 무엇을 언제 지웠는지 남긴다.
 */

/**
 * 측정 1건을 **걸어둔다**(약 87원). 끝날 때까지 기다리지 않는다.
 *
 * 🔴 예전엔 `measureOneBrand()` 로 **끝까지 기다렸다가** 300초 상한에 죽었다
 *   (2026-08-17 실측: `FUNCTION_INVOCATION_TIMEOUT`, 87원만 나가고 시계열 0 증가).
 *   고객용 「측정 시작」도 처음부터 `after()` 백그라운드다 — 같은 구조로 맞춘다.
 *   화면은 `pollMeasureOne()` 으로 진행을 따라간다.
 */
export async function runMeasureOne(brandId: string) {
  const adminId = await requireAdmin();
  log.info("admin.action.measure_one", { adminId, brandId });

  try {
    const started = await startMeasureOne(brandId);
    if (!started.skipped) {
      after(async () => {
        try {
          await runAuditJob({
            brandId: started.brandId,
            brandName: started.brandName,
            domain: started.domain,
            jobId: started.jobId,
            language: "both",
            organizationId: started.organizationId,
          });
        } catch (error) {
          log.error("admin.action.measure_one.bg_failed", {
            error: String(error),
            jobId: started.jobId,
          });
        }
      });
    }
    return { ok: true as const, started };
  } catch (error) {
    log.error("admin.action.measure_one.failed", {
      adminId,
      brandId,
      error: String(error),
    });
    return { error: String(error), ok: false as const };
  }
}

/** 걸어둔 측정의 진행 상태(0원). 화면이 몇 초마다 부른다. */
export async function pollMeasureOne(jobId: string, trackingBefore: number) {
  await requireAdmin();
  const state = await checkMeasureOne(jobId, trackingBefore);
  if (state.done) {
    revalidatePath("/admin/measure");
  }
  return state;
}

/** 브랜드 목록 + 진단 지표(프롬프트·시계열·측정 이력). 0원. */
export async function listBrandsForAdmin() {
  await requireAdmin();

  const brands = await database.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, domain: true, organizationId: true },
  });

  return Promise.all(
    brands.map(async (brand) => {
      const lastJob = await database.auditJob.findFirst({
        orderBy: { createdAt: "desc" },
        select: { completedAt: true, createdAt: true, status: true },
        where: { brandId: brand.id },
      });
      return {
        ...brand,
        lastMeasuredAt: lastJob?.completedAt ?? lastJob?.createdAt ?? null,
        lastStatus: lastJob?.status ?? null,
        promptCount: await database.prompt.count({
          where: { brandId: brand.id },
        }),
        trackingRows: await database.tracking.count({
          where: { brandId: brand.id },
        }),
      };
    })
  );
}

/** 브랜드 이름·도메인 수정. */
export async function updateBrand(
  brandId: string,
  data: { domain?: string; name?: string }
) {
  const adminId = await requireAdmin();
  const patch: { domain?: string; name?: string } = {};
  if (data.name?.trim()) {
    patch.name = data.name.trim();
  }
  if (data.domain?.trim()) {
    patch.domain = data.domain.trim().toLowerCase();
  }
  if (Object.keys(patch).length === 0) {
    return { error: "바꿀 값이 없어요.", ok: false as const };
  }

  log.warn("admin.action.brand_updated", { adminId, brandId, patch });
  await database.brand.update({ data: patch, where: { id: brandId } });
  revalidatePath("/admin/measure");
  return { ok: true as const };
}

/** 삭제하면 함께 사라지는 것들을 **미리 센다**(삭제 전 확인 화면용). 0원·부작용 없음. */
export async function previewBrandDeletion(brandId: string) {
  await requireAdmin();
  const brand = await database.brand.findUnique({
    select: { id: true, name: true, domain: true },
    where: { id: brandId },
  });
  if (!brand) {
    return null;
  }
  return {
    auditJobs: await database.auditJob.count({ where: { brandId } }),
    brand,
    prompts: await database.prompt.count({ where: { brandId } }),
    trackingRows: await database.tracking.count({ where: { brandId } }),
  };
}

/**
 * 🔴 **브랜드 영구 삭제** — 측정 이력·시계열이 **함께 사라지고 되돌릴 수 없다.**
 *
 * @param confirmName 화면에서 사람이 **직접 타이핑한** 브랜드명. DB 값과 다르면 거부한다.
 *   (버튼 오클릭으로는 절대 실행되지 않게 하는 유일한 장치다.)
 */
export async function deleteBrand(brandId: string, confirmName: string) {
  const adminId = await requireAdmin();

  const brand = await database.brand.findUnique({
    select: { id: true, name: true },
    where: { id: brandId },
  });
  if (!brand) {
    return { error: "이미 없는 브랜드예요.", ok: false as const };
  }
  if (confirmName.trim() !== brand.name) {
    return {
      error: `이름이 달라요. 「${brand.name}」 을 그대로 입력해야 지워집니다.`,
      ok: false as const,
    };
  }

  const doomed = {
    auditJobs: await database.auditJob.count({ where: { brandId } }),
    prompts: await database.prompt.count({ where: { brandId } }),
    trackingRows: await database.tracking.count({ where: { brandId } }),
  };
  // 🔴 되돌릴 수 없는 작업이다 — 무엇이 사라졌는지 기록이 유일한 흔적이 된다.
  log.warn("admin.action.brand_deleted", {
    adminId,
    brandId,
    brandName: brand.name,
    ...doomed,
  });

  // 스키마상 Tracking·Prompt 는 `onDelete: Cascade`, AuditJob 은 `SetNull` 이지만
  // **`relationMode="prisma"` 라 DB 가 아니라 Prisma 클라이언트가 흉내내는 것**이다.
  // 순서를 명시해 직접 지운다 — 무엇이 지워지는지 코드에 드러나야 하고(위 로그와 일치),
  // 중간에 실패해도 어디까지 지워졌는지 알 수 있다.
  await database.tracking.deleteMany({ where: { brandId } });
  await database.prompt.deleteMany({ where: { brandId } });
  // AuditJob 은 **지우지 않는다** — 측정 이력(감사 기록)은 브랜드보다 오래 남아야 한다.
  //   `brandId` 만 끊는다(스키마 주석의 SetNull 의도와 같다).
  await database.auditJob.updateMany({
    data: { brandId: null },
    where: { brandId },
  });
  await database.brand.delete({ where: { id: brandId } });

  revalidatePath("/admin/measure");
  return { deleted: doomed, ok: true as const };
}
