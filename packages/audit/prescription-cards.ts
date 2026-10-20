/**
 * 정적 처방 카드 (RX-1, 2026-10-20 S4) — **데이터 전용**. 화면 코드가 아니다.
 *
 * 쉬운 말 풀이: 「이 조치는 이런 근거로 시도해 볼 만하다, 이럴 땐 안 통한다」를 적어 둔 고정 목록이다.
 * 앱 화면에 카드를 보여 주는 코드는 만들지 않는다(승인된 시안 뒤 2차 이후).
 *
 * 규칙(`13_S4_지시서.md` 4절):
 *  1. 연구에서 효과가 관찰된 조건은 「이미 검색돼 AI의 맥락에 들어오는 문서에, 질문과 맞는 통계·인용 근거를 더하는 것」이다.
 *     서식·FAQ·스키마만 손본 경우는 효과가 거의 없다고 보고됐다. **한국어·실제 브랜드·실제 엔진의 효과는 입증되지 않았다.**
 *  2. 근거 등급은 기존 `EvidenceGrade`(action-rules.ts)를 그대로 쓰고 라벨은 `EVIDENCE_GRADE_LABEL` 을 재사용한다.
 *     `strong` 은 우리 실측이 쌓이기 전에는 쓰지 않는다. `format_only` 는 weak 또는 none.
 *  3. `fails_when`(실패 조건)과 `limits_ko`(한계)는 필수다. `not_a_guarantee` 는 true 리터럴.
 *  4. 논문의 최대·평균 개선 수치를 카드·주석 어디에도 적지 않는다. 효과 수치 필드 자체를 두지 않는다.
 *  5. `kind` 의 `content_evidence`·`format_only` 는 RX-2(`proof-plan.ts`)의 조치 유형과 같은 값이다.
 *
 * `action-rules.ts` 는 읽기만 한다(수정 금지).
 */

import {
  EVIDENCE_GRADE_LABEL,
  type EvidenceGrade,
  RULE_SOURCES,
} from "./action-rules";
import {
  ACTION_TYPES,
  type ActionType,
  findForbiddenPhrases,
  type ValidationIssue,
  type ValidationResult,
} from "./proof-plan";

// ──────────────────────────────────────────────────
// 모양
// ──────────────────────────────────────────────────

export const PRESCRIPTION_KINDS = [...ACTION_TYPES, "access_fix"] as const;
/** content_evidence · format_only(= RX-2 조치 유형) + access_fix(접근 수정, 조치 기록 대상 아님). */
export type PrescriptionKind = ActionType | "access_fix";

/** 모든 카드의 실패 조건이 반드시 다뤄야 하는 5가지. */
export const REQUIRED_FAIL_CODES = [
  "not_indexed", // ① 검색 단계에서 아예 안 걸리는 페이지(색인·검색 노출 부재)
  "model_knowledge_only", // ② 모델 지식으로만 답하는 엔진(웹 검색 호출 없음)
  "format_only_change", // ③ 서식·FAQ·스키마만 바꾼 경우
  "competitor_same_change", // ④ 경쟁 문서도 같은 보강을 한 경우
  "question_mismatch", // ⑤ 질문과 제목·문단이 맞지 않는 경우
] as const;
export type FailCode = (typeof REQUIRED_FAIL_CODES)[number];

export interface FailCondition {
  code: FailCode;
  text_ko: string;
}

export interface CardSource {
  label: string;
  /** 출처 문서 안의 위치(절·확인 등급). */
  locator: string;
  /** 공식 문서 등 주소가 있는 것만. 논문은 ID만 적고 주소는 만들지 않는다. */
  url: string | null;
}

export interface PrescriptionCard {
  /** 근거 설명 한 줄 + 출처 위치. */
  basis: { sources: CardSource[]; summary_ko: string };
  evidence_grade: EvidenceGrade;
  /** 실패 조건(필수). REQUIRED_FAIL_CODES 5개를 모두 포함한다. */
  fails_when: FailCondition[];
  id: string;
  kind: PrescriptionKind;
  /** 한계 문구(필수). 「한국어 효과 미입증」을 포함한다. */
  limits_ko: string;
  /** 리터럴 true — 「효과 보장」으로 쓸 수 없게 타입으로 막는다. */
  not_a_guarantee: true;
  title_ko: string;
  /** 통할 수 있는 조건. */
  works_when: string[];
}

