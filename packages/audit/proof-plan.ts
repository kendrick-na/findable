/**
 * 처방 조치 기록 양식 + 검증기 (RX-2, 2026-10-20 S4).
 *
 * 쉬운 말 풀이: 「어떤 조치를, 어느 페이지에, 어떤 질문을 겨냥해, 언제 했나」를 적는 장부의 칸 정의와,
 * 칸이 비었거나 값이 이상하면 돌려보내는 검사기다. 장부 자체는 파일(`docs/_적용/효과증명/조치기록.json`)이며 DB가 아니다.
 *
 * 규칙(`16_사전등록_초안.md` 2절과 1:1):
 *  1. 조치 유형은 `content_evidence`(질문과 맞는 통계·인용 근거 추가) 또는 `format_only`(서식·FAQ·스키마만).
 *  2. `format_only` 는 「효과 약함 가능성」 표시가 필수다(연구상 효과가 거의 없다고 보고, 우리 환경 미입증).
 *  3. 「이미 색인·검색에 걸리는 페이지인가」(예/아니오/확인 불가)는 필수 칸이다. 아니오·확인 불가는
 *     「비교 불가 가능성 높음」으로 등록한다(삭제하지 않는다).
 *  4. 대표의 「시작」 신호(start_signal_at) 전에는 실행 시각을 적을 수 없다.
 *  5. 이 파일은 계산하지 않는다. 숫자(최소 짝 수 등)는 사전 등록 문서에서 오며 여기에 박지 않는다.
 *  6. 효과·원인·노출 증가 같은 말은 어느 칸에도 쓰지 않는다(`findForbiddenPhrases`).
 *
 * 타입은 K0(`proof-types.ts`)를 `import type` 으로만 쓴다. K0는 읽기만 한다.
 */

import type { NotComparableReason } from "./proof-types";

// ──────────────────────────────────────────────────
// 값 목록
// ──────────────────────────────────────────────────

export const ACTION_TYPES = ["content_evidence", "format_only"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** 이미 색인·검색에 걸리는 페이지인가: 예 / 아니오 / 확인 불가. */
export const INDEXED_STATES = ["yes", "no", "unknown"] as const;
export type IndexedState = (typeof INDEXED_STATES)[number];

/** 예상 반영 경로: 웹 검색 색인 / 모델 지식 / 둘 다 / 모름. */
export const REFLECTION_PATHS = [
  "web_search_index",
  "model_knowledge",
  "both",
  "unknown",
] as const;
export type ReflectionPath = (typeof REFLECTION_PATHS)[number];

/** K0 `NOT_COMPARABLE_REASONS` 와 같은 값. K0는 타입만 내보내므로 검사용 목록을 여기 둔다(K0 변경 시 시험이 어긋남을 알린다). */
export const NOT_COMPARABLE_REASON_VALUES: readonly NotComparableReason[] = [
  "pairs_insufficient",
  "repeats_insufficient",
  "verdict_version_differs",
  "sampling_version_differs",
  "question_set_differs",
  "language_differs",
  "engine_set_differs",
  "collection_rate_shift",
  "mixed_cohort",
  "no_baseline",
  "no_control_pair",
  "denominator_zero",
];

// ──────────────────────────────────────────────────
// 금칙 표현 (카드·기록·스킬 문서가 함께 쓴다)
// ──────────────────────────────────────────────────

/**
 * 효과·보장·과장 표현 패턴. 「미입증」「보장하지 않는다」 같은 **부정 문장은 통과**해야 하므로 패턴을 좁게 잡았다.
 * 「독립」은 한계 문구 「독립 표본이 아니다」가 필수라서 「독립 기관」만 금지한다.
 */
export const FORBIDDEN_PHRASE_PATTERNS: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "효과 입증",
    pattern: /(?<!미)입증(?!되지|하지 못|하지 않|이 안|된 적|된 바)/,
  },
  {
    label: "효과 보장",
    pattern: /효과\s*보장(?!\s*(아님|하지|되지|은 없|할 수 없))/,
  },
  { label: "보장합니다", pattern: /보장(합니다|됩니다|해\s?드립니다|해요)/ },
  { label: "정확도 보장", pattern: /정확도\s*보장/ },
  { label: "최초", pattern: /최초/ },
  { label: "유일", pattern: /유일/ },
  { label: "독립 기관", pattern: /독립\s*기관/ },
  { label: "노출을 높여", pattern: /노출을?\s*(높여|올려)/ },
  { label: "노출이 오른", pattern: /노출이?\s*(오른|올랐|올라|늘)/ },
  { label: "덕분에", pattern: /덕분에/ },
  { label: "한국 전용", pattern: /한국\s*전용/ },
  { label: "글로벌 플랫폼", pattern: /글로벌\s*플랫폼/ },
  { label: "검증됨", pattern: /검증(됨|된)/ },
  { label: "퍼센트 수치", pattern: /\d\s*%/ },
  { label: "개선 수치(+N)", pattern: /[+＋]\s*\d/ },
  {
    label: "트래픽·매출 증가",
    pattern: /(트래픽|매출|전환)(이|을|도)?\s*(늘|증가|상승|올)/,
  },
];

