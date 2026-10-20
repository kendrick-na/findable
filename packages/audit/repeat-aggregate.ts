// packages/audit/repeat-aggregate.ts — A1-a 반복 집계 (순수 함수, 2026-10-21)
//
// 하는 일: 저장된 회차(AuditJob.result)를 「같은 조건끼리만」 묶어 노출률·오차 범위·수집률·반복 수를 낸다.
//   기준(최소 반복 수)에 못 미치면 억지로 계산하지 않고 「비교 불가(사유)」로 표시한다.
//
// 입력 모양(DB 는 호출자가 읽어서 넘긴다 — 이 파일은 DB·환경변수·외부 호출을 모른다):
//   runs: { job_id: string; completed_at: string | Date; result: unknown }[]
//     result 안에서 읽는 곳: engineResponses[](engineId·promptText·promptLang·promptKind·errorMessage·isStub·
//     mentionQuality·brandMentioned·usage.searchUnavailable …), measurementContext(engineSetKey·questionSetKey …),
//     mentionVerdictVersion. 읽기만 한다.
//   options: min_repeats(필수, 사전 등록에서 옴 — 코드에 숫자를 박지 않는다), suppression_threshold(수집률 표시 억제),
//     brand_domain, is_publishable(시험에서 주입 가능, 기본 isPublishableAuditResult).
//
// 🔴 재판정 안 함: 저장된 판정(mentionQuality 등)을 그대로 쓴다. withRecomputedAuditMetrics 를 부르지 않는다.
//   노출 집계는 summarizeAnswerBuckets(단일 계산처)를 그대로 호출하고 새 분모 규칙을 만들지 않는다.
//   판정 버전이 다른 회차는 다시 계산해 합치는 대신 **코호트를 가른다**.
//
// 순서: ① 조건(코호트)으로 먼저 가른다 → ② 그 안에서 게시 불가 회차(isPublishableAuditResult 가 아님)는
//   `withheld_not_publishable` 로 표시하고 숫자에서 뺀다(판정 버전이 현재값과 다르면 게시 불가라 그 코호트 전체가 withheld).
//
// 같은 조건 = CohortKey(K0) 가 전부 같음: 엔진 세트·언어·질문 세트 지문·측정 방식(sampling_version)·판정 버전.
//   하나라도 다르면 합치지 않는다. 언어 기록(promptLang)이 없는 회차는 코호트에 넣지 않고 not_recorded 로 따로 표기,
//   한 회차가 ko·en 을 섞어 물었으면(mixed) 어떤 코호트와도 합치지 않고 mixed_cohort 로 따로 표기한다.
//
// 질문 식별자(question_id): 저장 행에는 promptId 가 없고 promptIndex 는 회차 간 안정적이지 않을 수 있어
//   promptText 를 정규화(trim·소문자·공백 축약)한 문자열을 쓴다(question-set-key 와 같은 정규화).
//
// 오차 범위: 같은 질문의 반복 답변은 독립 표본이 아니다. Wilson 구간은 「질문×엔진 칸」 단위로 계산한다 —
//   n = 판정이 끝난 답이 있는 칸 수, k = 칸별 노출률(그 칸의 반복을 합친 비율)의 합.
//   점추정(exposure_rate)은 summarizeAnswerBuckets 합산 그대로라서, 칸마다 반복 수가 다르면 구간의 중심과
//   점추정이 다를 수 있다. 둘 다 `cell_level` 로 드러낸다(숨기지 않는다).

import {
  type AnswerBucket,
  answerGroup,
  type BucketableAnswer,
  isDiscoveryAnswer,
  summarizeAnswerBuckets,
} from "./answer-buckets";
import {
  buildCollectionRate,
  type CollectionRateOptions,
  countCellCoverage,
} from "./collection-rate";
import type { MeasurableResponse } from "./measurement-coverage";
import { safeRatio, wilsonInterval } from "./measurement-stats";
import { isPublishableAuditResult } from "./normalize-stored-metrics";
import type {
  CohortKey,
  Known,
  LanguageKey,
  NotComparableReason,
  ObservedValues,
  ProofMetricGroup,
  UnavailableReason,
} from "./proof-types";
import {
  engineSetKeyOf,
  questionLanguagesOf,
  savedQuestionSetKeyOf,
  searchSamplingVersionOf,
} from "./search-sampling-version";

// [입력·옵션]

export interface StoredRun {
  completed_at: string | Date;
  job_id: string;
  result: unknown;
}

