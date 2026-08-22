// 전환 퍼널 이벤트 — 2026-08-12 세션N-24 (BL-Day17-04)
//
// 왜: PostHog 캡처가 **클라이언트 3종 + Clerk 웹훅**뿐이라 중간 단계가 끊겨 있었다(D17-3).
//   특히 **결제 시도의 결과를 하나도 구분하지 못했다** — "몇 명이 결제를 눌렀고
//   그중 몇 명이 성공했나"조차 알 수 없었다.
//
// ⭐ 이게 P0(실고객 지불의사 검증)의 **정량 근거**가 된다. 대표님이 마케터를 만나기 전에
//   *"결제창까지 갔다가 포기한 사람이 N명"* 을 숫자로 들고 갈 수 있다.
//   🔴 단, 이것은 인터뷰를 **대체하지 못한다**(r=0.20). 보조 근거일 뿐이다.
//
// 🔬 **왜 `pricing_viewed` 를 만들지 않았나** — 백로그 원안에 있었지만 **중복이다.**
//   `instrumentation-client.ts` 가 `defaults: "2025-05-24"` 로 초기화하고, 그 프리셋은
//   `capture_pageview: "history_change"` 를 켠다(posthog-js 소스 실측).
//   즉 **모든 화면 조회는 이미 `$pageview` 로 자동 수집**되며 SPA 이동까지 잡힌다.
//   → 요금제 조회는 `$pageview` + `$current_url` 로 이미 답할 수 있다.
//     같은 것을 두 번 세면 숫자가 갈리고, 그때 어느 쪽이 맞는지 아무도 모른다.
//
// 🔴 개인정보: 이메일·도메인을 넣지 않는다. PostHog 는 마케팅 분석 도구이고
//   `AuditJob.email` 은 리드의 개인정보다. 식별이 필요하면 PostHog `distinct_id` 를 쓴다.

import { analytics } from "./index";

/** 결제 시도가 어디서 끝났는가. 화면 문구가 아니라 **단계**로 센다. */
export type CheckoutStage =
  // "intent"  = 서버가 결제 정보를 만들다 실패 — **우리 잘못**
  // "widget"  = 결제창이 취소·실패로 닫힘 — **고객의 선택 또는 카드 문제**
  // "verify"  = 결제는 됐는데 검증·플랜부여가 실패 — **우리 잘못(가장 위험)**
  "intent" | "verify" | "widget";

interface CheckoutContext {
  /** 청구 금액(원). 플랜별 전환율을 가격과 함께 봐야 의미가 있다. */
  amountKrw?: number;
  /**
   * 정기결제(빌링키 등록)인가. 단건과 **같은 이벤트 이름**을 쓰고 이 속성으로 나눈다.
   *
   * 🔴 왜 이벤트 이름을 나누지 않았나: 나누면 *"결제 시도가 몇 건인가"* 를 물을 때
   *   두 이벤트를 더해야 하고, 새 결제수단이 생길 때마다 **묻는 사람이 하나를 빠뜨린다**.
   *   이름은 하나로 두고 속성으로 쪼개면 합계도 분해도 둘 다 공짜다.
   */
  isSubscription?: boolean;
  plan: string;
}

/**
 * 결제를 **시도했다**(버튼을 눌러 결제 흐름에 진입).
 *
 * ⚠️ "결제창이 떴다"가 아니다 — 결제창 이전에 서버 호출이 한 번 있다.
 *   그래서 이 이벤트와 `checkout_failed(stage:"intent")` 가 짝을 이룬다.
 */
export const trackCheckoutStarted = (ctx: CheckoutContext): void => {
  safeCapture("checkout_started", {
    plan: ctx.plan,
    amountKrw: ctx.amountKrw,
    isSubscription: ctx.isSubscription ?? false,
  });
};

/**
 * 결제가 **완료**되고 플랜이 실제로 부여됐다.
 * 🔴 결제 성공과 플랜 부여는 다른 일이다 — 여기는 **둘 다** 된 경우만 부른다.
 */