/** 금칙 표현이 있으면 그 라벨 목록, 없으면 빈 배열. */
export function findForbiddenPhrases(text: string): string[] {
  return FORBIDDEN_PHRASE_PATTERNS.filter(({ pattern }) =>
    pattern.test(text)
  ).map(({ label }) => label);
}

// ──────────────────────────────────────────────────
// 기록 모양
// ──────────────────────────────────────────────────

export interface ActionRecord {
  /** 조치 ID. 기록 안에서 유일. */
  action_id: string;
  action_type: ActionType;
  /** 이미 색인·검색에 걸리는 페이지인가(필수). */
  already_indexed: IndexedState;
  /** 변경 내용 한 줄(한국어). */
  change_summary_ko: string;
  /** 실제 실행 시각(ISO, 시작 신호 이후). 실행 전이면 null. */
  executed_at: string | null;
  /** 예상 반영 경로. */
  expected_path: ReflectionPath;
  /** 색인 확인 방법(검색 콘솔·`site:` 검색 등). 확인하지 않았으면 null. */
  index_check_method: string | null;
  /** 색인 확인 시각(ISO). 확인하지 않았으면 null. */
  index_checked_at: string | null;
  /** 색인이 아니오·확인 불가면 true 여야 한다(비교 불가 가능성 높음으로 등록). */
  not_comparable_expected: boolean;
  /** 확정된 비교 불가 사유(K0 값). 아직 모르면 null. */
  not_comparable_reason: NotComparableReason | null;
  /** 실행 예정 시각(ISO). 시작 신호 전에 계획만 적을 때. */
  planned_at: string | null;
  /** 대상 페이지 URL(http/https, 계정 정보 없음). */
  target_page_url: string;
  /** 대상 질문 ID 목록(비어 있으면 안 됨). */
  target_question_ids: string[];
  /** 조치 시점의 판정 버전(`MENTION_VERDICT_VERSION`). 모르면 null. */
  verdict_version: number | null;
  /** 효과 약함 가능성 설명. `format_only` 면 필수. */
  weak_effect_note_ko: string | null;
  /** 효과 약함 가능성 표시. `format_only` 면 반드시 true. */
  weak_effect_possible: boolean;
}

export interface ActionLog {
  actions: ActionRecord[];
  /** 사전 등록 문서 식별자. 승인 전에는 null. */
  prereg_id: string | null;
  schema_version: 1;
  /** 대표의 「시작」 신호 시각(ISO). 이 값이 있어야 실행 시각을 적을 수 있다. */
  start_signal_at: string | null;
}

export interface ValidationIssue {
  message: string;
  path: string;
}

export type ValidationResult =
  | { issues: ValidationIssue[]; ok: false }
  | { ok: true };

// ──────────────────────────────────────────────────
// 검증기
// ──────────────────────────────────────────────────

const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** ISO 8601(시간대 표시 필수) 이면서 실제 존재하는 시각인가. */
export function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_RE.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function oneOf<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