export interface RepeatAggregateOptions {
  /** 노출률 계산에서 옛 네이버 합성 행의 공식 도메인 노출 판정에 쓴다(기존 summarizeAnswerBuckets 옵션). */
  brand_domain?: string | null;
  /** 게시 가능 판정. 기본은 기존 isPublishableAuditResult. 시험에서 주입한다. */
  is_publishable?: (result: unknown) => boolean;
  /** 코호트 하나가 비교 가능하려면 필요한 최소 반복(게시 가능한 회차) 수. 사전 등록 값을 넘긴다. */
  min_repeats: number;
  /** 수집률 표시 억제 기준(0~1) — 표시용, 점수·판정에 안 씀(A3). */
  suppression_threshold: number | null;
}

// [출력]

export type ExcludedRunReason = Extract<
  UnavailableReason | NotComparableReason,
  "mixed_cohort" | "not_recorded" | "source_missing"
>;

export interface ExcludedRun {
  detail_ko: string;
  job_id: string;
  reason: ExcludedRunReason;
}

export interface CellAggregate {
  /** 이 칸에서 오류·스텁이 아닌 응답이 1개라도 있었나(수집됨). */
  collected: boolean;
  /** 판정이 끝난 답의 합(반복 포함) = 칸 노출률의 분모. */
  denominator: number;
  engine_id: string;
  exposure_count: number;
  /** exposure_count / denominator. 분모 0 이면 null(0 아님). 0~1. */
  exposure_rate: number | null;
  group: ProofMetricGroup;
  language: LanguageKey;
  question_id: string;
  /** 이 칸에 행이 1개라도 있던 회차 수. */
  repeats_attempted: number;
  /** 판정이 끝난 답이 1개라도 있던 회차 수(= 비교에 쓰는 반복 수). */
  repeats_measured: number;
}

export interface CellLevelSummary {
  /** 판정이 끝난 답이 있는 칸 수 = Wilson 의 n. */
  cells: number;
  /** 칸별 노출률의 단순 평균(0~1). 칸이 없으면 null. Wilson 구간의 중심에 해당하는 값. */
  mean_cell_rate: number | null;
}

export interface CohortAggregate {
  cell_level: Record<ProofMetricGroup, CellLevelSummary>;
  cells: CellAggregate[];
  cohort: CohortKey;
  cohort_id: string;
  /** 이 코호트가 비교 가능한가. 아니면 not_comparable 에 사유. */
  comparable: boolean;
  /** YYYY-MM-DD(KST) — 게시 가능 회차 중 마지막 완료일. 없으면 null. */
  date_last_kst: string | null;
  first_completed_at: string;
  job_ids: string[];
  last_completed_at: string;
  min_repeats: number;
  not_comparable: NotComparableReason | null;
  observed: Record<ProofMetricGroup, Known<ObservedValues>>;
  /** 반복 수 = 숫자에 쓴(게시 가능한) 회차 수. */
  repeat_count: number;
  /** 질문 지문을 못 만들어(promptText 없음) 칸 집계에서 빠진 행 수. 합산 노출률에는 들어간다. */
  unidentified_rows: number;
  used_job_ids: string[];
  /** 게시 불가라 숫자에서 뺀 회차(withheld_not_publishable). */
  withheld_job_ids: string[];
}

export interface RepeatAggregateResult {
  cohorts: CohortAggregate[];
  excluded_runs: ExcludedRun[];
}

// [질문 식별·묶음 규칙]

/** question_id: promptText 정규화 지문(trim·소문자·공백 축약). question-set-key 와 같은 정규화. */
export function normalizeQuestionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 한 행이 어느 묶음에 속하나 — summarizeAnswerBuckets 의 그룹 규칙을 그대로 따른다:
 * 브리핑·은퇴 엔진은 제외, 이름 없는 질문(discovery)은 AI 엔진만, 검색 엔진은 search, 나머지는 ai_brand.
 */
export function proofGroupOf(row: BucketableAnswer): ProofMetricGroup | null {
  const group = answerGroup(row.engineId);
  if (group === "briefing" || group === "retired") {
    return null;
  }
  if (isDiscoveryAnswer(row)) {
    return group === "ai" ? "discovery" : null;
  }
  return group === "search" ? "search" : "ai_brand";
}

const GROUPS: readonly ProofMetricGroup[] = [
  "ai_brand",
  "discovery",
  "search",
] as const;