/** 카드에 허용되는 칸. 이 밖의 칸(효과 수치·개선율 등)은 검증기가 거부한다. */
export const CARD_FIELDS = [
  "basis",
  "evidence_grade",
  "fails_when",
  "id",
  "kind",
  "limits_ko",
  "not_a_guarantee",
  "title_ko",
  "works_when",
] as const;

const X_DOC = "X_GEO_효과증명_워크플로_개발_리서치_20261020.md";

const LIMITS_COMMON =
  "한국어·실제 브랜드·실제 엔진에서의 효과는 미입증입니다. 연구 대부분이 영어·합성 입력·단일 시점이고 이 근거는 초록 위주로 읽었습니다. 효과를 보장하지 않으며, 같은 질문도 매번 답이 달라질 수 있어 한 번의 전후 값으로 판단하지 않습니다.";

// ──────────────────────────────────────────────────
// 카드 데이터
// ──────────────────────────────────────────────────

export const PRESCRIPTION_CARDS: readonly PrescriptionCard[] = [
  {
    id: "rx-evidence-on-indexed-page",
    title_ko: "이미 검색되는 페이지에 질문과 맞는 통계·인용 근거를 더하기",
    kind: "content_evidence",
    evidence_grade: "weak",
    basis: {
      summary_ko:
        "연구 요약(초록 위주): 이미 검색돼 AI의 맥락에 들어오는 문서에 질문과 맞는 통계·인용 근거를 더했을 때 인용 방식이 달라졌다고 보고됨. 영어·합성 입력·단일 시점 위주라 한국어 미입증.",
      sources: [
        {
          label: "GEO 원 논문(arXiv 2311.09735) — 통계·인용 추가 방법 비교",
          locator: `${X_DOC} 2절 [확인: PDF 열람]`,
          url: null,
        },
        {
          label:
            "What Gets Cited(arXiv 2605.25517) — 통제 실험, 작은 모델·구성된 입력",
          locator: `${X_DOC} 2절 [확인: 초록]`,
          url: null,
        },
        {
          label:
            "비판적 서베이(arXiv 2607.14035) — 안정적 장기 효과가 확인된 기법은 없다는 결론",
          locator: `${X_DOC} 2절 [확인: 초록]`,
          url: null,
        },
      ],
    },
    works_when: [
      "수정할 페이지가 이미 검색에 걸리고 엔진이 그 페이지를 읽어 오는 경우",
      "질문과 제목·문단이 맞고, 출처가 있는 통계·인용 같은 구체적 근거를 더한 경우",
      "해당 엔진이 답변 전에 웹 검색을 호출하는 경우",
    ],
    fails_when: [
      {
        code: "not_indexed",
        text_ko:
          "페이지가 검색 단계에서 아예 걸리지 않으면(색인·검색 노출 없음) 근거를 더해도 엔진의 맥락에 들어오지 않습니다. 새 페이지가 아직 색인되지 않은 경우가 여기에 해당합니다.",
      },
      {
        code: "model_knowledge_only",
        text_ko:
          "웹 검색 없이 모델 지식만으로 답하는 엔진은 페이지 수정이 1주 안에 반영됐다고 보기 어렵습니다. 웹 검색 엔진과 따로 기록합니다.",
      },
      {
        code: "format_only_change",
        text_ko:
          "서식·FAQ·스키마만 바꾸고 내용 근거를 더하지 않았다면 이 카드가 아니라 서식 카드의 경우입니다(효과가 거의 없다고 보고됨).",
      },
      {
        code: "competitor_same_change",
        text_ko:
          "경쟁 문서도 같은 보강을 했다면 상대적 이점이 줄어듭니다(연구에서도 도입자가 늘면 이득이 줄어든다고 보고됨).",
      },
      {
        code: "question_mismatch",
        text_ko:
          "질문과 제목·문단이 맞지 않으면 근거를 더해도 해당 질문의 답에 쓰이기 어렵습니다.",
      },
    ],
    limits_ko: LIMITS_COMMON,
    not_a_guarantee: true,
  },
  {
    id: "rx-schema-only",
    title_ko: "구조화 데이터(스키마)만 붙이기 — 효과를 기대하기 어려운 조치",
    kind: "format_only",
    evidence_grade: "none",
    basis: {
      summary_ko:
        "스키마를 추가한 페이지를 매칭 비교한 조사와 서식만 바꾼 편집의 통제 실험에서 인용 변화가 거의 확인되지 않았다고 보고됨. 초록 기준이며 한국어 미입증. 기존 「하지 마세요」 목록의 스키마 항목과 같은 방향.",
      sources: [
        {
          label: "Ahrefs — 스키마 추가 페이지 매칭 비교(관찰 연구)",
          locator:
            "packages/audit/action-rules.ts RULE_SOURCES.ahrefsSchema, DONT_LIST",
          url: RULE_SOURCES.ahrefsSchema.url,
        },
        {
          label:
            "What Gets Cited(arXiv 2605.25517) — 서식만 바꾼 편집은 영향이 거의 없음",
          locator: `${X_DOC} 2절 [확인: 초록]`,
          url: null,
        },
      ],
    },
    works_when: [
      "회사 정보를 정확히 알리는 용도로 쓰는 경우(인용 증가를 기대하는 용도가 아님)",
    ],
    fails_when: [
      {
        code: "not_indexed",
        text_ko:
          "페이지가 검색 단계에서 걸리지 않으면 스키마가 있어도 엔진의 맥락에 들어오지 않습니다.",
      },
      {
        code: "model_knowledge_only",
        text_ko:
          "웹 검색 없이 모델 지식만으로 답하는 엔진에는 스키마 수정이 닿지 않습니다.",
      },
      {
        code: "format_only_change",
        text_ko:
          "이 카드 자체가 서식·스키마만 바꾸는 조치입니다. 효과가 거의 없다고 보고됐으므로 「약한 처방의 관찰」로만 기록합니다.",
      },
      {
        code: "competitor_same_change",
        text_ko: "경쟁사도 스키마를 붙였다면 차이를 만들기 어렵습니다.",
      },
      {
        code: "question_mismatch",
        text_ko:
          "스키마를 붙여도 질문과 제목·문단이 맞지 않으면 해당 질문에서는 달라지지 않습니다.",
      },
    ],
    limits_ko: `서식·스키마만 바꾼 조치는 효과가 거의 없다고 보고됐고 우리 환경에서는 미입증입니다. ${LIMITS_COMMON}`,
    not_a_guarantee: true,
  },
  {
    id: "rx-faq-summary-layout",
    title_ko: "FAQ 블록·요약 상자·문단 구조만 정리하기",
    kind: "format_only",
    evidence_grade: "weak",
    basis: {
      summary_ko:
        "FAQ 블록·구조화 데이터·요약 상자는 사이트 간 차이에서만 보이고 같은 사이트 안에서는 뚜렷하지 않다고 보고됨. 초록 기준이라 근거 약함, 한국어 미입증.",
      sources: [
        {
          label:
            "What Drives AI Citations(arXiv 2610.15033) — 같은 사이트 안 페이지 비교",
          locator: `${X_DOC} 2절 [확인: 초록, 2026-10-10]`,
          url: null,
        },
        {
          label:
            "What Gets Cited(arXiv 2605.25517) — 서식만 바꾼 편집은 영향이 거의 없음",
          locator: `${X_DOC} 2절 [확인: 초록]`,
          url: null,
        },
      ],
    },
    works_when: [
      "사람이 읽기 쉽게 정리하는 목적이고, 인용 증가는 기대하지 않는 경우",
    ],
    fails_when: [
      {
        code: "not_indexed",
        text_ko:
          "페이지가 검색에 걸리지 않으면 구조를 정리해도 엔진이 읽지 못합니다.",
      },
      {
        code: "model_knowledge_only",
        text_ko: "웹 검색 없이 모델 지식만으로 답하는 엔진에는 닿지 않습니다.",
      },
      {
        code: "format_only_change",
        text_ko:
          "이 카드 자체가 서식·FAQ만 바꾸는 조치입니다. 효과가 거의 없다고 보고됐으므로 효과 약함 가능성을 병기해 기록합니다.",
      },
      {
        code: "competitor_same_change",
        text_ko: "경쟁 문서도 같은 구조를 갖췄다면 차이가 나지 않습니다.",
      },
      {
        code: "question_mismatch",
        text_ko:
          "FAQ 질문이 실제 측정 질문과 맞지 않으면 해당 질문에는 영향이 없습니다.",
      },
    ],
    limits_ko: `서식·FAQ만 바꾼 조치는 효과가 거의 없다고 보고됐고 우리 환경에서는 미입증입니다. ${LIMITS_COMMON}`,
    not_a_guarantee: true,
  },
  {
    id: "rx-crawl-access-check",
    title_ko: "AI 봇이 페이지 글자를 읽을 수 있는지 먼저 확인·수정하기",
    kind: "access_fix",
    evidence_grade: "medium",
    basis: {
      summary_ko:
        "공식 문서 기준: 봇이 페이지를 읽을 수 있는 것은 인용의 전제 조건. 읽히게 한다고 인용이 생긴다는 근거는 아니며 한국어·우리 환경 효과는 미입증. 기존 앱의 접근성 점검 카드와 같은 근거.",
      sources: [
        {
          label: "Google 검색 센터 — 자바스크립트 SEO 기본(렌더링)",
          locator: "packages/audit/action-rules.ts RULE_SOURCES.googleJsSeo",
          url: RULE_SOURCES.googleJsSeo.url,
        },
        {
          label: "OpenAI — 크롤러(OAI-SearchBot·GPTBot) 안내",
          locator: "packages/audit/action-rules.ts RULE_SOURCES.openaiBots",
          url: RULE_SOURCES.openaiBots.url,
        },
      ],
    },
    works_when: [
      "소스 보기에 본문이 없거나 robots.txt 가 검색·AI 봇을 막고 있어 읽을 수 없던 경우",
    ],
    fails_when: [
      {
        code: "not_indexed",
        text_ko:
          "접근을 풀어도 색인·검색 노출이 따로 이뤄지지 않으면 엔진의 맥락에 들어오지 않습니다. 재수집 시점은 보장되지 않습니다.",
      },
      {
        code: "model_knowledge_only",
        text_ko:
          "웹 검색 없이 모델 지식만으로 답하는 엔진에는 접근 수정이 닿지 않습니다.",
      },
      {
        code: "format_only_change",
        text_ko:
          "접근만 풀고 본문에 질문과 맞는 근거를 더하지 않으면 읽히기만 할 뿐이며, 서식 수준의 변경과 같은 한계가 있습니다.",
      },
      {
        code: "competitor_same_change",
        text_ko:
          "경쟁 문서도 접근이 열려 있다면 이 조치만으로 차이가 생기지 않습니다.",
      },
      {
        code: "question_mismatch",
        text_ko:
          "읽히더라도 질문과 제목·문단이 맞지 않으면 해당 질문의 답에 쓰이기 어렵습니다.",
      },
    ],
    limits_ko: `접근 수정은 전제 조건일 뿐 인용을 만든다는 근거가 아닙니다. ${LIMITS_COMMON}`,
    not_a_guarantee: true,
  },
];

