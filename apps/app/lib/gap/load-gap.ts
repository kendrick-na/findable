import { parseKnownCompetitors } from "@repo/audit/competitor-extract";
import { scopedBrandById, scopedLatestCompletedAudit } from "@/lib/db/scoped";
import { loadAnswerBrands } from "./answer-brand-store";
import {
  answerRowsOf,
  buildGapAnalysis,
  type GapAnalysis,
} from "./gap-analysis";

/** 비교 화면용: 최근 완료 측정의 빈틈 분석. 측정 답변이 없으면 null, 분석 전이면 `data: null`. 실패해도 화면은 계속 그린다. */
export async function loadGap(
  brandId: string | null | undefined,
  ready: boolean
): Promise<{ data: GapAnalysis | null } | null> {
  if (!(ready && brandId)) {
    return null;
  }
  try {
    const [brand, latest] = await Promise.all([
      scopedBrandById(brandId),
      scopedLatestCompletedAudit(brandId),
    ]);
    if (!(brand && latest)) {
      return null;
    }
    const rows = answerRowsOf(latest.result);
    if (rows.length === 0) {
      return null;
    }
    const cached = await loadAnswerBrands(latest.id);
    if (!cached) {
      return { data: null };
    }
    return {
      data: buildGapAnalysis({
        rows,
        brandsByKey: cached,
        competitors: parseKnownCompetitors(brand.competitors),
        own: {
          name: brand.name,
          domain: brand.domain,
          variants: Array.isArray(brand.entityVariants)
            ? brand.entityVariants.filter(
                (v): v is string => typeof v === "string"
              )
            : [],
        },
      }),
    };
  } catch {
    return null;
  }
}
