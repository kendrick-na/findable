// packages/audit/unmeasured-breakdown.ts — A4 못 잰 사유 집계 (순수 함수, 2026-10-21)
//
// 하는 일: 저장된 회차에서 「왜 못 쟀나」를 사유별 건수·비율·행동 안내(K0 UnmeasuredRow[])로 센다.
//   못 잰 것을 0건으로 세거나 숨기지 않는다.
//
// 입력(DB 는 호출자가 읽어서 넘긴다): runs[] = { job_id, result?: unknown, error_message?: string | null }
//   - 실패한 회차는 error_message 를 넘긴다(classifyFailureMessage 가 사유 코드로 옮김, `UNMEASURABLE:` 머리표 지원).
//   - 끝난 회차는 result 를 넘긴다. 읽는 곳: measurementContext.gapDiagnostics.codes(회차 단위 사유),
//     engineResponses[](응답 단위 사유).
//
// 사유 목록과 출처:
//   · 회차(사이트·질문 수준) 18개 = GapCode — 라벨 GAP_LABEL_KO·행동 GAP_ACTION_KO 를 **재사용**(measurement-gap.ts).
//     분모 = 입력 회차 수.
//   · 응답(엔진 수준) 3개 — 이 파일에서 새로 정의(아래 RESPONSE_REASON_*):
//       stub_response     응답 행의 isStub (키 없어 만든 가짜 응답 — 「잰 것」이 아님; 오류 문구가 같이 있어도 스텁으로만 센다)
//       engine_error      응답 행의 errorMessage (스텁이 아닌 것)
//       search_unavailable 응답 행의 usage.searchUnavailable (검색을 원했지만 검색 없이 답함 → 「출처 0」은 미수집)
//     한 행은 위 셋 중 하나로만 센다(스텁 > 오류 > 검색 불가). 분모 = 응답 행 수(서비스가 끝난 hyperclova 행은 뺌).
//
// 결과 status: 입력 회차가 0 이면 `no_data`(「못 잰 게 없음」이 아니라 「볼 자료 없음」), 사유가 하나도 없으면
//   `none_unmeasured` + rows 빈 배열(없음을 명시), 있으면 `has_unmeasured`.

import { answerGroup } from "./answer-buckets";
import {
  classifyFailureMessage,
  GAP_ACTION_KO,
  GAP_LABEL_KO,
  type GapCode,
} from "./measurement-gap";
import { safeRatio } from "./measurement-stats";
import type { UnmeasuredReasonCode, UnmeasuredRow } from "./proof-types";

export interface UnmeasuredRunInput {
  /** 실패한 회차의 오류 문구. 문자열이면 실패로 보고 사유 코드로 옮긴다(빈 문자열은 unclassified). */
  error_message?: string | null;
  job_id: string;
  result?: unknown;
}

export type UnmeasuredBreakdownStatus =
  | "has_unmeasured"
  | "no_data"
  | "none_unmeasured";

export interface UnmeasuredBreakdown {
  /** 응답 단위 분모(응답 행 수, 서비스 종료 엔진 제외). */
  response_count: number;
  /** 사유가 있는 것만, GapCode 순서 → 응답 수준 3개 순서. 없으면 빈 배열(「없음」). */
  rows: UnmeasuredRow[];
  /** 회차 단위 분모(입력 회차 수). */
  run_count: number;
  status: UnmeasuredBreakdownStatus;
}

export type ResponseReasonCode = Extract<
  UnmeasuredReasonCode,
  "engine_error" | "search_unavailable" | "stub_response"
>;

export const RESPONSE_REASON_ORDER: readonly ResponseReasonCode[] = [
  "engine_error",
  "search_unavailable",
  "stub_response",
] as const;

export const RESPONSE_REASON_LABEL_KO: Record<ResponseReasonCode, string> = {
  engine_error: "엔진 응답 오류(한도 초과·429·미연결 등)",
  search_unavailable: "검색을 쓰려 했으나 검색 없이 답함(출처 0 은 미수집)",
  stub_response: "키가 없어 만든 가짜 응답(측정한 것이 아님)",
};