/** 카드의 근거 등급 라벨(글자). `EVIDENCE_GRADE_LABEL` 재사용 — 문구를 복사하지 않는다. */
export function gradeLabelOf(
  card: Pick<PrescriptionCard, "evidence_grade">
): string {
  return EVIDENCE_GRADE_LABEL[card.evidence_grade].label;
}

// ──────────────────────────────────────────────────
// 검증기
// ──────────────────────────────────────────────────

const GRADES: readonly EvidenceGrade[] = ["strong", "medium", "weak", "none"];

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

type Add = (field: string, message: string) => void;

function checkShape(raw: Record<string, unknown>, add: Add): void {
  const allowed = new Set<string>(CARD_FIELDS);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      add(key, "허용되지 않는 칸입니다(효과 수치·개선율 칸은 두지 않습니다)");
    }
  }
  for (const field of ["id", "title_ko", "limits_ko"] as const) {
    if (!nonEmpty(raw[field])) {
      add(field, "필수 칸입니다");
    }
  }
  if (raw.not_a_guarantee !== true) {
    add("not_a_guarantee", "true 여야 합니다");
  }
  if (
    !(
      Array.isArray(raw.works_when) &&
      raw.works_when.length > 0 &&
      raw.works_when.every(nonEmpty)
    )
  ) {
    add("works_when", "비어 있지 않은 문자열 목록이 필요합니다");
  }
}

