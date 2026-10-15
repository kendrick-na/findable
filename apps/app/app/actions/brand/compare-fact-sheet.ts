"use server";

import { resolveOfficialSiteIdentity } from "@repo/audit/official-site-identity";
import { log } from "@repo/observability/log";
import {
  type CompareResult,
  compareWithSite,
} from "@/lib/brand/fact-sheet-compare";
import { scopedBrandById } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";

export type CompareFactSheetResult =
  | { ok: true; result: CompareResult; siteRead: boolean }
  | { error: string };

/**
 * 「사이트와 비교하기」 — 고객 도메인 홈페이지를 한 번 읽어 상호·사업자번호를 입력값과 견준다.
 * 🔒 현재 org 소속 브랜드만. 측정·저장은 건드리지 않는다(읽기 전용, 결과는 화면에만).
 * 사이트를 못 읽으면 `siteRead:false` — 추정하지 않고 "못 찾음"으로 보여 준다.
 */
export const compareFactSheetWithSite = async (
  brandId: string
): Promise<CompareFactSheetResult> => {
  const dict = await getAppDictionary();
  const owned = await scopedBrandById(brandId).catch(() => null);
  if (!owned) {
    return { error: dict.brandErrors.brandForbidden };
  }
  try {
    const site = await resolveOfficialSiteIdentity(owned.domain);
    return {
      ok: true,
      result: compareWithSite(
        { businessNumber: owned.businessNumber, legalName: owned.legalName },
        site
      ),
      siteRead: site !== null,
    };
  } catch (error) {
    log.error(
      `[brand/compare-fact-sheet] failed for brand ${owned.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );
    return { error: dict.factSheet.compareFailed };
  }
};