export const trackCheckoutCompleted = (ctx: CheckoutContext): void => {
  safeCapture("checkout_completed", {
    plan: ctx.plan,
    amountKrw: ctx.amountKrw,
    isSubscription: ctx.isSubscription ?? false,
  });
};

/**
 * 결제가 **끝까지 가지 못했다**.
 *
 * ⚠️ `reasonCode` 는 PG 가 준 값을 **그대로** 넣는다.
 *   🔬 PortOne SDK 타입에 취소 코드 목록이 없어(실측) *"이 코드는 고객 취소"* 같은
 *   매핑을 **여기서 발명하지 않는다**. 분류는 실제 코드 분포를 보고 나중에 한다.
 *   근거 없는 분류는 조작이다 — 있는 그대로 보내고 판단은 데이터가 쌓인 뒤에.
 */
export const trackCheckoutFailed = (
  ctx: CheckoutContext & { stage: CheckoutStage; reasonCode?: string }
): void => {
  safeCapture("checkout_failed", {
    plan: ctx.plan,
    amountKrw: ctx.amountKrw,
    isSubscription: ctx.isSubscription ?? false,
    stage: ctx.stage,
    reasonCode: ctx.reasonCode,
  });
};

// ──────────────────────────────────────────────────
// 진단 퍼널 (2026-08-12 세션N-25)
//
// 왜 추가하나: 위 checkout 3종은 **결제 구간만** 본다. 그런데 우리 퍼널은
//   `무료진단 제출 → 결과 도달 → crew 체험 → 가입 → 결제` 이고, **결제 앞 구간이
//   전부 무계측**이었다. 그래서 *"어디서 새는가"* 를 숫자로 물을 수 없었다.
//
// 🔬 **자동 수집과 중복되는 것은 만들지 않았다**(위 `pricing_viewed` 판단과 같은 원칙).
//   `defaults: "2025-05-24"` 프리셋이 `$pageview`(SPA 이동 포함) + autocapture 를 켜므로
//   **화면 도달·링크 클릭은 이미 잡힌다**. 아래 3종은 그것으로 **답할 수 없는 것**만이다:
//   | 만든 것 | 자동 수집으로 안 되는 이유 |
//   |---|---|
//   | `audit_submitted` | autocapture 는 **클릭**만 본다. 서버가 BotID·예산·IP상한으로 거절했는지(429/403) 모른다 |
//   | `audit_completed` | 결과 페이지는 URL 이 하나라 *"측정이 끝났다"* 를 `$pageview` 로 구분할 수 없다(폴링이 판정한다) |
//   | `crew_triggered` | 세션N-25 가 만든 분기(성공/쿼터소진/일일상한)라 계측이 애초에 없다 |
//
// 🔴 개인정보: 위와 같은 원칙 — **이메일을 넣지 않는다.**
//   ⚠️ `domain` 은 넣는다. 진단 대상은 **법인 도메인**이라 개인정보가 아니고
//   (법 제2조 *"살아 있는 **개인**"*), *"어떤 도메인이 자주 이탈하나"* 를 못 보면
//   이 계측의 목적 절반이 사라진다. 🔴 단 **개인 블로그 도메인은 회색지대**라
//   PostHog 를 개인 식별에 쓰지 않는다는 원칙은 유지한다(distinct_id 로 충분).

/** 진단 제출이 서버에서 어떻게 끝났는가. 화면 문구가 아니라 **판정**으로 센다. */
export type AuditSubmitOutcome =
  // "accepted"  = 측정 시작됨(신규 job 생성)
  // "cached"    = 24h 도메인 캐시 히트 — 원가 0, 고객에겐 성공으로 보인다
  // "bot"       = BotID 차단
  // "budget"    = 전역 일일 예산 소진 — **우리 사정으로 거절**
  // "ip_capped" = IP 당 신규도메인 상한 — ⚠️ 대행사 ICP 가 여기 걸린다
  // "invalid"   = 입력 검증 실패
  "accepted" | "bot" | "budget" | "cached" | "invalid" | "ip_capped";

