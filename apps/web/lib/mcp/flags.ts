// MCP 커넥터 스위치 — **둘 다 기본 꺼짐**.
//
//   FINDABLE_MCP_ENABLED          서버 자체(공식 사실 점검·캐시 조회). 꺼져 있으면 라우트가 503.
//   FINDABLE_MCP_MEASURE_ENABLED  새 AI 측정 시작(익명 진입). 켜는 순간 사실상 무료 공개 진단의
//                                 일부 재개다 → 대표가 명시적으로 결정한 뒤에만 켠다.
//                                 (2026-10-07 대표 결정으로 공개 무료 진단 `FREE_AUDIT_PUBLIC_ENABLED` 는 꺼져 있다.)
//   FINDABLE_MCP_DAILY_JOB_CAP    MCP 가 하루에 새로 시작할 수 있는 측정 건수(기본 2).
//                                 원가모델 v2 단가 1,000원 기준 월 약 6만 원 상한.

const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);

function readFlag(name: string): boolean {
  return TRUE_VALUES.has((process.env[name] ?? "").trim().toLowerCase());
}

export function mcpEnabled(): boolean {
  return readFlag("FINDABLE_MCP_ENABLED");
}

export function mcpMeasureEnabled(): boolean {
  return mcpEnabled() && readFlag("FINDABLE_MCP_MEASURE_ENABLED");
}

export const DEFAULT_MCP_DAILY_JOB_CAP = 2;

export function mcpDailyJobCap(): number {
  const raw = process.env.FINDABLE_MCP_DAILY_JOB_CAP;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_MCP_DAILY_JOB_CAP;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : DEFAULT_MCP_DAILY_JOB_CAP;
}

/**
 * MCP 가 만든 측정 job 의 `AuditJob.email` 열에 넣는 **시스템 주소**(실제 수신 안 함).
 *
 * 🔴 절대 `org:` 로 시작하게 만들지 말 것 — `org:` 는 "인증된 서버만 쓰는 이름공간"이라
 *   유료 게이트를 통과한다(`usage-tier.ts`). 이 값은 일반 `lead` 티어로 판정된다.
 * 이 값으로 "MCP 가 만든 job" 을 식별해 ① 일일 상한을 세고 ② 조회를 MCP job 으로 제한한다.
 */
export const MCP_SYSTEM_EMAIL = "mcp-anonymous@findable.co.kr";
