import type { KnownCompetitor } from "@repo/audit/competitor-extract";
import { classifyDomain, type DomainType } from "./domain-type";

/**
 * 경쟁사 빈틈 분석(2026-10-15) — 이미 저장된 측정 답변에서 순수 계산한다(추가 측정·점수 변경 없음).
 *  · 질문 빈틈: 우리는 한 번도 안 나오고 다른 브랜드는 나온 질문
 *  · 출처 빈틈: 우리가 빠지고 경쟁사가 나온 답변에서 인용된 사이트(우리가 나온 답변에서는 안 인용된 곳만)
 *  · 브랜드 보드: 답변에 나열된 브랜드(표·문장 포함, 전체 질문 기준) — 번호 목록만 읽는 기존 집계의 보완
 * 브랜드 이름 추출은 AI(`answer-brands`)가 하고, 이 파일은 그 결과를 집계만 한다.
 */

const NON_AI = new Set(["naver", "daum", "naver-briefing", "hyperclova"]);
const NON_IDENTITY_RE = /[^a-z0-9가-힣]/g;
const compact = (v: string) => v.toLowerCase().replace(NON_IDENTITY_RE, "");

export interface CitedSource {
  domain: string;
  title?: string;
  url: string;
}

export interface AnswerRow {
  brandMentioned: boolean;
  cited: CitedSource[];
  engineId: string;
  excerpt: string;
  /** `${promptIndex}|${engineId}` — AnswerBrand 캐시 키. */
  key: string;
  promptIndex: number;
  promptKind: string;
  promptText: string;
}

interface RawRow {
  brandMentioned?: unknown;
  citedSources?: unknown;
  engineId?: unknown;
  errorMessage?: unknown;
  excerpt?: unknown;
  isStub?: unknown;
  promptIndex?: unknown;
  promptKind?: unknown;
  promptText?: unknown;
}

/** 측정 결과 → 분석에 쓸 AI 답변 행. 검색 노출·브리핑·실패·스텁은 뺀다. 같은 (질문, 엔진)은 마지막 것만. */
export function answerRowsOf(result: unknown): AnswerRow[] {
  const rows =
    result && typeof result === "object"
      ? (result as { engineResponses?: unknown }).engineResponses
      : null;
  if (!Array.isArray(rows)) {
    return [];
  }
  const byKey = new Map<string, AnswerRow>();
  for (const raw of rows as RawRow[]) {
    if (
      !raw ||
      typeof raw.engineId !== "string" ||
      NON_AI.has(raw.engineId) ||
      raw.isStub === true ||
      (typeof raw.errorMessage === "string" && raw.errorMessage.length > 0) ||
      typeof raw.excerpt !== "string" ||
      raw.excerpt.length === 0 ||
      typeof raw.promptText !== "string" ||
      typeof raw.promptIndex !== "number"
    ) {
      continue;
    }
    const cited = Array.isArray(raw.citedSources)
      ? (raw.citedSources as CitedSource[]).filter(
          (c) => c && typeof c.domain === "string" && typeof c.url === "string"
        )
      : [];
    const key = `${raw.promptIndex}|${raw.engineId}`;
    byKey.set(key, {
      key,
      promptIndex: raw.promptIndex,
      engineId: raw.engineId,
      promptText: raw.promptText.trim(),
      promptKind: typeof raw.promptKind === "string" ? raw.promptKind : "",
      excerpt: raw.excerpt,
      brandMentioned: raw.brandMentioned === true,
      cited,
    });
  }
  return [...byKey.values()];
}

export interface BrandCount {
  answers: number;
  isRegistered: boolean;
  name: string;
}
export interface QuestionGap {
  answers: number;
  competitors: Array<{ answers: number; name: string }>;
  promptText: string;
}
export interface SourceGap {
  absentAnswers: number;
  competitors: string[];
  domain: string;
  prompts: number;
  sampleTitle: string | null;
  sampleUrl: string;
  type: DomainType;
}
export interface GapAnalysis {
  /** 분석에 쓴 답변 수 / 전체 AI 답변 수. */
  analyzed: number;
  brandBoard: BrandCount[];
  /** 분석한 답변 중 우리 브랜드가 나온 답변 수. */
  ownAnswers: number;
  questionGaps: QuestionGap[];
  sourceGaps: SourceGap[];
  total: number;
}

const MAX_BOARD = 12;
const MAX_QUESTION_GAPS = 15;
const MAX_SOURCE_GAPS = 12;
const WWW_PREFIX_RE = /^www\./;

function canonicalizer(competitors: readonly KnownCompetitor[]) {
  const map = new Map<string, string>();
  for (const c of competitors) {
    for (const n of [c.name, ...(c.aliases ?? [])]) {
      map.set(compact(n), c.name);
    }
  }
  return (name: string) => map.get(compact(name)) ?? name.trim();
}

type Named = Map<string, { answers: number; display: string }>;
interface PromptAgg {
  answers: number;
  others: Named;
  oursPresent: number;
}
interface SourceAgg {
  absent: number;
  competitors: Set<string>;
  present: number;
  prompts: Set<string>;
  sample: CitedSource;
}

function bump(map: Named, k: string, display: string) {
  const e = map.get(k) ?? { answers: 0, display };
  e.answers += 1;
  map.set(k, e);
}

