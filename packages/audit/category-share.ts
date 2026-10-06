// 이름 없는 구매 질문의 답변 → 리포트 v12 의 「이름 없이 물으면 누가 추천될까」·「주제별 1위」·
// 「물어본 구매 질문 전체」 (2026-10-06, 측정 알고리즘 v3 §2-③)
//
// 출력 모양은 apps/web/components/client-report-v12/report-v12.tsx 의
//   `category_share`·`topic_winners`·`category_questions` 와 **정확히 같다**(관제탑이 config 에 그대로 넣는다).
//
// 셈 규칙
//   · AI 답변만 센다(answerGroup === "ai"). 네이버·다음은 검색 노출이라 추천이 아니다.
//   · 실패·스텁 답변은 분모에서 뺀다.
//   · 한 답변에서 같은 브랜드가 여러 번 나와도 1번(「답변 N건 중 M건에서 추천」).
//   · pct = 그 브랜드가 나온 답변 수 ÷ 분석한 답변 수 × 100(소수 1자리). 합이 100 이 아니다.
//   · 우리 브랜드 = 판정기의 brandMentioned(동명이인 거른 값). 값이 없을 때만 이름 일치.
//
// ⚠️ 한계(리포트 note 로도 쓴다)
//   · 경쟁 브랜드 이름은 `competitor-extract` 의 번호 목록 파서로만 뽑는다(같은 규칙 재사용).
//     「- **브랜드**」 같은 글머리표·문단 속 브랜드는 못 센다 → 실제보다 적게 셀 수 있다.
//   · 한/영 표기 병합은 내장 대형 브랜드 사전 + 고객 등록 경쟁사 별칭까지만(퍼지 매칭 없음).
//   · 목록 항목이 제품명이면(「아누아 어성초 77 토너」) 브랜드 단위가 아니라 그 표기 그대로 센다.

import { detectBrandMention } from "@repo/ai/lib/engines/utils";
import { answerGroup } from "./answer-buckets";
import {
  competitorKey,
  extractCompetitorLandscape,
  type KnownCompetitor,
} from "./competitor-extract";
import {
  DEMAND_TOPICS,
  type DemandProvenance,
  type DemandQuestion,
  type DemandTopic,
} from "./demand-prompts";

export interface CategoryShareConfig {
  answers: number;
  brands: { mentions: number; name: string; pct: number; self?: boolean }[];
  examples: string[];
  note?: string;
  questions: number;
}

export interface TopicWinnerConfig {
  question: string;
  self_rank: number | null;
  top: string[];
  topic: string;
}

export interface CategoryReportConfig {
  category_questions: string[];
  category_share: CategoryShareConfig | null;
  topic_winners: TopicWinnerConfig[];
}

export interface CategoryAnswer {
  brandMentioned?: boolean | null;
  engineId: string;
  errorMessage?: string | null;
  excerpt?: string | null;
  isStub?: boolean | null;
  promptDemand?: DemandProvenance | null;
  promptKind?: string | null;
  promptText?: string | null;
  rawResponse?: string | null;
}

export interface CategoryReportInput {
  answers: readonly CategoryAnswer[];
  brandName: string;
  brandVariants?: readonly string[];
  knownCompetitors?: Array<KnownCompetitor | string>;
  /** 생성된 질문 전체(출처 포함). 없으면 답변의 promptDemand 로 대신한다. */
  questions?: readonly DemandQuestion[];
}

const MAX_BRANDS = 15;
const MAX_EXAMPLES = 3;
const TOP_PER_TOPIC = 3;
const NOTE =
  "AI 답변의 번호 목록에서 브랜드 이름을 셌습니다. 한 답변에서 여러 번 나와도 1번으로 셉니다. 글머리표·문단 속 브랜드는 빠질 수 있어 실제보다 적게 잡힐 수 있습니다.";

interface Tally {
  display: string;
  mentions: number;
  self: boolean;
}