function checkGrade(raw: Record<string, unknown>, add: Add): void {
  const kindOk = (PRESCRIPTION_KINDS as readonly string[]).includes(
    raw.kind as string
  );
  if (!kindOk) {
    add("kind", `${PRESCRIPTION_KINDS.join(" | ")} 중 하나여야 합니다`);
  }
  if (!GRADES.includes(raw.evidence_grade as EvidenceGrade)) {
    add("evidence_grade", `${GRADES.join(" | ")} 중 하나여야 합니다`);
    return;
  }
  if (raw.evidence_grade === "strong") {
    add(
      "evidence_grade",
      "strong 은 우리 실측이 쌓이기 전에는 쓰지 않습니다(최대 medium)"
    );
  }
  if (
    raw.kind === "format_only" &&
    raw.evidence_grade !== "weak" &&
    raw.evidence_grade !== "none"
  ) {
    add("evidence_grade", "format_only 는 weak 또는 none 이어야 합니다");
  }
  if (
    raw.kind === "format_only" &&
    !(
      typeof raw.limits_ko === "string" &&
      raw.limits_ko.includes("거의 없") &&
      raw.limits_ko.includes("미입증")
    )
  ) {
    add(
      "limits_ko",
      "format_only 는 「효과가 거의 없다고 보고됨, 우리 환경 미입증」을 적어야 합니다"
    );
  }
}

