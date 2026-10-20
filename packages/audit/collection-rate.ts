// packages/audit/collection-rate.ts — A3 수집률 계산·표시 문장 (순수 함수, 2026-10-21)
//
// 하는 일: 「N건 중 M건 수집, 반복 K회」를 만들 재료(K0 CollectionRate)와 문장을 낸다.
// ⚠️ 이 값은 **표시용**이다. 점수·판정·노출률 계산에 쓰지 않는다(대표 승인 #7). `suppressed` 는
//   「표시를 줄일지」만 알려 주고, 숫자(rate)는 억제돼도 그대로 남긴다(숨기지 않는다).
// 억제 기준값(suppression_threshold)은 **인자**다 — 코드에 숫자를 박지 않는다(사전 등록·승인에서 옴).
//
// 수집 규칙은 새로 만들지 않는다: 오류(errorMessage)·스텁(isStub) 응답은 수집에서 뺀다
//   (measurement-coverage.ts 의 countMeasurementCoverage 를 그대로 호출).
// attempted === 0 이면 rate 는 null 이다(0 이 아니다). 그때 suppressed 는 false —
//   표시할 비율 자체가 없고, 노출률도 이미 「확인 불가」로 나오기 때문이다.

import {
  countMeasurementCoverage,
  type MeasurableResponse,
  type MeasurementCoverage,
} from "./measurement-coverage";
import { safeRatio } from "./measurement-stats";
import type { CollectionRate } from "./proof-types";

export interface CollectionRateOptions {
  /** 이 값 미만이면 표시를 줄인다(0~1). null 이면 억제하지 않는다. 승인된 값을 호출자가 넘긴다. */
  suppression_threshold: number | null;
  /** 기본 "engine"(현재 코드 기준). 질문×엔진 칸 기준이면 "question_engine_cell". */
  unit?: CollectionRate["unit"];
}

/** 수집 현황 + 반복 수 → CollectionRate. 입력이 말이 안 되면(수집 > 시도, 음수) rate 는 null. */
export function buildCollectionRate(
  coverage: MeasurementCoverage,
  repeatCount: number,
  options: CollectionRateOptions
): CollectionRate {
  const { attempted, measured } = coverage;
  const valid =
    Number.isFinite(attempted) &&
    Number.isFinite(measured) &&
    attempted >= 0 &&
    measured >= 0 &&
    measured <= attempted;
  const rate = valid ? safeRatio(measured, attempted) : null;
  const threshold = options.suppression_threshold;
  return {
    attempted,
    measured,
    rate,
    repeat_count: repeatCount,
    suppressed: rate !== null && threshold !== null && rate < threshold,
    suppression_threshold: threshold,
    unit: options.unit ?? "engine",
  };
}

/** 저장 응답 행(엔진 단위)에서 바로. 같은 엔진이 여러 행이어도 엔진 1곳으로 센다(기존 규칙). */
export function collectionRateFromResponses(
  responses: readonly MeasurableResponse[] | null | undefined,
  repeatCount: number,
  options: CollectionRateOptions
): CollectionRate {
  return buildCollectionRate(
    countMeasurementCoverage(responses ? [...responses] : null),
    repeatCount,
    { ...options, unit: "engine" }
  );
}

/**
 * 질문×엔진 칸 단위 수집 현황. 칸 = 같은 질문·같은 엔진의 반복 응답 묶음.
 * 칸 안에 오류·스텁이 아닌 응답이 1개라도 있으면 그 칸은 수집됨(기존 「엔진 1번이라도 성공」 규칙과 같은 뜻).
 * 각 칸은 countMeasurementCoverage 로 판정한다(규칙 재사용).
 */
export function countCellCoverage(
  cells: readonly (readonly MeasurableResponse[])[]
): MeasurementCoverage {
  let attempted = 0;
  let measured = 0;
  for (const cell of cells) {
    if (cell.length === 0) {
      continue;
    }
    const c = countMeasurementCoverage([...cell]);
    attempted += c.attempted;
    measured += c.measured;
  }
  return { attempted, measured };
}

/** 「N건 중 M건 수집, 반복 K회」. 건수는 억제돼도 항상 보여 준다. */
export function collectionRateSentence(rate: CollectionRate): string {
  const unit =
    rate.unit === "question_engine_cell" ? "질문×엔진 칸 기준" : "엔진 기준";
  if (rate.attempted === 0) {
    return `시도한 측정 없음(${unit}), 반복 ${rate.repeat_count}회`;
  }
  const base = `${rate.attempted}건 중 ${rate.measured}건 수집, 반복 ${rate.repeat_count}회(${unit})`;
  return rate.suppressed ? `${base} — 수집률이 기준 미만` : base;
}