/** 답변 하나 → 그 답변이 추천한 브랜드 키(중복 없음)와 표시명. */
function brandsInAnswer(
  answer: CategoryAnswer,
  input: CategoryReportInput
): Map<string, { display: string; self: boolean }> {
  const text = answer.rawResponse ?? answer.excerpt ?? "";
  const variants = [...(input.brandVariants ?? [])];
  const known = input.knownCompetitors ?? [];
  const landscape = extractCompetitorLandscape(
    [text],
    input.brandName,
    variants,
    known
  );
  const out = new Map<string, { display: string; self: boolean }>();
  const selfKey = competitorKey(input.brandName, known);
  for (const row of landscape.ranking) {
    if (row.name === input.brandName) {
      continue; // 우리 브랜드는 아래 판정값으로만 센다(동명이인 방지)
    }
    out.set(competitorKey(row.name, known), { display: row.name, self: false });
  }
  const selfMentioned =
    typeof answer.brandMentioned === "boolean"
      ? answer.brandMentioned
      : detectBrandMention(text, input.brandName, variants).mentioned;
  if (selfMentioned) {
    out.set(selfKey, { display: input.brandName, self: true });
  }
  return out;
}

function rankTallies(tallies: Map<string, Tally>): Tally[] {
  return [...tallies.values()].sort(
    (a, b) => b.mentions - a.mentions || a.display.localeCompare(b.display)
  );
}

function addAnswer(
  tallies: Map<string, Tally>,
  brands: Map<string, { display: string; self: boolean }>,
  displayOf: Map<string, string>
): void {
  for (const [key, b] of brands) {
    const t = tallies.get(key) ?? {
      display: displayOf.get(key) ?? b.display,
      mentions: 0,
      self: b.self,
    };
    t.mentions += 1;
    t.self ||= b.self;
    tallies.set(key, t);
  }
}

const HANGUL_RE = /[가-힣]/;

const pct1 = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export function isCountableDiscoveryAnswer(answer: CategoryAnswer): boolean {
  return (
    answer.promptKind === "discovery" &&
    answerGroup(answer.engineId) === "ai" &&
    !answer.errorMessage &&
    !answer.isStub &&
    Boolean(answer.rawResponse ?? answer.excerpt)
  );
}

type BrandsByKey = Map<string, { display: string; self: boolean }>;

/** 질문 문장 → 출처(주제·검색량). 생성 목록 우선, 없으면 답변에 붙은 출처. */
function provenanceMap(
  input: CategoryReportInput
): Map<string, DemandProvenance> {
  const out = new Map<string, DemandProvenance>();
  for (const q of input.questions ?? []) {
    out.set(q.text, q);
  }
  for (const a of input.answers) {
    if (a.promptText && a.promptDemand && !out.has(a.promptText)) {
      out.set(a.promptText, a.promptDemand);
    }
  }
  return out;
}

/** 같은 브랜드는 리포트 전체에서 한 표기로(처음 나온 표기, 한글 우선 · 우리 브랜드는 공식명). */
function displayNames(
  perAnswer: readonly BrandsByKey[],
  brandName: string
): Map<string, string> {
  const out = new Map<string, string>();
  for (const brands of perAnswer) {
    for (const [key, b] of brands) {
      const current = out.get(key);
      if (b.self) {
        out.set(key, brandName);
      } else if (
        current === undefined ||
        (HANGUL_RE.test(b.display) && !HANGUL_RE.test(current))
      ) {
        out.set(key, b.display);
      }
    }
  }
  return out;
}

function byVolumeDesc(provenance: Map<string, DemandProvenance>) {
  return (a: string, b: string) =>
    (provenance.get(b)?.volume ?? 0) - (provenance.get(a)?.volume ?? 0) ||
    a.localeCompare(b);
}

interface TopicBucket {
  questions: Set<string>;
  tallies: Map<string, Tally>;
}

function topicWinners(
  byTopic: Map<DemandTopic, TopicBucket>,
  provenance: Map<string, DemandProvenance>
): TopicWinnerConfig[] {
  return [...byTopic.entries()]
    .sort(
      (a, b) =>
        DEMAND_TOPICS.indexOf(a[0]) - DEMAND_TOPICS.indexOf(b[0]) ||
        a[0].localeCompare(b[0])
    )
    .map(([topic, entry]) => {
      const ranked = rankTallies(entry.tallies).filter((t) => t.mentions > 0);
      const selfIndex = ranked.findIndex((t) => t.self);
      const question = [...entry.questions].sort(byVolumeDesc(provenance))[0];
      return {
        topic,
        question: question ?? "",
        top: ranked.slice(0, TOP_PER_TOPIC).map((t) => t.display),
        self_rank: selfIndex >= 0 ? selfIndex + 1 : null,
      };
    });
}

