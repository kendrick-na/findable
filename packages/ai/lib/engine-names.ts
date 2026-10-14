/**
 * AI 엔진 이름 사전 — 질문 속 엔진명을 찾는 순수 모듈(2026-10-14 · 질문 생성기 품질 수정).
 *
 * 왜: 질문 생성 모델이 "지메인이나 클로드 같은 AI 모델에서…"처럼 엔진 이름을 오표기해 질문에 넣은 사례가 있다.
 * AI 엔진에게 "AI 모델에서 …"를 묻는 질문은 측정 의미가 없다(소비자도 그렇게 묻지 않는다) → **엔진명이 나온 질문은 버린다.**
 * 이 파일은 아무것도 import 하지 않는다(question-plan.ts 와 같은 규칙).
 */

/** 표준 표기 → 영문(소문자·붙여 쓴 형태)·한글 표기. 질문에 나오면 버리는 이름들. */
export const ENGINE_NAME_CANONICAL: Record<string, readonly string[]> = {
  ChatGPT: [
    "chatgpt",
    "gpt",
    "챗gpt",
    "챗지피티",
    "지피티",
    "오픈ai",
    "openai",
  ],
  Claude: ["claude", "클로드"],
  Gemini: ["gemini", "제미나이", "구글제미나이"],
  Perplexity: ["perplexity", "퍼플렉시티"],
  Copilot: ["copilot", "코파일럿"],
  Grok: ["grok", "그록"],
  DeepSeek: ["deepseek", "딥시크"],
  HyperCLOVA: ["hyperclova", "하이퍼클로바", "클로바"],
  네이버: ["naver", "네이버"],
  다음: ["daum", "다음검색"],
};

/** 알려진 오표기(생성 모델이 실제로 낸 것 포함). */
export const ENGINE_NAME_TYPOS: readonly string[] = [
  "지메인",
  "지매니",
  "제미니",
  "제메나이",
  "제미나",
  "챗지티",
  "챗쥐피티",
  "퍼플렉시",
  "퍼프렉시티",
  "클라우드ai",
];

const HAS_HANGUL_RE = /[가-힣]/;
const NON_HANGUL_SPLIT_RE = /[^가-힣]+/;
const NON_IDENTITY_RE = /[^a-z0-9가-힣]/g;
const HANGUL_BASE = 0xac_00;
const HANGUL_LAST = 0xd7_a3;
const FINALS = 28;
const MEDIALS = 21;
const MIN_FUZZY_LENGTH = 3;

const compact = (value: string) =>
  value.toLowerCase().replace(NON_IDENTITY_RE, "");

/** 한글 음절을 초성·중성·종성 낱자로 풀어 편집거리를 자모 단위로 잰다(지메인 ↔ 제미니 같은 철자 오류 포착). */
function jamo(value: string): string[] {
  const out: string[] = [];
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const index = code - HANGUL_BASE;
      out.push(
        `c${Math.floor(index / (MEDIALS * FINALS))}`,
        `v${Math.floor((index % (MEDIALS * FINALS)) / FINALS)}`
      );
      if (index % FINALS !== 0) {
        out.push(`f${index % FINALS}`);
      }
    } else {
      out.push(ch);
    }
  }
  return out;
}

function distance(a: string[], b: string[]): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return row[b.length] as number;
}

const HANGUL_ENGINE_FORMS = Object.values(ENGINE_NAME_CANONICAL)
  .flat()
  .filter((form) => HAS_HANGUL_RE.test(form));
const ALL_FORMS = Object.values(ENGINE_NAME_CANONICAL)
  .flat()
  .map(compact)
  .filter((form) => form.length >= MIN_FUZZY_LENGTH);
const TYPO_FORMS = ENGINE_NAME_TYPOS.map(compact);

/**
 * 질문에서 AI 엔진 이름(오표기 포함)을 찾는다. 없으면 null, 있으면 찾은 말.
 * 한글은 조사가 붙으므로("지메인이나") 토큰 앞부분을 사전과 자모 편집거리 1까지 비교한다.
 */
export function findEngineName(text: string): string | null {
  const key = compact(text);
  for (const form of [...ALL_FORMS, ...TYPO_FORMS]) {
    if (key.includes(form)) {
      return form;
    }
  }
  for (const token of text.split(NON_HANGUL_SPLIT_RE)) {
    if (token.length < MIN_FUZZY_LENGTH) {
      continue;
    }
    for (const form of HANGUL_ENGINE_FORMS) {
      const target = jamo(form);
      for (const len of [form.length - 1, form.length, form.length + 1]) {
        if (len < MIN_FUZZY_LENGTH || len > token.length) {
          continue;
        }
        if (distance(jamo(token.slice(0, len)), target) <= 1) {
          return token.slice(0, len);
        }
      }
    }
  }
  return null;
}
