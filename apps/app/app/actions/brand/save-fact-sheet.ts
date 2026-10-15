"use server";

import { log } from "@repo/observability/log";
import { revalidatePath } from "next/cache";
import { saveFactSheet } from "@/lib/brand/fact-sheet-store";
import { scopedBrandById } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";

export type SaveFactSheetResult = { ok: true } | { error: string };

/**
 * 「내 브랜드 정보」(G1) 저장 — 🔒 현재 org 소속 브랜드인지 먼저 확인한다(남의 brand id 를 찔러도
 * 존재 여부를 흘리지 않는 동일 메시지). 정리(normalize)는 저장소가 한 곳에서 한다.
 * Brand 행·측정 경로는 건드리지 않는다 — 별도 테이블만 쓴다.
 */
export const saveBrandFactSheet = async (
  brandId: string,
  input: unknown
): Promise<SaveFactSheetResult> => {
  const dict = await getAppDictionary();
  const owned = await scopedBrandById(brandId).catch(() => null);
  if (!owned) {
    return { error: dict.brandErrors.brandForbidden };
  }
  try {
    const ok = await saveFactSheet(owned.id, input);
    if (!ok) {
      return { error: dict.factSheet.notReady };
    }
    revalidatePath("/brand");
    return { ok: true };
  } catch (error) {
    log.error(
      `[brand/save-fact-sheet] failed for brand ${owned.id}: ${
        error instanceof Error ? error.message : "unknown"
      }`
    );
    return { error: dict.factSheet.saveFailed };
  }
};
