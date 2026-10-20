// 15곳 질문 생성 재현 진단(2026-10-18)의 익명 고정 입력 — 개수·유형·확신 여부·**실제 폐기 사유별 개수**만(질문 문장·회사명·도메인 없음).
// 원본: 동기측정 결과/생성재현진단_원본.json 의 round·guard 단계. 같은 입력이라도 생성기는 비결정적이라 시험은 재시도 규칙·흔들림 변형으로 읽는다.
export interface GapFixtureRound {
  brandNamed: number;
  brandUnnamed: number;
  category: number;
  concern: number;
  confident: boolean;
  /** 진단에서 실제로 나온 폐기 사유별 개수(brand_missing·no_site_evidence·unknown_proper_noun 등). 시험이 같은 유형의 후보를 만들어 폐기되는지 본다. */
  dropped?: Record<string, number>;
  hasCategoryPhrase: boolean;
  representative?: number;
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 7,
        brandUnnamed: 2,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 2,
          no_site_evidence: 4,
          brand_missing: 1,
        },
      },
      {
        confident: true,
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 3,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 5,
          no_site_evidence: 8,
          brand_missing: 2,
        },
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
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 6,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 4,
          no_site_evidence: 6,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          no_site_evidence: 7,
          brand_missing: 9,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 9,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
        dropped: {
          presupposition: 1,
          unknown_proper_noun: 3,
          no_site_evidence: 4,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 9,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 3,
          no_site_evidence: 5,
        },
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
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 6,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
        dropped: {
          no_site_evidence: 6,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 9,
        brandUnnamed: 0,
        hasCategoryPhrase: true,
        dropped: {
          no_site_evidence: 5,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          no_site_evidence: 5,
          brand_missing: 9,
        },
      },
      {
        confident: true,
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          no_site_evidence: 8,
          brand_missing: 17,
          duplicate: 1,
          presupposition: 1,
        },
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
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 1,
          brand_missing: 6,
        },
      },
      {
        confident: true,
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 2,
          brand_missing: 12,
          presupposition: 1,
          no_site_evidence: 1,
        },
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
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 5,
        brandUnnamed: 1,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 1,
          presupposition: 2,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 3,
          no_site_evidence: 3,
          brand_missing: 8,
        },
      },
      {
        confident: true,
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 4,
          no_site_evidence: 6,
          brand_missing: 16,
        },
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
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
        dropped: {
          brand_missing: 6,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          engine_name: 1,
          no_site_evidence: 4,
          brand_missing: 9,
        },
      },
      {
        confident: true,
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          engine_name: 1,
          no_site_evidence: 7,
          brand_missing: 15,
          unknown_proper_noun: 4,
        },
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
        category: 14,
        concern: 10,
        representative: 9,
        brandNamed: 0,
        brandUnnamed: 9,
        hasCategoryPhrase: true,
        dropped: {
          unknown_proper_noun: 1,
          presupposition: 1,
          no_site_evidence: 4,
          brand_missing: 9,
        },
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
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
        dropped: {
          brand_missing: 6,
        },
      },
      {
        confident: true,
        category: 11,
        concern: 7,
        representative: 6,
        brandNamed: 0,
        brandUnnamed: 6,
        hasCategoryPhrase: true,
        dropped: {
          brand_missing: 12,
          presupposition: 2,
        },
      },
    ],
  },
];
