/**
 * crew 산출물 자기평가(critique) — 재작성이 필요한지 판정한다. (2026-08-09)
 *
 * 🔴 **왜 필요한가 — 실측으로 드러난 약속 위반**
 *   스키마 `.describe()` 와 에이전트 지시문이 **둘 다** 길이 규칙을 말하는데
 *   지켜지지 않고 있었다. 프로덕션 18건 전수 감사(2026-08-09):
 *
 *   | 필드 | 약속 | 위반 | 최장 |
 *   |---|---|---|---|
 *   | `executiveSummary` | 80자 | **18/18 전건** | **347자**(4.3배) |
 *   | `mondayActionOne.whyThisOne` | 80자 | **18/18 전건** | 234자 |
 *   | `mondayActionOne.expectedOutcome` | 60자 | 18/18 전건 | 190자 |
 *   | 액션 `step` | 50자 | 280건 | 128자 |
 *   | 액션 `title` | 30자 | 111건 | 63자 |
 *
 *   `executiveSummary` 는 *"임원이 이 한 문장만 읽어도 결정 가능"* 이 존재 이유인데
 *   347자면 한 문장이 아니다. **제품 약속이 100% 깨진 채 아무도 몰랐다.**
 *
 * 🔒 **왜 zod `.max()` 로 강제하지 않았나**(중요한 설계 판단)
 *   문자열 필드에 `.max()` 를 넣으면 스키마 검증이 실패해 `output: null` 이 된다.
 *   지금 **18/18 이 위반 중**이므로 그렇게 하면 **리포트가 통째로 사라진다**(전멸).
 *   → 강제하지 않고, **위반을 감지해 한 번 다시 쓰게** 한다. 재작성이 실패해도
 *     원본을 그대로 쓰므로 **현재보다 나빠질 수 없다**(단조 개선).
 *
 * ⚠️ 순수 함수 — LLM·DB·시각에 의존하지 않는다(테스트 가능·비용 0).
 *   LLM 채점을 쓰지 않은 이유: 길이는 **코드로 정확히** 판정되고, 판정에 또 LLM 을 쓰면
 *   비용·시간이 늘면서 판정 자체가 흔들린다.
 */

import type { ActionItem, StrategistOutput } from "./agents";

/** 스키마 `.describe()` 가 약속한 한국어 기준 길이 상한. */
export const CREW_LIMITS = {
  executiveSummary: 80,
  mondayTitle: 40,
  mondayWhy: 80,
  mondayOutcome: 60,
  actionTitle: 30,
  actionRationale: 200,
  actionStep: 50,
} as const;

/**
 * 재작성을 유발하는 초과 배수.
 *
 * 🔬 **실측으로 정한 값**(프로덕션 18건, 2026-08-09). 배수별 재작성 발동률:
 *
 *   | 배수 | 재작성률 | 판단 |
 *   |---|---|---|
 *   | 1.5 | **100%**(18/18) | 매번 발동 → 아래 시간 예산을 넘긴다 |
 *   | 2.0 | 78% | 여전히 대부분 발동 |
 *   | **2.5** | **33%**(6/18) | ⭐채택 — 3건 중 1건만, 347자(4.3배)는 확실히 잡힘 |
 *   | 3.0 | 17% | 너무 느슨 |
 *
 * 🔴 **왜 시간이 기준인가**(실측): crew 전체 중앙값 **114초**·최대 **226초**,
 *   전략가 1회가 중앙값 **65초**·최대 **82초**다. 상위 `CREW_TIMEOUT_MS` 는 **270초**.
 *   재작성이 100% 발동하면 긴 회차에서 예산을 넘긴다.
 *   2.5 면 발동이 1/3 로 줄어 예산 안에 들어온다(+ 아래 `REWRITE_TIMEOUT_MS` 로 이중 방어).
 *
 * ✅ **세션N-13 교차검증**(2026-08-10, 표본 18→**31건**): 위 배수별 발동률이 전건 재현됐다
 *   (1.5=100% · 2.0=81% · **2.5=32%** · 3.0=13%). 시간도 재검증 — 최장 226초 회차는
 *   재작성 **비대상**이고 발동 10건 중 최악이 `181+45=226초` < 270초라 **초과 위험 0/31**.
 *   ⚠️초기 표본의 "최대 130초"는 낡은 값이었다(실제 226초). 그래도 결론은 바뀌지 않는다.
 *
 * ⚠️ 2.5 는 `executiveSummary` 기준 **200자 초과**를 뜻한다. 약속(80자)보다 관대하지만,
 *   "임원이 한 문장으로 읽는다"가 무너지는 지점은 잡는다. 분포가 바뀌면 재조정할 것.
 */