function validateUrl(value: unknown): string | null {
  if (!nonEmptyString(value)) {
    return "비어 있습니다";
  }
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return "http 또는 https 주소여야 합니다";
    }
    if (u.username || u.password) {
      return "주소에 계정 정보를 넣을 수 없습니다";
    }
    return null;
  } catch {
    return "주소 형식이 아닙니다";
  }
}

type Adder = (field: string, message: string) => void;

const TIME_MESSAGE =
  "ISO 8601 시각(시간대 포함, 예: 2026-10-21T10:00:00+09:00) 또는 null 이어야 합니다";

/** 기본 칸(이름·유형·주소·질문). */
function checkBasicFields(raw: Record<string, unknown>, add: Adder): void {
  if (!(nonEmptyString(raw.action_id) && ID_RE.test(raw.action_id))) {
    add("action_id", "영문·숫자·_- 로 된 ID가 필요합니다");
  }
  if (!oneOf(ACTION_TYPES, raw.action_type)) {
    add("action_type", `${ACTION_TYPES.join(" | ")} 중 하나여야 합니다`);
  }
  if (!nonEmptyString(raw.change_summary_ko)) {
    add("change_summary_ko", "변경 내용 한 줄이 필요합니다");
  }
  const urlProblem = validateUrl(raw.target_page_url);
  if (urlProblem) {
    add("target_page_url", urlProblem);
  }
  const ids = raw.target_question_ids;
  if (
    !(
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every(nonEmptyString) &&
      new Set(ids).size === ids.length
    )
  ) {
    add(
      "target_question_ids",
      "비어 있지 않은 질문 ID 목록(중복 없음)이 필요합니다"
    );
  }
}

/** 색인·반영 경로·판정 버전·시각 칸. */
function checkIndexAndTimeFields(
  raw: Record<string, unknown>,
  add: Adder
): void {
  if (!oneOf(INDEXED_STATES, raw.already_indexed)) {
    add(
      "already_indexed",
      `필수 칸입니다: ${INDEXED_STATES.join(" | ")} (예/아니오/확인 불가)`
    );
  }
  if (!oneOf(REFLECTION_PATHS, raw.expected_path)) {
    add("expected_path", `${REFLECTION_PATHS.join(" | ")} 중 하나여야 합니다`);
  }
  const vv = raw.verdict_version;
  if (vv !== null && !(Number.isInteger(vv) && (vv as number) > 0)) {
    add("verdict_version", "양의 정수이거나 null 이어야 합니다");
  }
  for (const field of [
    "planned_at",
    "executed_at",
    "index_checked_at",
  ] as const) {
    if (raw[field] !== null && !isIsoTimestamp(raw[field])) {
      add(field, TIME_MESSAGE);
    }
  }
  if (
    raw.index_check_method !== null &&
    !nonEmptyString(raw.index_check_method)
  ) {
    add("index_check_method", "문자열 또는 null 이어야 합니다");
  }
  if (raw.index_checked_at !== null && raw.index_check_method === null) {
    add("index_check_method", "확인 시각이 있으면 확인 방법도 필요합니다");
  }
}

/** 비교 불가·효과 약함 표시 칸. */
function checkFlagFields(raw: Record<string, unknown>, add: Adder): void {
  if (
    raw.not_comparable_reason !== null &&
    !oneOf(NOT_COMPARABLE_REASON_VALUES, raw.not_comparable_reason)
  ) {
    add(
      "not_comparable_reason",
      "K0 비교 불가 사유 값이거나 null 이어야 합니다"
    );
  }
  if (typeof raw.not_comparable_expected !== "boolean") {
    add("not_comparable_expected", "true/false 여야 합니다");
  }
  if (typeof raw.weak_effect_possible !== "boolean") {
    add("weak_effect_possible", "true/false 여야 합니다");
  }
}

