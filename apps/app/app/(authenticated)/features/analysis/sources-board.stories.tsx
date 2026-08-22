import type { Meta, StoryObj } from "@storybook/react";
import { SourcesBoard } from "./sources-board";

/**
 * 「AI별 등장 · 출처」 권역 분리 — 2026-08-17 세션N-38 (P1-G).
 *
 * ⚠️ 숫자는 **DB 실측**이다(지어내지 않는다). `Tracking` 전수 집계 2026-08-17:
 *
 *     claude     13응답 13등장   1인용
 *     chatgpt    13응답 13등장  33인용   ← v4 문서가 "인용 못 냄"이라 적었으나 **틀렸다**
 *     hyperclova 11응답 11등장   0인용   ← 🔴 어댑터가 `[]` 하드코딩 = 구조적 0
 *     daum       11응답  6등장 143인용
 *     naver      10응답 10등장  80인용
 *     gemini      9응답  9등장   5인용
 *     perplexity  8응답  8등장   0인용   ← 낼 수 있는데 이번엔 0 (hyperclova 와 뜻이 다르다)
 *
 * 🔴 이 스토리가 **눈으로 확인할 것**:
 *   ① 한국 시장이 **위**에 온다(우리만 재는 축을 아래로 밀지 않는다)
 *   ② hyperclova 는 `인용 0` 이 아니라 **「출처를 밝히지 않는 AI」**
 *   ③ perplexity 는 같은 0 인데 **`인용 0` 그대로**(이유가 다르므로 말도 달라야 한다)
 *   ④ `네이버 AI 브리핑` 이 슬러그(`naver-briefing`)가 아닌 한국어로 나온다
 */
const meta = {
  component: SourcesBoard,
  parameters: { layout: "padded" },
  title: "대시보드/출처 · AI별(권역 분리)",
} satisfies Meta<typeof SourcesBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

const measuredAt = new Date("2026-08-17T03:00:00Z");

/** 실측 분포 그대로. 한국 3 + 글로벌 4. */
const REAL_ENGINES = [
  { engineId: "chatgpt", mentioned: 13, total: 13, citations: 33 },
  { engineId: "claude", mentioned: 13, total: 13, citations: 1 },
  { engineId: "gemini", mentioned: 9, total: 9, citations: 5 },
  { engineId: "perplexity", mentioned: 8, total: 8, citations: 0 },
  { engineId: "hyperclova", mentioned: 11, total: 11, citations: 0 },
  { engineId: "naver", mentioned: 10, total: 10, citations: 80 },
  { engineId: "daum", mentioned: 6, total: 11, citations: 143 },
];

const baseData = {
  brandDomain: "sulwhasoo.com",
  brandName: "설화수",
  domains: [
    {
      domain: "blog.naver.com",
      citations: 41,
      engines: ["daum", "naver"],
      kind: "community" as const,
      owned: false,
      sampleUrl: "https://blog.naver.com/example",
    },
    {
      domain: "sulwhasoo.com",
      citations: 12,
      engines: ["chatgpt", "naver"],
      kind: "owned" as const,
      owned: true,
      sampleUrl: "https://www.sulwhasoo.com/kr/ko/main.html",
    },
    {
      domain: "namu.wiki",
      citations: 7,
      engines: ["daum"],
      kind: "reference" as const,
      owned: false,
      sampleUrl: "https://namu.wiki/w/설화수",
    },
  ],
  filteredCitations: 0,
  kinds: [
    { kind: "community" as const, citations: 41, share: 68 },
    { kind: "owned" as const, citations: 12, share: 20 },
    { kind: "reference" as const, citations: 7, share: 12 },
  ],
  measuredAt,
  mentionRate: { mentioned: 70, total: 75 },
  ownedCitations: { owned: 12, total: 60 },
};

/** ⭐ 기본 — 한국·글로벌 두 권역이 모두 있는 정상 상태. */
export const 권역_둘다: Story = {
  args: { data: { ...baseData, engines: REAL_ENGINES } },
};

/**
 * 🔴 글로벌 엔진만 측정된 경우 — **한국 섹션이 통째로 사라져야 한다.**
 * 빈 권역에 `0%` 를 찍으면 "못 잰 것"이 "0점"으로 읽힌다(apple.com 사고 유형).
 */
export const 글로벌만: Story = {
  args: {
    data: {
      ...baseData,
      engines: REAL_ENGINES.filter((e) =>
        ["chatgpt", "claude", "gemini", "perplexity"].includes(e.engineId)
      ),
    },
  },
};

/**
 * 네이버 AI 브리핑이 포함된 경우 — 이름표가 슬러그로 새지 않는지 본다.
 * (브리핑은 on-demand 라 본류 측정엔 없지만, 돌린 회차에는 이 행이 생긴다.)
 */
export const 브리핑_포함: Story = {
  args: {
    data: {
      ...baseData,
      engines: [
        ...REAL_ENGINES,
        {
          engineId: "naver-briefing",
          mentioned: 1,
          total: 1,
          citations: 6,
        },
      ],
    },
  },
};