export const CREW_OVERAGE_TOLERANCE = 2.5;

export interface CrewViolation {
  /** 실제 길이. */
  actual: number;
  /** 어느 필드인가(사람이 읽는 라벨). */
  field: string;
  /** 약속 길이. */
  limit: number;
}

export interface CrewCritique {
  /** 재작성 프롬프트에 붙일 지시문. 위반이 없으면 빈 문자열. */
  instruction: string;
  /** 재작성이 필요한가. */
  needsRewrite: boolean;
  /** 감지된 위반(허용 배수 초과분만). */
  violations: CrewViolation[];
}

const EMPTY_CRITIQUE: CrewCritique = {
  needsRewrite: false,
  violations: [],
  instruction: "",
};

function check(
  field: string,
  value: string | undefined,
  limit: number,
  out: CrewViolation[]
): void {
  const actual = (value ?? "").length;
  if (actual > limit * CREW_OVERAGE_TOLERANCE) {
    out.push({ field, limit, actual });
  }
}

function checkAction(
  action: ActionItem,
  index: number,
  out: CrewViolation[]
): void {
  const label = `액션 ${index + 1}`;
  check(`${label} title`, action.title, CREW_LIMITS.actionTitle, out);
  check(
    `${label} rationale`,
    action.rationale,
    CREW_LIMITS.actionRationale,
    out
  );
  for (const [i, step] of (action.steps ?? []).entries()) {
    check(`${label} steps[${i + 1}]`, step, CREW_LIMITS.actionStep, out);
  }
}

/**
 * 재작성 지시문 — **무엇이 얼마나 길었는지 숫자로** 알려준다.
 * "짧게 쓰세요" 같은 추상 지시는 이미 지시문·스키마에 있었고 지켜지지 않았다.
 */
export function buildRewriteInstruction(violations: CrewViolation[]): string {
  const lines = violations
    .map((v) => `- ${v.field}: ${v.actual}자 → **${v.limit}자 이내**로 줄일 것`)
    .join("\n");

  return `## 재작성 요청 (길이 규정 위반)
직전 답변이 길이 약속을 어겼습니다. **내용·판단은 그대로 유지**하고 **표현만 압축**하세요.

${lines}

압축 규칙:
1. 사실·수치는 **버리지 말 것**. 수식어·중복 설명·접속어를 먼저 덜어낸다.
2. 한 필드에 여러 문장이 있으면 **가장 중요한 한 문장**만 남긴다.
3. 액션의 우선순위·채널·impact/effort 점수는 **바꾸지 말 것**(다른 화면과 숫자가 어긋난다).
4. 같은 JSON 스키마로 반환한다.`;
}

/**
 * 전략가(준호) 산출물을 평가한다.
 *
 * 지금은 **길이 약속**만 본다 — 실측으로 확인된 유일한 상시 위반이고,
 * 코드로 100% 정확히 판정되기 때문이다.
 * ⚠️ 채널 정합(업종 금지 채널)은 여기서 보지 않는다: 판정에 업종 컨텍스트가 필요해
 *   순수 함수 범위를 벗어나고, 이미 프롬프트 레벨 규칙(`buildIndustryGuidance`)이 있다.
 */
export function critiqueStrategist(
  output: StrategistOutput | null
): CrewCritique {
  if (!output) {
    return EMPTY_CRITIQUE;
  }

  const violations: CrewViolation[] = [];
  check(
    "executiveSummary",
    output.executiveSummary,
    CREW_LIMITS.executiveSummary,
    violations
  );

  const monday = output.mondayActionOne;
  if (monday) {
    check(
      "mondayActionOne.title",
      monday.title,
      CREW_LIMITS.mondayTitle,
      violations
    );
    check(
      "mondayActionOne.whyThisOne",
      monday.whyThisOne,
      CREW_LIMITS.mondayWhy,
      violations
    );
    check(
      "mondayActionOne.expectedOutcome",
      monday.expectedOutcome,
      CREW_LIMITS.mondayOutcome,
      violations
    );
  }

  for (const [i, action] of (output.topActions ?? []).entries()) {
    checkAction(action, i, violations);
  }

  if (violations.length === 0) {
    return EMPTY_CRITIQUE;
  }

  return {
    needsRewrite: true,
    violations,
    instruction: buildRewriteInstruction(violations),
  };
}
