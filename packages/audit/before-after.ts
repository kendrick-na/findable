// 조치 전후(before/after) 대조 — 2026-08-12 세션N-24
//
// 목적: 고객사가 처방을 실행한 **뒤에 실제로 점수가 올랐는지**를 숫자로 보여준다.
//   대표님이 투자·영업 자리에서 쓸 **근거 자료**이자, 고객에게는 리텐션 이유가 된다.
//
// 🔴 **이 파일이 지키는 단 하나의 규칙: 없는 인과를 만들지 않는다.**
//   "조치했더니 올랐다"는 **상관**이지 인과가 아니다. 같은 기간에 경쟁사가 빠졌을 수도,
//   우리 측정기가 바뀌었을 수도 있다.
//   📌 실제 사고 이력: 설화수 언급이 16→27 로 올랐지만 측정자가 **전량 우리 본인**이었고
//      상승 시기가 **우리 측정기 개선 시기와 겹쳤다**. 그대로 내놨으면 VC 에게
//      *"제품 효과가 아니라 측정 방식이 바뀐 것"* 으로 정확히 반대로 읽혔을 것이다.
//   → 그래서 이 모듈은 **판정하지 않는다**. 숫자와 그 숫자의 한계를 같이 내보낸다.
//
// 설계: 순수 함수. DB 접근은 호출부가 하고 여기서는 계산만 한다
//   (프로젝트 교훈: "라이브에서 확인 못 하는 경로는 순수 함수로 빼서 테스트로 고정").

/** 조치 완료 1건 — `ActionCompletion` 에서 필요한 것만. */
export interface CompletionRecord {
  /** 조치를 완료 표시한 시각. 이 시점이 before/after 의 경계다. */
  completedAt: Date;
  kind: string;
  /** 완료 **시점의** 인지율 스냅샷. 측정이 갱신돼도 고정된다. */
  recognitionAtCompletion: number | null;
  /** 완료 **시점의** SoV 스냅샷. */
  sovAtCompletion: number | null;
  /** 같은 종류 안에서 대상을 구분하는 키(질문 원문·도메인 등). */
  target: string;
}

/** 측정 1회분 — `Tracking` 집계 결과. */
export interface MeasurementPoint {
  measuredAt: Date;
  /** 0~1. 없으면 null(측정 실패·미집계). */
  sov: number | null;
}

export interface BeforeAfterRow {
  /** after 측정이 아직 없으면 null — **"아직 모른다"** 를 0 과 구분한다. */
  afterSov: number | null;
  beforeSov: number | null;
  /**
   * 🔴 이 행을 근거로 쓸 수 있는지에 대한 **정직한 경고**.
   * 비어 있으면 "쓸 만하다"가 아니라 **"알려진 결격 사유가 없다"** 는 뜻이다.
   */
  caveats: string[];
  completedAt: Date;
  /** afterSov - beforeSov. 둘 중 하나라도 없으면 null. */
  deltaSov: number | null;
  kind: string;
  target: string;
}

/** after 를 인정하기까지 필요한 최소 간격. 조치 직후 측정은 조치 효과가 아니다. */
const MIN_AFTER_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * 조치 1건에 대해 전/후 측정을 짝지어 준다.
 *
 * @param completion 조치 완료 기록(스냅샷 포함)
 * @param measurements 이 브랜드의 측정 시계열(정렬 무관 — 내부에서 정렬한다)
 */
export function buildBeforeAfterRow(
  completion: CompletionRecord,
  measurements: MeasurementPoint[]
): BeforeAfterRow {
  const sorted = [...measurements].sort(
    (a, b) => a.measuredAt.getTime() - b.measuredAt.getTime()
  );
  const completedMs = completion.completedAt.getTime();

  // before = 완료 시점의 **스냅샷**을 1순위로 쓴다.
  //   ⚠️ 스냅샷이 있는데 시계열에서 다시 찾으면 두 값이 갈릴 수 있다(재측정으로 과거가 바뀜).
  //   스냅샷은 "그때 화면에 뭐라고 쓰여 있었나"이므로 **그게 진짜 before** 다.
  const snapshot = completion.sovAtCompletion;
  const beforeFromSeries =
    sorted.filter((m) => m.measuredAt.getTime() <= completedMs).at(-1)?.sov ??
    null;
  const beforeSov = snapshot ?? beforeFromSeries;

  // after = 완료 이후 **충분히 지난** 첫 측정.
  const after =
    sorted.find(
      (m) => m.measuredAt.getTime() - completedMs >= MIN_AFTER_GAP_MS
    ) ?? null;
  const afterSov = after?.sov ?? null;

  const caveats = collectCaveats({
    afterPoint: after,
    afterSov,
    beforeSov,
    hasSnapshot: snapshot !== null,
    measurementCount: sorted.length,
  });

  return {
    afterSov,
    beforeSov,
    caveats,
    completedAt: completion.completedAt,
    deltaSov:
      beforeSov === null || afterSov === null ? null : afterSov - beforeSov,
    kind: completion.kind,
    target: completion.target,
  };
}

/**
 * 🔴 이 행을 "성과 근거"로 쓸 때 **반드시 함께 말해야 하는 것**.
 *
 * 왜 함수로 뺐나: 화면마다 다르게 쓰면 어떤 화면은 경고 없이 숫자만 보여준다.
 * 경고는 숫자와 **같은 곳에서** 나와야 떨어지지 않는다.
 */
function collectCaveats(input: {
  afterPoint: MeasurementPoint | null;
  afterSov: number | null;
  beforeSov: number | null;
  hasSnapshot: boolean;
  measurementCount: number;
}): string[] {
  const caveats: string[] = [];

  if (input.beforeSov === null) {
    caveats.push("조치 전 점수가 없어 비교할 수 없습니다.");
  }
  if (input.afterSov === null) {
    caveats.push(
      "조치 후 24시간이 지난 재측정이 아직 없습니다. 다음 측정 후에 확인하세요."
    );
  }
  if (!input.hasSnapshot && input.beforeSov !== null) {
    // 스냅샷 없이 시계열에서 추정한 before 는 재측정으로 값이 흔들릴 수 있다.
    caveats.push(
      "조치 시점 스냅샷이 없어 직전 측정값으로 대신했습니다(재측정 시 달라질 수 있습니다)."
    );
  }
  // 🔴 인과 경고 — 숫자가 나왔을 때만 붙인다(없는 숫자에 경고를 붙이면 잡음).
  if (input.beforeSov !== null && input.afterSov !== null) {
    caveats.push(
      "점수 변화는 조치 외 요인(경쟁사 변동·측정 방식 변경)도 반영합니다. 인과로 단정할 수 없습니다."
    );
  }
  if (input.measurementCount < 3) {
    caveats.push(
      `측정이 ${input.measurementCount}회뿐이라 추세로 보기 어렵습니다.`
    );
  }

  return caveats;
}

/**
 * 근거 자료로 **내놓을 수 있는** 행만 고른다.
 *
 * ⚠️ 기준을 발명하지 않았다: "before·after 가 둘 다 있다"는 **산술적 최소 조건**이지
 *   품질 임계값이 아니다. (몇 %p 이상이어야 한다 같은 경계선은 분포가 없어 정할 수 없다.)
 */
export function presentableRows(rows: BeforeAfterRow[]): BeforeAfterRow[] {
  return rows.filter((r) => r.deltaSov !== null);
}
