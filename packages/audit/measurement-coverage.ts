/**
 * 측정 성공 집계 — **"잰 것만 말한다"의 단일 진실** (2026-08-10 세션N-14).
 *
 * 🔴 **왜 만들었나(라이브 화면 실측)**: `apple.com` 진단은 엔진 **28개가 전부 실패**했는데
 *   `status=completed` 로 저장돼, 고객 화면에 이렇게 나가고 있었다 —
 *
 *     "우리를 아는 AI  0/0" · "측정한 AI 0개 중 0개가 애플를 알고 있습니다"
 *     그런데 바로 아래 → **"놓치는 유입 800 세션/월"**
 *
 *   **아무것도 측정하지 못했는데 사업 손실을 숫자로 단언**하고 있었다.
 *   못 잰 것을 "0점"이라 부른 것 = 체온계가 안 켜졌는데 "체온 0도"라고 적은 것.
 *   실측 해당: 성공 0건 **7건**(nike·apple·innisfree·tonymoly·themedicube·medicube×2).
 *
 * 🔴 **원인**: `sov = 0` 이 두 가지를 구분하지 못한다.
 *     ① AI 가 정말 우리를 모른다 (= 진짜 발견, **보여줘야 한다**)
 *     ② 측정이 전멸했다 (= 아무 정보 없음, **말할 수 있는 게 없다**)
 *
 * ⚠️ **임계값을 두지 않는다.** *"몇 % 이상이면 믿을 만한가"* 는 근거 없는 경계선이고,
 *   그런 숫자를 코드에 박는 건 이 결함(근거 없는 숫자를 단언)과 **같은 잘못**이다.
 *   판정은 **0인가 아닌가** 하나뿐이고(0은 논리적으로 명확하다),
 *   나머지는 **분모를 밝히는 것**으로 해결한다(화면이 이미 쓰는 "7개 중 1개" 패턴).
 *
 * ⚠️ **이 파일이 유일한 계산처다.** 화면·테스트가 각자 규칙을 복제하면 조용히 갈라진다
 *   (같은 수치를 두 벌로 두지 않는다 — 프로젝트 규칙).
 */

/** 집계에 필요한 최소 형태. `EngineResponse` 와 저장된 `engineResponses[]` 양쪽이 만족한다. */
export interface MeasurableResponse {
  engineId: string;
  errorMessage?: string | null;
  isStub?: boolean;
}

export interface MeasurementCoverage {
  /** 물어본 엔진 수(고유). **분모**로 화면에 밝힌다. */
  attempted: number;
  /** 응답을 실제로 받아낸 엔진 수(고유). **0이면 "측정 실패"** 다. */
  measured: number;
}

/**
 * 엔진 응답 목록에서 측정 성공/시도 수를 센다.
 *
 * 규칙:
 *   · **엔진 단위**로 센다 — 실측 구조가 `엔진 7개 × 프롬프트 4개 = 28행` 이라
 *     행을 세면 분모가 뻥튀기된다.
 *   · `errorMessage` 가 있거나 `isStub` 이면 **성공이 아니다**
 *     (스텁은 API 키가 없어 만든 가짜 응답이라 "잰 것"이 아니다).
 *   · 같은 엔진이 4번 중 1번만 성공했어도 **그 엔진은 측정됨**이다
 *     (근거가 존재하므로 결과를 숨기면 안 된다 — 과소 차단 방지).
 */
export function countMeasurementCoverage(
  responses: MeasurableResponse[] | null | undefined
): MeasurementCoverage {
  const list = responses ?? [];
  const attempted = new Set(list.map((r) => r.engineId)).size;
  const measured = new Set(
    list.filter((r) => !(r.errorMessage || r.isStub)).map((r) => r.engineId)
  ).size;
  return { attempted, measured };
}

/**
 * 이 회차를 "측정 실패"로 다뤄야 하는가.
 *
 * `attempted > 0` 을 함께 요구하는 이유: 응답 배열이 아예 비어 있는 회차는
 * **물어보지도 못한** 상태라 기존 빈 결과 화면이 담당한다(여기서 가로채면 안 된다).
 */
export function isMeasurementFailure(coverage: MeasurementCoverage): boolean {
  return coverage.measured === 0 && coverage.attempted > 0;
}
