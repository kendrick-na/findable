// 「오늘」 화면 모델 (2026-10-15 — 설계안 `설계안_애플식_단순구조_고객앱`, 0단계)
//
// 목적: 기존 대시보드가 **이미 계산한 값**을 한 문장·한 카드로 번역한다.
// 🔴 이 파일은 숫자를 새로 계산하지 않는다 — SoV·변화량·경쟁 지형은 `buildDashboardData` 결과를
//   그대로 받는다(같은 값을 두 곳에서 계산하면 화면끼리 어긋난다: 세션N-2 sovLabel 사고).
//   여기서 새로 세는 것은 (1) 엔진별 「출처 붙은 응답 수」 (2) 사이트 점검 결과 합계, 두 가지뿐이고
//   둘 다 저장된 행을 그대로 센 값이다.
// 🔴 판정 문구("낮은 편이에요" 등)를 쓰지 않는다 — 기준선(임계값)을 우리가 지어내게 된다.
//   대신 사실만 말한다: 비율·몇 엔진·지난 측정과의 차이·측정 조건.
// ⚠️ 한글 문자열은 코드에 두지 않는다(hangul-literal-ratchet) — 문구는 전부 사전(`app.today`).

import { PUBLIC_COUNTER_EXCLUDED_ORG_IDS } from "@repo/database/internal-orgs";

/** `?view=old` 로 예전 대시보드를 강제로 볼 수 있다(되돌리기 장치). */
const OLD_VIEW = "old";

function parseOrgIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * 「오늘」 화면을 보여줄 조직인가.
 *
 * 🔴 **기본은 꺼짐**이다. 켜지는 곳은 두 군데뿐:
 *   ① 우리 팀·테스트 조직(`PUBLIC_COUNTER_EXCLUDED_ORG_IDS`) — 대표·팀이 먼저 직접 써 본다
 *   ② 환경변수 `TODAY_VIEW_ORG_IDS`(쉼표 구분 조직 id) — 고객 5~10곳 파일럿
 * 고객 전체에는 켜지 않는다(검증 전). `?view=old` 면 팀·파일럿도 예전 화면으로 돌아간다.
 */
export function isTodayViewEnabled(input: {
  orgId: string | null | undefined;
  pilotOrgIdsRaw?: string | undefined;
  view?: string | null | undefined;
}): boolean {
  if (!input.orgId || input.view === OLD_VIEW) {
    return false;
  }
  const allowed = new Set<string>([
    ...PUBLIC_COUNTER_EXCLUDED_ORG_IDS,
    ...parseOrgIds(input.pilotOrgIdsRaw),
  ]);
  return allowed.has(input.orgId);
}

export interface TodayEngineSourceRow {
  citedSources: unknown;
  engineId: string;
  errorMessage: string | null;
}

export interface EngineSourceLine {
  answers: number;
  engine: string;
  withSources: number;
}

function hasSources(cited: unknown): boolean {
  return Array.isArray(cited) && cited.length > 0;
}

/**
 * 최신 1회차 행 → 엔진별 「응답 수 / 출처가 붙은 응답 수」.
 * 측정 실패 행(errorMessage)은 응답이 아니므로 센다고 하지 않는다("측정하지 못한 것"을 응답으로 세지 않는다).
 */
export function summarizeEngineSources(
  rows: TodayEngineSourceRow[],
  engineNames: ReadonlyMap<string, string>
): EngineSourceLine[] {
  const byEngine = new Map<string, EngineSourceLine>();
  for (const row of rows) {
    if (row.errorMessage) {
      continue;
    }
    const engine = engineNames.get(row.engineId);
    if (!engine) {
      continue;
    }
    const line = byEngine.get(engine) ?? { engine, answers: 0, withSources: 0 };
    line.answers += 1;
    if (hasSources(row.citedSources)) {
      line.withSources += 1;
    }
    byEngine.set(engine, line);
  }
  return [...byEngine.values()].sort((a, b) =>
    a.engine.localeCompare(b.engine)
  );
}

