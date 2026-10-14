import { parseKnownCompetitors } from "@repo/audit/competitor-extract";
import {
  baselineStateOf,
  questionTypeBreakdown,
} from "@/lib/brand/question-type-breakdown";
import {
  scopedBrandById,
  scopedFirstCompletedAudit,
  scopedLatestCompletedAudit,
} from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";
import { QuestionTypeCard } from "./question-type-card";

/**
 * 질문 유형별 카드 서버 껍데기 — 이름 없는 질문 측정 기록이 **있는 브랜드에만** 그린다.
 * 실패하면 카드만 빠진다(대시보드 나머지는 영향 없음).
 */
export const QuestionTypeCardServer = async ({
  brandId,
  show,
}: {
  brandId: string | null;
  /** 이번 측정이 화면에 내놓을 만한 것인가(부모의 `currentRunPublishable`). 아니면 카드를 그리지 않는다. */
  show: boolean;
}) => {
  if (!(show && brandId)) {
    return null;
  }
  try {
    const [brand, latest, first] = await Promise.all([
      scopedBrandById(brandId),
      scopedLatestCompletedAudit(brandId),
      scopedFirstCompletedAudit(brandId),
    ]);
    if (!(brand && latest)) {
      return null;
    }
    const names = {
      name: brand.name,
      variants: Array.isArray(brand.entityVariants)
        ? brand.entityVariants.filter((v): v is string => typeof v === "string")
        : [],
      competitors: parseKnownCompetitors(brand.competitors),
    };
    const data = questionTypeBreakdown(latest.result, names);
    if (!data || data.nameless.answers === 0) {
      return null;
    }
    const baseline = first ? questionTypeBreakdown(first.result, names) : null;
    const sameJob = !first || first.id === latest.id;
    const t = (await getAppDictionary()).questionTypeCard;
    return (
      <QuestionTypeCard
        baseline={baselineStateOf(data, baseline, sameJob)}
        baselineDate={first ? first.createdAt.toISOString().slice(0, 10) : null}
        data={data}
        t={t}
      />
    );
  } catch {
    return null;
  }
};