/** 칸끼리의 규칙(format_only·색인·시작 신호). */
function checkCrossRules(
  raw: Record<string, unknown>,
  startSignalAt: string | null,
  add: Adder
): void {
  if (raw.action_type === "format_only") {
    if (raw.weak_effect_possible !== true) {
      add(
        "weak_effect_possible",
        "format_only 는 true 여야 합니다(효과 약함 가능성 표시 필수)"
      );
    }
    if (!nonEmptyString(raw.weak_effect_note_ko)) {
      add(
        "weak_effect_note_ko",
        "format_only 는 효과 약함 가능성 설명이 필수입니다"
      );
    }
  } else if (
    raw.weak_effect_note_ko !== null &&
    !nonEmptyString(raw.weak_effect_note_ko)
  ) {
    add("weak_effect_note_ko", "문자열 또는 null 이어야 합니다");
  }
  if (
    (raw.already_indexed === "no" || raw.already_indexed === "unknown") &&
    raw.not_comparable_expected !== true
  ) {
    add(
      "not_comparable_expected",
      "색인이 아니오·확인 불가인 조치는 true(비교 불가 가능성 높음)로 등록해야 합니다"
    );
  }
  if (isIsoTimestamp(raw.executed_at)) {
    if (startSignalAt === null) {
      add(
        "executed_at",
        "대표의 시작 신호(start_signal_at) 전에는 실행 시각을 적을 수 없습니다"
      );
    } else if (Date.parse(raw.executed_at) < Date.parse(startSignalAt)) {
      add("executed_at", "실행 시각이 시작 신호보다 앞설 수 없습니다");
    }
  }
}

/** 자유 문구 칸의 금칙 표현. */
function checkFreeText(raw: Record<string, unknown>, add: Adder): void {
  for (const field of [
    "change_summary_ko",
    "weak_effect_note_ko",
    "index_check_method",
  ] as const) {
    const v = raw[field];
    if (typeof v === "string") {
      const hits = findForbiddenPhrases(v);
      if (hits.length > 0) {
        add(field, `금칙 표현이 있습니다: ${hits.join(", ")}`);
      }
    }
  }
}

/** 조치 하나의 규칙을 검사해 문제를 issues 에 쌓는다. */
function validateAction(
  raw: unknown,
  path: string,
  startSignalAt: string | null,
  issues: ValidationIssue[]
): void {
  if (!isRecord(raw)) {
    issues.push({ path, message: "조치 기록은 객체여야 합니다" });
    return;
  }
  const add: Adder = (field, message) =>
    issues.push({ path: `${path}.${field}`, message });
  checkBasicFields(raw, add);
  checkIndexAndTimeFields(raw, add);
  checkFlagFields(raw, add);
  checkCrossRules(raw, startSignalAt, add);
  checkFreeText(raw, add);
}

/** 조치 기록 파일 전체를 검사한다. 필수 칸 누락·잘못된 값·시각 형식·교차 규칙 위반을 모두 모아 돌려준다. */
export function validateActionLog(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "$", message: "객체여야 합니다" }] };
  }
  if (input.schema_version !== 1) {
    issues.push({ path: "schema_version", message: "1 이어야 합니다" });
  }
  if (input.prereg_id !== null && !nonEmptyString(input.prereg_id)) {
    issues.push({
      path: "prereg_id",
      message: "문자열 또는 null 이어야 합니다",
    });
  }
  let startSignalAt: string | null = null;
  if (input.start_signal_at !== null) {
    if (isIsoTimestamp(input.start_signal_at)) {
      startSignalAt = input.start_signal_at;
    } else {
      issues.push({
        path: "start_signal_at",
        message: "ISO 8601 시각(시간대 포함) 또는 null 이어야 합니다",
      });
    }
  }
  if (Array.isArray(input.actions)) {
    const seen = new Set<string>();
    input.actions.forEach((a, i) => {
      validateAction(a, `actions[${i}]`, startSignalAt, issues);
      if (isRecord(a) && typeof a.action_id === "string") {
        if (seen.has(a.action_id)) {
          issues.push({
            path: `actions[${i}].action_id`,
            message: "조치 ID가 중복됩니다",
          });
        }
        seen.add(a.action_id);
      }
    });
  } else {
    issues.push({ path: "actions", message: "배열이어야 합니다" });
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