/** crew(심층분석) 트리거가 어떻게 끝났는가. */
export type CrewTriggerOutcome =
  // "started"       = 실행 시작
  // "quota_used"    = 무료 체험 1회 소진 → 가입 유도(**전환 신호**)
  // "daily_capped"  = 전역 일일 상한
  // "already"       = 이미 진행 중·완료(409)
  // "error"         = 그 외 실패
  "already" | "daily_capped" | "error" | "quota_used" | "started";

/**
 * `/api/audit` 응답을 퍼널 판정으로 분류한다.
 *
 * 🔴 **문구가 아니라 구조로 판정한다** — 서버 에러 문구를 다듬는 순간 문자열 파싱은
 *   조용히 깨진다(이 프로젝트가 반복해서 데인 지점: *"상태는 문자열이 아니라 데이터 플래그로"*).
 * ⚠️ 순수 함수로 둔 이유: 이 분류가 틀리면 **퍼널 숫자가 조용히 거짓말**을 하는데,
 *   폼에서 인라인으로 짜면 검증할 방법이 없다(브라우저 없이는 폼을 못 돌린다).
 * ⚠️ biome 복잡도 20 · 중첩 삼항 금지 → `if` 로 평평하게 쓴다.
 */
export const classifySubmit = (
  status: number,
  data: {
    cached?: boolean;
    budgetExhausted?: boolean;
    ipQuotaExceeded?: boolean;
    existingJobId?: string;
  }
): AuditSubmitOutcome => {
  if (status >= 200 && status < 300) {
    // 캐시 히트는 고객에게 성공으로 보이지만 **새 측정은 아니다**(원가 0).
    // 둘을 합치면 *"실제로 몇 건을 측정했나"* 를 물을 수 없다.
    if (data.cached) {
      return "cached";
    }
    return "accepted";
  }
  if (data.budgetExhausted) {
    return "budget";
  }
  if (data.ipQuotaExceeded) {
    return "ip_capped";
  }
  // 24h 재요청(같은 이메일+도메인)도 고객에겐 기존 결과로 이어진다 → 캐시와 같은 성질.
  if (data.existingJobId) {
    return "cached";
  }
  if (status === 403) {
    return "bot";
  }
  return "invalid";
};

/**
 * 이 판정에서 **문의 링크를 띄워야 하는가**.
 *
 * 🔴 서버가 두 자리에서 *"문의해 주세요"* 라고 말해 놓고 **클릭할 데를 주지 않았다**
 *   (`/api/audit/route.ts` 의 429 두 건). 특히 `ip_capped` 는 대행사·에이전시가
 *   클라이언트 3곳째를 진단할 때 걸리는 지점이라 **지불의사가 가장 높은 리드가
 *   막다른 길에서 그냥 사라진다**.
 * ⚠️ 문구가 아니라 **판정으로** 결정한다 — 서버 에러 문구를 다듬으면 문자열 매칭은
 *   조용히 깨진다(이 프로젝트가 반복해서 데인 지점).
 * ⛔ `invalid`·`bot` 에는 띄우지 않는다 — 고객이 고칠 수 있는 문제(오타 등)에
 *   문의를 권하면 소음이고, 봇에게 줄 이유는 없다.
 */
export const shouldOfferContact = (outcome: AuditSubmitOutcome): boolean =>
  outcome === "budget" || outcome === "ip_capped";

/**
 * 무료 진단을 **제출했다** — 그리고 서버가 어떻게 판정했는지까지.
 *
 * ⭐ 이 하나로 *"제출 N건 중 실제 측정된 건 M건"* 이 나온다. 지금까지는
 *   거절된 사람이 몇 명인지 **아무도 몰랐다**(특히 `ip_capped` = 대행사 이탈).
 */
export const trackAuditSubmitted = (ctx: {
  domain?: string;
  outcome: AuditSubmitOutcome;
}): void => {
  safeCapture("audit_submitted", {
    domain: ctx.domain,
    outcome: ctx.outcome,
  });
};