export function buildCategoryReport(
  input: CategoryReportInput
): CategoryReportConfig {
  const answers = input.answers.filter(isCountableDiscoveryAnswer);
  const provenance = provenanceMap(input);
  const askedTexts = [
    ...new Set(
      answers.map((a) => a.promptText).filter((t): t is string => Boolean(t))
    ),
  ];
  // 「물어본」 질문만 싣는다(생성했지만 이번 회차에 묻지 않은 질문은 넣지 않는다).
  const asked = new Set(askedTexts);
  const category_questions = [
    ...new Set([
      ...(input.questions ?? []).map((q) => q.text).filter((t) => asked.has(t)),
      ...askedTexts,
    ]),
  ];
  if (answers.length === 0) {
    return { category_share: null, topic_winners: [], category_questions };
  }

  const perAnswer = answers.map((answer) => brandsInAnswer(answer, input));
  const displayOf = displayNames(perAnswer, input.brandName);
  const overall = new Map<string, Tally>();
  const byTopic = new Map<DemandTopic, TopicBucket>();
  for (const [index, answer] of answers.entries()) {
    const brands = perAnswer[index] ?? new Map();
    addAnswer(overall, brands, displayOf);
    const text = answer.promptText ?? "";
    const topic = provenance.get(text)?.topic;
    if (topic) {
      const entry = byTopic.get(topic) ?? {
        questions: new Set<string>(),
        tallies: new Map<string, Tally>(),
      };
      entry.questions.add(text);
      addAnswer(entry.tallies, brands, displayOf);
      byTopic.set(topic, entry);
    }
  }

  const ranked = rankTallies(overall).filter((t) => t.mentions > 0);
  const category_share: CategoryShareConfig = {
    answers: answers.length,
    questions: askedTexts.length,
    examples: [...askedTexts]
      .sort(byVolumeDesc(provenance))
      .slice(0, MAX_EXAMPLES),
    note: NOTE,
    brands: [
      ...ranked.slice(0, MAX_BRANDS),
      // 우리 브랜드가 상위 목록 밖이어도 자기 줄은 남긴다(화면이 자기 비율을 찾는다).
      ...ranked.slice(MAX_BRANDS).filter((t) => t.self),
    ].map((t) => ({
      name: t.display,
      mentions: t.mentions,
      pct: pct1(t.mentions, answers.length),
      ...(t.self ? { self: true } : {}),
    })),
  };

  return {
    category_share,
    topic_winners: topicWinners(byTopic, provenance),
    category_questions,
  };
}

/** 저장된 AuditJob.result → 리포트 config 조각. 관제탑이 config.json 을 만들 때 쓴다. */
export function categoryReportFromAuditResult(
  result: unknown
): CategoryReportConfig | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const r = result as {
    brandName?: unknown;
    brandVariants?: unknown;
    engineResponses?: unknown;
    measurementContext?: { demandQuestionSet?: unknown } | null;
    registeredCompetitors?: unknown;
  };
  if (typeof r.brandName !== "string" || !Array.isArray(r.engineResponses)) {
    return null;
  }
  const set = r.measurementContext?.demandQuestionSet as
    | { questions?: Record<string, DemandQuestion[]> }
    | undefined;
  const questions = set?.questions
    ? [...(set.questions.KR ?? []), ...(set.questions.US ?? [])]
    : [];
  return buildCategoryReport({
    brandName: r.brandName,
    brandVariants: Array.isArray(r.brandVariants)
      ? r.brandVariants.filter((v): v is string => typeof v === "string")
      : [],
    knownCompetitors: Array.isArray(r.registeredCompetitors)
      ? (r.registeredCompetitors as Array<KnownCompetitor | string>)
      : [],
    answers: r.engineResponses as CategoryAnswer[],
    questions,
  });
}
