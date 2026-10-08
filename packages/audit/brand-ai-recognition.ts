import {
  answerGroup,
  type BucketableAnswer,
  classifyAnswer,
  isDiscoveryAnswer,
} from "./answer-buckets";
import { countMeasurementCoverage } from "./measurement-coverage";

/** AI-labelled claims must not use search, briefing, retired or discovery rows. */
export function countBrandAiRecognition(
  responses: BucketableAnswer[] | null | undefined
): { measured: number; mentioned: number } {
  const brandAiRows = (responses ?? []).filter(
    (row) => answerGroup(row.engineId) === "ai" && !isDiscoveryAnswer(row)
  );
  const measured = countMeasurementCoverage(
    brandAiRows.map(({ engineId, errorMessage, isStub }) => ({
      engineId,
      errorMessage,
      isStub: Boolean(isStub),
    }))
  ).measured;
  const mentioned = new Set(
    brandAiRows
      .filter((row) => classifyAnswer(row) === "confirmed")
      .map((row) => row.engineId)
  ).size;
  return { measured, mentioned };
}