/**
 * 출처를 한 번도 안 붙인 엔진이 **있고** 다른 엔진은 붙였을 때만 안내를 띄운다.
 * (전부 0 이면 측정 방식 문제가 아니라 데이터가 없는 것일 수 있어 단정하지 않는다.)
 */
export function shouldWarnMissingSources(lines: EngineSourceLine[]): boolean {
  const someWith = lines.some((line) => line.withSources > 0);
  const someWithout = lines.some(
    (line) => line.answers > 0 && line.withSources === 0
  );
  return someWith && someWithout;
}

export interface TodayReadinessCheck {
  id?: string;
  status: string;
}

export interface SiteSummary {
  fail: number;
  /** 지난 점검에는 문제·주의가 아니었는데 이번에 문제·주의가 된 항목 수. 비교할 지난 점검이 없으면 null. */
  newIssues: number | null;
  total: number;
  warning: number;
}

const isIssue = (status: string) => status === "fail" || status === "warning";

/**
 * 지난 점검 대비 새로 생긴 문제·주의 수. 같은 항목 id 가 양쪽에 있고 지난번엔 문제가 아니었던 것만 센다.
 * 지난 점검이 없거나 항목 id 로 맞출 수 없으면 null(0 이라고 말하지 않는다). 새 항목(지난번에 없던 점검)은 세지 않는다.
 */
export function newIssuesSince(
  current: TodayReadinessCheck[] | null | undefined,
  previous: TodayReadinessCheck[] | null | undefined
): number | null {
  if (!(current && previous) || current.length === 0 || previous.length === 0) {
    return null;
  }
  const before = new Map<string, string>();
  for (const check of previous) {
    if (check.id) {
      before.set(check.id, check.status);
    }
  }
  if (before.size === 0) {
    return null;
  }
  let count = 0;
  for (const check of current) {
    const was = check.id ? before.get(check.id) : undefined;
    if (was !== undefined && isIssue(check.status) && !isIssue(was)) {
      count += 1;
    }
  }
  return count;
}

/** 사이트 점검 결과 합계. 점검이 없으면 null(0 이라고 말하지 않는다). */
export function summarizeReadiness(
  checks: TodayReadinessCheck[] | null | undefined,
  previous?: TodayReadinessCheck[] | null
): SiteSummary | null {
  if (!checks || checks.length === 0) {
    return null;
  }
  return {
    total: checks.length,
    fail: checks.filter((check) => check.status === "fail").length,
    warning: checks.filter((check) => check.status === "warning").length,
    newIssues: newIssuesSince(checks, previous),
  };
}

export type DeltaKind = "up" | "down" | "flat" | "none" | "blocked";

export interface TodayDelta {
  kind: DeltaKind;
  points: number | null;
}

export function todayDelta(input: {
  blockedReason: unknown;
  deltaPoints: number | null;
}): TodayDelta {
  if (input.blockedReason) {
    return { kind: "blocked", points: null };
  }
  if (input.deltaPoints === null) {
    return { kind: "none", points: null };
  }
  const rounded = Math.round(Math.abs(input.deltaPoints) * 10) / 10;
  if (rounded === 0) {
    return { kind: "flat", points: 0 };
  }
  return {
    kind: input.deltaPoints > 0 ? "up" : "down",
    points: rounded,
  };
}

export interface TodayPromptScore {
  hit: number;
  text: string;
  total: number;
}

export type TodayFirst =
  | { kind: "weak"; prompt: string; hit: number; total: number }
  | { kind: "allHit" }
  | null;

/**
 * 「먼저 살펴볼 질문 1개」. `promptScores` 는 이미 약한 순이다(dashboard-data) → 맨 앞이 가장 약한 질문.
 * 전부 만점이면 약한 질문이 없으므로 그렇게 말한다(없는 약점을 만들지 않는다).
 */
export function todayFirst(scores: TodayPromptScore[]): TodayFirst {
  const weakest = scores[0];
  if (!weakest) {
    return null;
  }
  if (weakest.total > 0 && weakest.hit >= weakest.total) {
    return { kind: "allHit" };
  }
  return {
    kind: "weak",
    prompt: weakest.text,
    hit: weakest.hit,
    total: weakest.total,
  };
}