function addSources(
  sources: Map<string, SourceAgg>,
  row: AnswerRow,
  oursPresent: boolean,
  others: ReadonlyMap<string, string>
) {
  const competitorAbsentRow = !oursPresent && others.size > 0;
  const seen = new Set<string>();
  for (const cite of row.cited) {
    const domain = cite.domain.toLowerCase().replace(WWW_PREFIX_RE, "");
    if (seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    const s = sources.get(domain) ?? {
      absent: 0,
      present: 0,
      competitors: new Set<string>(),
      prompts: new Set<string>(),
      sample: cite,
    };
    if (oursPresent) {
      s.present += 1;
    } else if (competitorAbsentRow) {
      s.absent += 1;
      s.prompts.add(row.promptText);
      for (const name of others.values()) {
        s.competitors.add(name);
      }
    }
    sources.set(domain, s);
  }
}

function isOwnDomain(domain: string, ownDomain: string): boolean {
  const own = ownDomain.toLowerCase().replace(WWW_PREFIX_RE, "");
  return domain === own || domain.endsWith(`.${own}`);
}

function questionGapsOf(
  byPrompt: ReadonlyMap<string, PromptAgg>
): QuestionGap[] {
  const total = (g: QuestionGap) =>
    g.competitors.reduce((s, c) => s + c.answers, 0);
  return [...byPrompt.entries()]
    .filter(([, p]) => p.oursPresent === 0 && p.others.size > 0)
    .map(([promptText, p]) => ({
      promptText,
      answers: p.answers,
      competitors: [...p.others.values()]
        .map((e) => ({ name: e.display, answers: e.answers }))
        .sort((a, b) => b.answers - a.answers)
        .slice(0, 5),
    }))
    .sort((a, b) => total(b) - total(a))
    .slice(0, MAX_QUESTION_GAPS);
}

function sourceGapsOf(
  sources: ReadonlyMap<string, SourceAgg>,
  ownDomain: string,
  competitorNames: readonly string[]
): SourceGap[] {
  return [...sources.entries()]
    .filter(
      ([domain, s]) =>
        s.absent > 0 && s.present === 0 && !isOwnDomain(domain, ownDomain)
    )
    .map(([domain, s]) => ({
      domain,
      type: classifyDomain(domain, { ownDomain, competitorNames }),
      absentAnswers: s.absent,
      prompts: s.prompts.size,
      competitors: [...s.competitors].slice(0, 4),
      sampleUrl: s.sample.url,
      sampleTitle: s.sample.title ?? null,
    }))
    .sort((a, b) => b.absentAnswers - a.absentAnswers)
    .slice(0, MAX_SOURCE_GAPS);
}

export function buildGapAnalysis(input: {
  brandsByKey: ReadonlyMap<string, readonly string[]>;
  competitors: readonly KnownCompetitor[];
  own: { domain: string; name: string; variants: readonly string[] };
  rows: readonly AnswerRow[];
}): GapAnalysis {
  const { brandsByKey, competitors, own, rows } = input;
  const canon = canonicalizer(competitors);
  const domainStem =
    own.domain.toLowerCase().replace(WWW_PREFIX_RE, "").split(".")[0] ?? "";
  const ownKeys = [own.name, ...own.variants, domainStem]
    .map(compact)
    .filter((k) => k.length >= 2);
  const registered = new Set(competitors.map((c) => compact(c.name)));
  const isOwn = (name: string) => {
    const k = compact(name);
    return k.length > 0 && ownKeys.some((o) => k.includes(o) || o.includes(k));
  };

  const analyzedRows = rows.filter((r) => brandsByKey.has(r.key));
  const board: Named = new Map();
  const byPrompt = new Map<string, PromptAgg>();
  const sources = new Map<string, SourceAgg>();
  let ownAnswers = 0;

  for (const row of analyzedRows) {
    const others = new Map<string, string>();
    let namedOurs = false;
    for (const raw of brandsByKey.get(row.key) ?? []) {
      if (isOwn(raw)) {
        namedOurs = true;
        continue;
      }
      const name = canon(raw);
      others.set(compact(name), name);
    }
    const oursPresent = row.brandMentioned || namedOurs;
    ownAnswers += oursPresent ? 1 : 0;
    const prompt = byPrompt.get(row.promptText) ?? {
      answers: 0,
      oursPresent: 0,
      others: new Map(),
    };
    prompt.answers += 1;
    prompt.oursPresent += oursPresent ? 1 : 0;
    for (const [k, display] of others) {
      bump(board, k, display);
      bump(prompt.others, k, display);
    }
    byPrompt.set(row.promptText, prompt);
    addSources(sources, row, oursPresent, others);
  }

  return {
    analyzed: analyzedRows.length,
    total: rows.length,
    ownAnswers,
    brandBoard: [...board.entries()]
      .map(([k, v]) => ({
        name: v.display,
        answers: v.answers,
        isRegistered: registered.has(k),
      }))
      .sort((a, b) => b.answers - a.answers)
      .slice(0, MAX_BOARD),
    questionGaps: questionGapsOf(byPrompt),
    sourceGaps: sourceGapsOf(
      sources,
      own.domain,
      competitors.map((c) => c.name)
    ),
  };
}