/**
 * 진단이 **완료돼 결과를 볼 수 있게 됐다**(폴링이 completed 를 받은 순간).
 *
 * ⚠️ 결과 페이지 **도달**($pageview)과 다르다 — 도달했어도 측정이 실패로 끝나면
 *   고객은 빈 화면을 본다. 그 차이를 이 이벤트가 가른다.
 */
export const trackAuditCompleted = (ctx: {
  domain?: string;
  /** 측정된 엔진 수. 0 이면 전 엔진 실패 = 사실상 빈손. */
  enginesCovered?: number;
  /** 완료까지 걸린 초. 유닛이코노믹스가 *"원가가 아니라 시간이 리스크"* 라 했다. */
  durationSec?: number;
}): void => {
  safeCapture("audit_completed", {
    domain: ctx.domain,
    enginesCovered: ctx.enginesCovered,
    durationSec: ctx.durationSec,
  });
};

/** 결과 페이지에 **어떻게** 도달했는가. */
export type ReportViewMode =
  // "live"   = 방금 돌린 측정이 눈앞에서 완료됨(폴링으로 도착)
  // "revisit"= 이미 끝난 결과를 열었다 — 링크 공유·북마크·재방문
  "live" | "revisit";

/**
 * 진단 결과를 **실제로 봤다**.
 *
 * 🔬 **왜 `$pageview` 로 충분하지 않은가** — `pricing_viewed` 를 기각한 논리와
 *   다른 경우다. 결과 페이지는 URL 에 도달해도 **볼 것이 없을 수 있다**:
 *   측정이 실패했거나(`MeasurementFailedView`), 아직 돌고 있거나(측정 중 화면).
 *   `$pageview` 는 그 셋을 구분하지 못한다. 이 이벤트는 **결과가 실제로 그려진 순간**만 센다.
 *
 * ⭐ `audit_completed` 와도 다르다 — 그건 *"측정이 끝났다"*(생산)이고
 *   이건 *"사람이 결과를 봤다"*(소비)다. 둘의 차이가 곧 **끝났는데 아무도 안 본 진단**이고,
 *   그게 v4 가 `report_viewed` 를 요구한 이유다(부분가림·트라이얼 효과 판정의 분모).
 *   🔴 `mode: "revisit"` 만 따로 보면 **링크 공유가 실제로 도는지**를 처음으로 알 수 있다.
 *
 * ⚠️ 같은 세션에서 두 번 세지 않는다 — 호출부가 ref 로 1회만 부른다(중복 집계 금지).
 */
export const trackReportViewed = (ctx: {
  domain?: string;
  /** 측정된 엔진 수. 0 이면 도달은 했으나 **빈손**이다. */
  enginesCovered?: number;
  mode: ReportViewMode;
}): void => {
  safeCapture("report_viewed", {
    domain: ctx.domain,
    enginesCovered: ctx.enginesCovered,
    mode: ctx.mode,
  });
};

/**
 * crew(심층분석) 트리거 결과.
 *
 * ⭐ `quota_used` 가 **이 제품에서 가장 중요한 전환 신호**다 — 무료 체험을 다 쓰고
 *   가입 화면을 마주한 사람의 수이고, 그게 곧 *"가치를 느꼈다"* 의 대리 지표다.
 *   🔴 단 대리 지표는 지불의사가 아니다(r=0.20). P0 인터뷰를 대체하지 못한다.
 */
export const trackCrewTriggered = (ctx: {
  outcome: CrewTriggerOutcome;
}): void => {
  safeCapture("crew_triggered", { outcome: ctx.outcome });
};

/**
 * 🔴 분석 실패가 본 기능(결제)을 절대 깨뜨리지 않게 한다.
 *   결제 흐름 한가운데서 부르는 코드라, 여기서 던지면 **고객의 결제가 실패**한다.
 *   (`ops-alert.ts` 와 같은 원칙 — 부수 기능은 본 기능보다 조용해야 한다.)
 */
const safeCapture = (
  event: string,
  properties: Record<string, unknown>
): void => {
  try {
    analytics.capture(event, properties);
  } catch {
    // 의도적으로 삼킨다. 결제 도중 콘솔 에러를 띄워 고객을 불안하게 만들지 않는다.
  }
};
