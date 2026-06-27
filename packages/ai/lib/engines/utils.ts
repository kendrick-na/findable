// 엔진 응답 분석 유틸 — 브랜드 언급 추출, 인용 출처 파싱

import type { CitedSource } from "./types";

/**
 * 답변 텍스트에서 브랜드명·변형 표기를 모두 검색해
 * 첫 등장 위치(0-based char index)와 mention 여부 반환.
 */
export function detectBrandMention(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): { mentioned: boolean; firstIndex: number | null } {
  if (!brandName) {
    return { mentioned: false, firstIndex: null };
  }
  const candidates = [brandName, ...brandVariants]
    .filter(Boolean)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  let firstIndex: number | null = null;
  const lowered = text.toLowerCase();
  for (const candidate of candidates) {
    const idx = lowered.indexOf(candidate.toLowerCase());
    if (idx !== -1 && (firstIndex === null || idx < firstIndex)) {
      firstIndex = idx;
    }
  }
  return { mentioned: firstIndex !== null, firstIndex };
}

/**
 * 글머리 기호·번호 매겨진 답변에서 브랜드의 순위 추정.
 *
 * 우선순위 (높→낮):
 *   1. 마크다운 강조(**브랜드**)된 번호 줄 — "1. **브랜드**"
 *   2. 평문 번호 줄 — "1. 브랜드 ..." 또는 "1) 브랜드 ..."
 *   3. 카테고리형 답변(브랜드가 헤더이고 경쟁사를 나열) — 브랜드 첫 등장 위치 기반 추정
 *   4. 그 외 — null
 */
export function estimateMentionPosition(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): number | null {
  if (!brandName) return null;
  const candidates = [brandName, ...brandVariants]
    .filter(Boolean)
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 2);
  if (candidates.length === 0) return null;

  const lowered = text.toLowerCase();

  // 1) 번호 매겨진 줄에서 브랜드 매칭 — 마크다운 강조 포함
  //    "1. **브랜드**" "1) 브랜드" "**1. 브랜드**" 등 다양한 패턴
  const numberedPattern = /(?:^|\n)\s*(?:\*{0,2})\s*(\d{1,2})[\.\)]\s*(?:\*{0,2})\s*([^\n]+)/g;
  const matches = [...text.matchAll(numberedPattern)];
  for (const m of matches) {
    const rank = Number.parseInt(m[1], 10);
    const lineLower = m[2].toLowerCase();
    if (candidates.some((c) => lineLower.includes(c))) {
      return rank;
    }
  }

  // 2) 카테고리형 답변 fallback — 브랜드가 헤더(타이틀/굵게)로 등장 + 번호 줄엔 경쟁사
  //    이 경우 브랜드를 1순위(쿼리 대상)로 가정
  //    조건: 텍스트 앞 30% 안에 브랜드가 등장 + 번호 줄이 3개 이상
  const firstMentionIdx = candidates
    .map((c) => lowered.indexOf(c))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];
  if (firstMentionIdx !== undefined && firstMentionIdx < text.length * 0.3 && matches.length >= 3) {
    return 1;
  }

  return null;
}

/**
 * URL 추출 + 도메인 정규화. 인용 출처 분석에 사용.
 */
export function extractCitedSources(text: string): CitedSource[] {
  const urlPattern = /https?:\/\/[^\s\)\]\}]+/g;
  const matches = text.match(urlPattern) ?? [];
  const seen = new Set<string>();
  const sources: CitedSource[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const parsed = new URL(url);
      sources.push({ url, domain: parsed.hostname });
    } catch {
      // skip invalid URL
    }
  }
  return sources;
}

/**
 * 휴리스틱 sentiment. v1.0은 키워드 기반, v1.5에서 CrewAI '수진' 에이전트가 정밀 분석.
 */
export function estimateSentiment(
  text: string,
  brandName: string | undefined
): "positive" | "neutral" | "negative" | null {
  if (!brandName || !text) return null;
  const lowered = text.toLowerCase();
  const idx = lowered.indexOf(brandName.toLowerCase());
  if (idx === -1) return null;
  // 브랜드 언급 주변 ±100자 추출
  const window = lowered.slice(Math.max(0, idx - 100), idx + brandName.length + 100);

  const positive = ["best", "great", "excellent", "top", "leader", "popular", "love", "recommend", "최고", "추천", "인기", "좋", "1위", "최상"];
  const negative = ["worst", "bad", "avoid", "poor", "disappoint", "outdated", "최악", "별로", "비추", "실망", "단점"];

  let score = 0;
  for (const k of positive) if (window.includes(k)) score++;
  for (const k of negative) if (window.includes(k)) score--;

  if (score >= 2) return "positive";
  if (score <= -2) return "negative";
  return "neutral";
}

/**
 * 응답 안에서 브랜드의 점유율 추정.
 * 동일 카테고리 내 다른 브랜드 언급 횟수 대비 비율.
 * v1.0 단순 휴리스틱. 정밀 측정은 CrewAI Alex 에이전트.
 */
export function estimateShareOfVoice(
  text: string,
  brandName: string | undefined,
  brandVariants: string[] = []
): number | null {
  if (!brandName) return null;
  const lowered = text.toLowerCase();
  const candidates = [brandName, ...brandVariants]
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  let brandHits = 0;
  for (const c of candidates) {
    const re = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    brandHits += (lowered.match(re) ?? []).length;
  }
  if (brandHits === 0) return 0;

  // 대문자로 시작하는 토큰을 brand-like 후보로 카운트 (단순 추정)
  const titleCaseTokens = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const totalCandidates = Math.max(brandHits, titleCaseTokens.length);
  return Math.min(1, brandHits / Math.max(totalCandidates, 1));
}