interface StoredRow extends BucketableAnswer {
  promptText?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsOf(result: unknown): StoredRow[] {
  if (!(isRecord(result) && Array.isArray(result.engineResponses))) {
    return [];
  }
  return result.engineResponses.filter(
    (row): row is StoredRow => isRecord(row) && typeof row.engineId === "string"
  );
}

function verdictVersionOf(result: unknown): number | null {
  if (!isRecord(result)) {
    return null;
  }
  const v = result.mentionVerdictVersion;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function languageKeyOf(result: unknown): LanguageKey | "not_recorded" {
  const langs = questionLanguagesOf(result);
  if (langs === null) {
    return "not_recorded";
  }
  if (langs === "ko") {
    return { language: "ko", script: "Hang" };
  }
  if (langs === "en") {
    return { language: "en", script: "Latn" };
  }
  // questionLanguagesOf 는 두 언어가 섞이면 정렬된 "en-ko" 를 낸다. 그 밖의 값은 언어를 모르는 것이다.
  if (langs === "en-ko" || langs === "ko-en") {
    return { language: "mixed", script: null };
  }
  return { language: "unknown", script: null };
}

function toIso(value: string | Date): string | null {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각 → YYYY-MM-DD (한국 시간). */
export function kstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function cohortIdOf(key: CohortKey): string {
  return JSON.stringify([
    key.engine_set_key,
    key.language.language,
    key.language.script,
    key.question_set_key,
    key.sampling_version,
    key.verdict_version,
  ]);
}

// [칸 집계]

interface CellAcc {
  denominator: number;
  engine_id: string;
  exposure_count: number;
  group: ProofMetricGroup;
  question_id: string;
  repeats_attempted: number;
  repeats_measured: number;
  responses: MeasurableResponse[];
}

/** 칸 하나(한 회차분 행)에서 판정이 끝난 답 수·노출 수를 센다 — summarizeAnswerBuckets 를 그대로 호출. */
function cellCounts(
  rows: readonly StoredRow[],
  group: ProofMetricGroup,
  brandDomain: string | null | undefined
): { adjudicated: number; exposure: number } {
  const s = summarizeAnswerBuckets(rows, { brandDomain });
  if (group === "ai_brand") {
    return { adjudicated: s.ai.adjudicated, exposure: s.ai.confirmed };
  }
  if (group === "search") {
    return {
      adjudicated: s.search?.adjudicated ?? 0,
      exposure: s.search?.confirmed ?? 0,
    };
  }
  return {
    adjudicated: s.discovery?.adjudicated ?? 0,
    exposure: s.discovery?.recommended ?? 0,
  };
}

function unavailable(
  reason: UnavailableReason,
  detail_ko: string,
  asOf: string | null
): Known<never> {
  return { as_of: asOf, detail_ko, reason, status: "unavailable" };
}

function observedFor(
  group: ProofMetricGroup,
  usedRows: readonly StoredRow[],
  cells: readonly CellAggregate[],
  cellResponses: readonly (readonly MeasurableResponse[])[],
  repeatCount: number,
  asOf: string | null,
  options: RepeatAggregateOptions
): Known<ObservedValues> {
  const summary = summarizeAnswerBuckets(usedRows, {
    brandDomain: options.brand_domain,
  });
  let buckets: Record<AnswerBucket, number> | null = null;
  let denominator = 0;
  let exposureCount = 0;
  if (group === "ai_brand" || group === "search") {
    const g = group === "ai_brand" ? summary.ai : summary.search;
    if (g && g.total > 0) {
      buckets = {
        confirmed: g.confirmed,
        different_entity: g.differentEntity,
        engine_error: g.engineError,
        unknown: g.unknown,
        unverified: g.unverified,
      };
      denominator = g.adjudicated;
      exposureCount = g.confirmed;
    }
  } else if (summary.discovery) {
    const d = summary.discovery;
    buckets = {
      confirmed: d.recommended,
      different_entity: d.differentEntity,
      engine_error: d.engineError,
      unknown: d.adjudicated - d.recommended - d.differentEntity,
      unverified: d.asked - d.adjudicated - d.engineError,
    };
    denominator = d.adjudicated;
    exposureCount = d.recommended;
  }
  if (buckets === null) {
    return unavailable(
      "not_applicable",
      "이 코호트에는 이 묶음에 해당하는 답변이 없음",
      asOf
    );
  }
  const measuredCells = cells.filter((c) => c.denominator > 0);
  const k = measuredCells.reduce((sum, c) => sum + (c.exposure_rate ?? 0), 0);
  return {
    as_of: asOf,
    status: "known",
    value: {
      buckets,
      collection: buildCollectionRate(
        countCellCoverage(cellResponses),
        repeatCount,
        {
          suppression_threshold: options.suppression_threshold,
          unit: "question_engine_cell",
        } satisfies CollectionRateOptions
      ),
      denominator,
      exposure_count: exposureCount,
      exposure_rate: safeRatio(exposureCount, denominator),
      group,
      interval: wilsonInterval(k, measuredCells.length, asOf),
    },
  };
}

/** 두 언어 키가 같은가. */
export function languageEquals(a: LanguageKey, b: LanguageKey): boolean {
  return a.language === b.language && a.script === b.script;
}

function accFor(
  cellAccs: Map<string, CellAcc>,
  group: ProofMetricGroup,
  row: StoredRow,
  questionId: string
): { acc: CellAcc; cellKey: string } {
  const cellKey = `${group}\u0000${row.engineId}\u0000${questionId}`;
  let acc = cellAccs.get(cellKey);
  if (!acc) {
    acc = {
      denominator: 0,
      engine_id: row.engineId,
      exposure_count: 0,
      group,
      question_id: questionId,
      repeats_attempted: 0,
      repeats_measured: 0,
      responses: [],
    };
    cellAccs.set(cellKey, acc);
  }
  return { acc, cellKey };
}

interface CollectedCells {
  accs: CellAcc[];
  unidentified: number;
  usedRows: StoredRow[];
}

/** 게시 가능한 회차들의 행을 칸(묶음×엔진×질문 지문)별로 모은다. */
function collectCells(
  usedRuns: readonly StoredRun[],
  brandDomain: string | null | undefined
): CollectedCells {
  const cellAccs = new Map<string, CellAcc>();
  const usedRows: StoredRow[] = [];
  let unidentified = 0;
  for (const run of usedRuns) {
    const rows = rowsOf(run.result);
    usedRows.push(...rows);
    const byCell = new Map<string, { acc: CellAcc; rows: StoredRow[] }>();
    for (const row of rows) {
      const group = proofGroupOf(row);
      if (group === null) {
        continue;
      }
      const questionId = normalizeQuestionText(
        typeof row.promptText === "string" ? row.promptText : ""
      );
      if (questionId === "") {
        unidentified += 1;
        continue;
      }
      const { acc, cellKey } = accFor(cellAccs, group, row, questionId);
      const bucket = byCell.get(cellKey) ?? { acc, rows: [] };
      bucket.rows.push(row);
      byCell.set(cellKey, bucket);
      acc.responses.push({
        engineId: row.engineId,
        errorMessage: row.errorMessage ?? null,
        isStub: row.isStub === true,
      });
    }
    for (const { acc, rows: cellRows } of byCell.values()) {
      acc.repeats_attempted += 1;
      const c = cellCounts(cellRows, acc.group, brandDomain);
      acc.denominator += c.adjudicated;
      acc.exposure_count += c.exposure;
      if (c.adjudicated > 0) {
        acc.repeats_measured += 1;
      }
    }
  }
  const accs = [...cellAccs.values()].sort(
    (a, b) =>
      a.group.localeCompare(b.group) ||
      a.question_id.localeCompare(b.question_id) ||
      a.engine_id.localeCompare(b.engine_id)
  );
  return { accs, unidentified, usedRows };
}

function toCell(a: CellAcc, language: LanguageKey): CellAggregate {
  return {
    collected: countCellCoverage([a.responses]).measured > 0,
    denominator: a.denominator,
    engine_id: a.engine_id,
    exposure_count: a.exposure_count,
    exposure_rate: safeRatio(a.exposure_count, a.denominator),
    group: a.group,
    language,
    question_id: a.question_id,
    repeats_attempted: a.repeats_attempted,
    repeats_measured: a.repeats_measured,
  };
}

function cellLevelOf(groupCells: readonly CellAggregate[]): CellLevelSummary {
  const measured = groupCells.filter((c) => c.denominator > 0);
  return {
    cells: measured.length,
    mean_cell_rate:
      measured.length === 0
        ? null
        : measured.reduce((s, c) => s + (c.exposure_rate ?? 0), 0) /
          measured.length,
  };
}

function sortRuns(
  runs: readonly { iso: string; run: StoredRun }[]
): { iso: string; run: StoredRun }[] {
  return [...runs].sort(
    (a, b) =>
      Date.parse(a.iso) - Date.parse(b.iso) ||
      a.run.job_id.localeCompare(b.run.job_id)
  );
}

function buildCohort(
  key: CohortKey,
  runs: readonly { iso: string; run: StoredRun }[],
  options: RepeatAggregateOptions
): CohortAggregate {
  const isPublishable = options.is_publishable ?? isPublishableAuditResult;
  const sorted = sortRuns(runs);
  const used = sorted.filter((r) => isPublishable(r.run.result));
  const withheld = sorted.filter((r) => !isPublishable(r.run.result));
  const lastUsed = used.at(-1)?.iso ?? null;
  const { accs, unidentified, usedRows } = collectCells(
    used.map((r) => r.run),
    options.brand_domain
  );
  const cells = accs.map((a) => toCell(a, key.language));

  const observed = {} as Record<ProofMetricGroup, Known<ObservedValues>>;
  const cellLevel = {} as Record<ProofMetricGroup, CellLevelSummary>;
  for (const group of GROUPS) {
    const groupCells = cells.filter((c) => c.group === group);
    cellLevel[group] = cellLevelOf(groupCells);
    observed[group] =
      used.length === 0
        ? unavailable(
            "withheld_not_publishable",
            "이 코호트의 회차가 모두 게시 불가 판정이라 숫자를 내지 않음",
            lastUsed
          )
        : observedFor(
            group,
            usedRows,
            groupCells,
            accs.filter((a) => a.group === group).map((a) => a.responses),
            used.length,
            lastUsed,
            options
          );
  }

  const repeatsOk = used.length >= options.min_repeats && used.length > 0;
  return {
    cell_level: cellLevel,
    cells,
    cohort: key,
    cohort_id: cohortIdOf(key),
    comparable: repeatsOk,
    date_last_kst: lastUsed === null ? null : kstDateOf(lastUsed),
    first_completed_at: sorted[0]?.iso ?? "",
    job_ids: sorted.map((r) => r.run.job_id),
    last_completed_at: sorted.at(-1)?.iso ?? "",
    min_repeats: options.min_repeats,
    not_comparable: repeatsOk ? null : "repeats_insufficient",
    observed,
    repeat_count: used.length,
    unidentified_rows: unidentified,
    used_job_ids: used.map((r) => r.run.job_id),
    withheld_job_ids: withheld.map((r) => r.run.job_id),
  };
}

/**
 * 저장된 회차들을 같은 조건(코호트)끼리 묶어 집계한다. 합칠 수 없는 회차는 합치지 않고 이유와 함께 따로 낸다.
 * 순수 함수: 같은 입력은 항상 같은 출력.
 */
export function aggregateRepeats(
  runs: readonly StoredRun[],
  options: RepeatAggregateOptions
): RepeatAggregateResult {
  const excluded: ExcludedRun[] = [];
  const byCohort = new Map<
    string,
    { key: CohortKey; runs: { iso: string; run: StoredRun }[] }
  >();
  for (const run of runs) {
    const iso = toIso(run.completed_at);
    if (iso === null) {
      excluded.push({
        detail_ko: "완료 시각을 읽을 수 없어 어느 코호트에도 넣지 않음",
        job_id: run.job_id,
        reason: "not_recorded",
      });
      continue;
    }
    if (!isRecord(run.result)) {
      excluded.push({
        detail_ko: "저장 결과가 없어 어느 코호트에도 넣지 않음",
        job_id: run.job_id,
        reason: "source_missing",
      });
      continue;
    }
    const language = languageKeyOf(run.result);
    if (language === "not_recorded") {
      excluded.push({
        detail_ko:
          "질문 언어 기록(promptLang)이 없는 회차라 코호트에 넣지 않음(언어를 추정하지 않음)",
        job_id: run.job_id,
        reason: "not_recorded",
      });
      continue;
    }
    if (language.language === "mixed") {
      excluded.push({
        detail_ko: "한 회차가 ko·en 을 섞어 물어 어떤 코호트와도 합치지 않음",
        job_id: run.job_id,
        reason: "mixed_cohort",
      });
      continue;
    }
    if (language.language === "unknown") {
      excluded.push({
        detail_ko:
          "질문 언어를 알 수 없는 회차라 어떤 코호트와도 합치지 않음(언어를 추정하지 않음)",
        job_id: run.job_id,
        reason: "not_recorded",
      });
      continue;
    }
    const key: CohortKey = {
      engine_set_key: engineSetKeyOf(run.result),
      language,
      question_set_key: savedQuestionSetKeyOf(run.result),
      sampling_version: searchSamplingVersionOf(run.result),
      verdict_version: verdictVersionOf(run.result),
    };
    const id = cohortIdOf(key);
    const bucket = byCohort.get(id) ?? { key, runs: [] };
    bucket.runs.push({ iso, run });
    byCohort.set(id, bucket);
  }
  const cohorts = [...byCohort.values()]
    .map(({ key, runs: members }) => buildCohort(key, members, options))
    .sort(
      (a, b) =>
        Date.parse(a.first_completed_at) - Date.parse(b.first_completed_at) ||
        a.cohort_id.localeCompare(b.cohort_id)
    );
  return { cohorts, excluded_runs: excluded };
}