export const RESPONSE_REASON_ACTION_KO: Record<ResponseReasonCode, string> = {
  engine_error: "엔진 키·한도·장애 확인 후 재측정(엔진별 오류 기록 참고)",
  search_unavailable:
    "검색 도구 상태 확인 후 재측정. 이 칸의 출처 없음을 「출처 0건」으로 읽지 않는다",
  stub_response:
    "엔진 키 연결 확인 후 재측정(가짜 응답은 측정값으로 쓰지 않음)",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const GAP_CODE_ORDER = Object.keys(GAP_LABEL_KO) as GapCode[];

function isGapCode(value: unknown): value is GapCode {
  return typeof value === "string" && value in GAP_LABEL_KO;
}

/** 한 회차의 사유 코드(중복 제거). 실패 문구 + 결과에 기록된 진단 코드. */
function runCodesOf(run: UnmeasuredRunInput): Set<GapCode> {
  const codes = new Set<GapCode>();
  if (typeof run.error_message === "string") {
    for (const code of classifyFailureMessage(run.error_message)) {
      codes.add(code);
    }
  }
  if (isRecord(run.result) && isRecord(run.result.measurementContext)) {
    const diag = run.result.measurementContext.gapDiagnostics;
    if (isRecord(diag) && Array.isArray(diag.codes)) {
      for (const code of diag.codes) {
        if (isGapCode(code)) {
          codes.add(code);
        }
      }
    }
  }
  return codes;
}

function responseReasonOf(
  row: Record<string, unknown>
): ResponseReasonCode | null {
  if (row.isStub === true) {
    return "stub_response";
  }
  if (row.errorMessage) {
    return "engine_error";
  }
  const usage = row.usage;
  if (isRecord(usage) && usage.searchUnavailable === true) {
    return "search_unavailable";
  }
  return null;
}

/** 한 회차의 응답 행을 세어 사유별 건수에 더한다. 반환 = 센 응답 행 수(서비스 종료 엔진 제외). */
function countResponses(
  run: UnmeasuredRunInput,
  responseCounts: Map<ResponseReasonCode, number>
): number {
  if (!(isRecord(run.result) && Array.isArray(run.result.engineResponses))) {
    return 0;
  }
  let counted = 0;
  for (const row of run.result.engineResponses) {
    if (
      !isRecord(row) ||
      typeof row.engineId !== "string" ||
      answerGroup(row.engineId) === "retired"
    ) {
      continue;
    }
    counted += 1;
    const reason = responseReasonOf(row);
    if (reason !== null) {
      responseCounts.set(reason, (responseCounts.get(reason) ?? 0) + 1);
    }
  }
  return counted;
}

export function buildUnmeasuredBreakdown(
  runs: readonly UnmeasuredRunInput[]
): UnmeasuredBreakdown {
  const runCounts = new Map<GapCode, number>();
  const responseCounts = new Map<ResponseReasonCode, number>();
  let responseCount = 0;

  for (const run of runs) {
    for (const code of runCodesOf(run)) {
      runCounts.set(code, (runCounts.get(code) ?? 0) + 1);
    }
    responseCount += countResponses(run, responseCounts);
  }

  const rows: UnmeasuredRow[] = [];
  for (const code of GAP_CODE_ORDER) {
    const count = runCounts.get(code) ?? 0;
    if (count > 0) {
      rows.push({
        action_ko: GAP_ACTION_KO[code],
        code,
        count,
        denominator: runs.length,
        label_ko: GAP_LABEL_KO[code],
        rate: safeRatio(count, runs.length),
      });
    }
  }
  for (const code of RESPONSE_REASON_ORDER) {
    const count = responseCounts.get(code) ?? 0;
    if (count > 0) {
      rows.push({
        action_ko: RESPONSE_REASON_ACTION_KO[code],
        code,
        count,
        denominator: responseCount,
        label_ko: RESPONSE_REASON_LABEL_KO[code],
        rate: safeRatio(count, responseCount),
      });
    }
  }

  let status: UnmeasuredBreakdownStatus = "none_unmeasured";
  if (runs.length === 0) {
    status = "no_data";
  } else if (rows.length > 0) {
    status = "has_unmeasured";
  }
  return {
    response_count: responseCount,
    rows,
    run_count: runs.length,
    status,
  };
}
