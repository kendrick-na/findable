// 15곳 질문 생성 재현 진단(2026-10-18)의 익명 고정 입력 — 개수·유형·확신 여부만(질문 문장·회사명·도메인 없음).
// 원본: 동기측정 결과/생성재현진단_원본.json 의 round·guard 단계. 같은 입력이라도 생성기는 비결정적이라 시험은 재시도 규칙으로 읽는다.
export interface GapFixtureRound {
  brandNamed: number;
  brandUnnamed: number;
  category: number;
  concern: number;
  confident: boolean;
  hasCategoryPhrase: boolean;
}
export interface GapFixture {
  before: number;
  id: string;
  industry: string;
  rounds: GapFixtureRound[];
  scope: string;
  thin: boolean;
}
export const GAP_FIXTURES_15: GapFixture[] = [
  {
    id: "E-09",
    industry: "other",
    scope: "both",
    thin: false,
    before: 0,
    rounds: [
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 7,
        brandUnnamed: 2,
        hasCategoryPhrase: true,
      },
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 3,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "S-01",
    industry: "other",
    scope: "korea",
    thin: false,
    before: 0,
    rounds: [
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 6,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "I-05",
    industry: "other",
    scope: "both",
    thin: true,
    before: 0,
    rounds: [
      {
        confident: false,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "A-20",
    industry: "b2b_saas",
    scope: "both",
    thin: true,
    before: 4,
    rounds: [
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 9,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "E-11",
    industry: "b2b_saas",
    scope: "both",
    thin: false,
    before: 4,
    rounds: [
      {
        confident: false,
        category: 23,
        concern: 10,
        brandNamed: 9,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "I-07",
    industry: "healthcare",
    scope: "korea",
    thin: false,
    before: 4,
    rounds: [
      {
        confident: false,
        category: 17,
        concern: 7,
        brandNamed: 6,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "I-17",
    industry: "b2b_saas",
    scope: "both",
    thin: true,
    before: 4,
    rounds: [
      {
        confident: false,
        category: 23,
        concern: 10,
        brandNamed: 9,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "A-15",
    industry: "retail",
    scope: "both",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "A-21",
    industry: "b2b_saas",
    scope: "korea",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
      },
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "A-25",
    industry: "healthcare",
    scope: "korea",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 5,
        brandUnnamed: 1,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "A-26",
    industry: "b2b_saas",
    scope: "both",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "A-29",
    industry: "healthcare",
    scope: "korea",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "I-04",
    industry: "b2b_saas",
    scope: "both",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
      {
        confident: true,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "I-37",
    industry: "content_ip",
    scope: "both",
    thin: true,
    before: 6,
    rounds: [
      {
        confident: false,
        category: 23,
        concern: 10,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
      },
    ],
  },
  {
    id: "O-09",
    industry: "content_ip",
    scope: "korea",
    thin: false,
    before: 6,
    rounds: [
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
      },
      {
        confident: true,
        category: 17,
        concern: 7,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
      },
    ],
  },
];
