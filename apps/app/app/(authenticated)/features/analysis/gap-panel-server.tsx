import type { GapAnalysis } from "@/lib/gap/gap-analysis";
import { getAppDictionary } from "@/lib/i18n";
import { GapPanel } from "./gap-panel";

/** 경쟁사 빈틈 분석 서버 껍데기 — 데이터는 부모(비교 화면)가 한 번만 읽어 넘긴다. */
export const GapPanelServer = async ({
  brandId,
  data,
}: {
  brandId: string;
  data: GapAnalysis | null;
}) => {
  const dict = await getAppDictionary();
  return <GapPanel brandId={brandId} data={data} t={dict.gapPanel} />;
};
