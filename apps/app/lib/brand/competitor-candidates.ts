import {
  type CompetitorCandidate,
  competitorCandidatesFromResult,
  parseKnownCompetitors,
} from "@repo/audit/competitor-extract";
import { scopedLatestRunTracking } from "@/lib/db/scoped";

/**
 * 브랜드 화면용 경쟁사 후보(2026-10-14 · 설계원칙 2).
 * 최근 측정 1회분의 저장된 답변을 다시 읽는다 — 새 AI 호출 0. 저장하지 않는다(제안만).
 */
export async function loadCompetitorCandidates(brand: {
  competitors: unknown;
  entityVariants: unknown;
  id: string;
  name: string;
}): Promise<{ answersRead: number; candidates: CompetitorCandidate[] }> {
  const rows = await scopedLatestRunTracking(brand.id);
  const variants = Array.isArray(brand.entityVariants)
    ? brand.entityVariants.filter((v): v is string => typeof v === "string")
    : [];
  return competitorCandidatesFromResult(
    {
      engineResponses: rows.map((row) => ({
        engineId: row.engineId,
        rawResponse: row.rawResponse,
        errorMessage: row.errorMessage,
      })),
    },
    { name: brand.name, variants },
    parseKnownCompetitors(brand.competitors)
  );
}