function checkFails(raw: Record<string, unknown>, add: Add): void {
  const fails = raw.fails_when;
  if (!(Array.isArray(fails) && fails.length > 0)) {
    add("fails_when", "실패 조건은 필수입니다(비어 있으면 안 됩니다)");
    return;
  }
  const codes = new Set<string>();
  for (const f of fails) {
    if (isRec(f) && nonEmpty(f.text_ko) && typeof f.code === "string") {
      codes.add(f.code);
    } else {
      add("fails_when", "각 항목은 {code, text_ko} 여야 합니다");
    }
  }
  for (const need of REQUIRED_FAIL_CODES) {
    if (!codes.has(need)) {
      add("fails_when", `필수 실패 조건 누락: ${need}`);
    }
  }
}

function checkBasis(raw: Record<string, unknown>, add: Add): void {
  const basis = raw.basis;
  if (!(isRec(basis) && nonEmpty(basis.summary_ko))) {
    add("basis", "근거 설명(summary_ko)이 필요합니다");
    return;
  }
  const sources = basis.sources;
  if (
    !(
      Array.isArray(sources) &&
      sources.length > 0 &&
      sources.every((s) => isRec(s) && nonEmpty(s.label) && nonEmpty(s.locator))
    )
  ) {
    add("basis", "출처(label·locator)가 하나 이상 필요합니다");
  }
  if (!(basis.summary_ko as string).includes("미입증")) {
    add("basis", "근거 설명에 「한국어 미입증」을 적어야 합니다");
  }
}

function collectTexts(raw: Record<string, unknown>): [string, unknown][] {
  const texts: [string, unknown][] = [
    ["title_ko", raw.title_ko],
    ["limits_ko", raw.limits_ko],
  ];
  if (Array.isArray(raw.works_when)) {
    for (const [i, t] of raw.works_when.entries()) {
      texts.push([`works_when[${i}]`, t]);
    }
  }
  if (Array.isArray(raw.fails_when)) {
    for (const [i, f] of raw.fails_when.entries()) {
      texts.push([`fails_when[${i}]`, isRec(f) ? f.text_ko : null]);
    }
  }
  if (isRec(raw.basis)) {
    texts.push(["basis.summary_ko", raw.basis.summary_ko]);
    if (Array.isArray(raw.basis.sources)) {
      for (const [i, s] of raw.basis.sources.entries()) {
        texts.push([`basis.sources[${i}].label`, isRec(s) ? s.label : null]);
      }
    }
  }
  return texts;
}

function checkText(raw: Record<string, unknown>, add: Add): void {
  for (const [field, value] of collectTexts(raw)) {
    if (typeof value === "string") {
      const hits = findForbiddenPhrases(value);
      if (hits.length > 0) {
        add(field, `금칙 표현이 있습니다: ${hits.join(", ")}`);
      }
    }
  }
}

/** 카드 1장을 검사한다. 필수 칸·등급 규칙·실패 조건 5종·금칙 표현·허용 밖 칸을 모두 모아 돌려준다. */
export function validatePrescriptionCard(
  input: unknown,
  path = "$"
): ValidationResult {
  if (!isRec(input)) {
    return { ok: false, issues: [{ path, message: "객체여야 합니다" }] };
  }
  const issues: ValidationIssue[] = [];
  const add: Add = (field, message) =>
    issues.push({ path: `${path}.${field}`, message });
  checkShape(input, add);
  checkGrade(input, add);
  checkFails(input, add);
  checkBasis(input, add);
  checkText(input, add);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** 카드 목록 전체를 검사한다(ID 중복 포함). */
export function validatePrescriptionCards(list: unknown): ValidationResult {
  if (!Array.isArray(list)) {
    return { ok: false, issues: [{ path: "$", message: "배열이어야 합니다" }] };
  }
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  list.forEach((card, i) => {
    const r = validatePrescriptionCard(card, `cards[${i}]`);
    if (!r.ok) {
      issues.push(...r.issues);
    }
    if (isRec(card) && typeof card.id === "string") {
      if (seen.has(card.id)) {
        issues.push({ path: `cards[${i}].id`, message: "ID가 중복됩니다" });
      }
      seen.add(card.id);
    }
  });
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
