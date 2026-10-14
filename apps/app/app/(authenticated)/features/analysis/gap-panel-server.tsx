import { parseKnownCompetitors } from "@repo/audit/competitor-extract";
import { scopedBrandById, scopedLatestCompletedAudit } from "@/lib/db/scoped";
import { loadAnswerBrands } from "@/lib/gap/answer-brand-store";
import { answerRowsOf, buildGapAnalysis } from "@/lib/gap/gap-analysis";
import { getAppDictionary } from "@/lib/i18n";
import { GapPanel } from "./gap-panel";

/** 경쟁사 빈틈 분석 서버 껍데기 — 실패해도 이 패널만 빠진다(비교 화면 나머지는 영향 없음). */
export const GapPanelServer = async ({ brandId }: { brandId: string }) => {
  try {
    const [brand, latest, dict] = await Promise.all([
      scopedBrandById(brandId),
      scopedLatestCompletedAudit(brandId),
      getAppDictionary(),
    ]);
    if (!(brand && latest)) {
      return null;
    }
    const rows = answerRowsOf(latest.result);
    if (rows.length === 0) {
      return null;
    }
    const cached = await loadAnswerBrands(latest.id);
    const data = cached
      ? buildGapAnalysis({
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
        })
      : null;
    return <GapPanel brandId={brand.id} data={data} t={dict.gapPanel} />;
  } catch {
    return null;
  }
};
