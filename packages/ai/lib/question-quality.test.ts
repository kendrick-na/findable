/**
 * 질문 생성기 품질 수정(2026-10-14) — 운영에서 실제로 나온 이상한 질문 6건의 재현 + 가드·틀·재생성 테스트.
 * 건드리지 않는 것(기본 질문 폴백)이 그대로인지도 고정한다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ({ generateObject: h.generateObject }));
vi.mock("./models", () => ({ models: { chat: "stub-model" } }));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "stub",
  letsurModelWithFallback: () => null,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { suggestTrackingPrompts } from "./prompt-suggestions";
import {
  answerKindOf,
  composeQuestions,
  defaultConsumerQuestions,
  fixedAlternativeQuestions,
  guardQuestions,
  INDUSTRY_FRAMES,
  INDUSTRY_QUESTION_LABEL,
  industryFrame,
  type PlanGuardContext,
  type PlanQuestion,
  vetCategoryPhrase,
} from "./question-plan";

const q = (
  type: PlanQuestion["type"],
  text: string,
  extra: Partial<PlanQuestion> = {}
): PlanQuestion => ({ language: "ko", text, type, ...extra });

// ── 사례 ①②③: Findable 자사(B2B SaaS · 국내 · 별칭 Findable·파인더블 · 경쟁사 없음) ──
const findable: PlanGuardContext = {
  brandNames: ["Findable", "파인더블", "findable"],
  competitors: [],
  industry: "b2b_saas",
  requireBasis: true,
  siteText:
    "Findable AI 검색 모니터링 GEO 플랫폼 한국 기업 브랜드가 AI 답변에 인용되는지 진단",
};

// ── 사례 ④⑤: 뷰티 영업 3곳 ──
const numbuzin: PlanGuardContext = {
  brandNames: ["넘버즈인", "numbuzin"],
  competitors: [],
  industry: "beauty",
  requireBasis: true,
  siteText: "넘버즈인 스킨케어 브랜드 공식 사이트 세럼 토너 크림",
};
const franz: PlanGuardContext = {
  brandNames: ["프란츠", "franz"],
  competitors: [],
  industry: "beauty",
  requireBasis: true,
  siteText: "프란츠 스킨케어 민감성 피부 크림",
};

const reasonOf = (item: PlanQuestion, ctx: PlanGuardContext) =>
  guardQuestions([item], ctx).dropped[0]?.reason ?? null;

describe("사례 6건 재현 — 가드가 버린다", () => {
  it("① '지메인이나 클로드…' 엔진명 오표기 → engine_name", () => {
    expect(
      reasonOf(
        q(
          "category",
          "지메인이나 클로드 같은 다양한 AI 모델에서 AI 검색 모니터링 도구가 나와?",
          {
            basis: "industry",
          }
        ),
        findable
      )
    ).toBe("engine_name");
  });

  it("② '센드버드나 인터콤 같은 …' 입력에 없는 서비스명 → unknown_proper_noun", () => {
    expect(
      reasonOf(
        q(
          "alternative",
          "센드버드나 인터콤 같은 고객 관리 도구들과 달리 AI 검색 모니터링에 특화된 게 있나?",
          { basis: "industry" }
        ),
        findable
      )
    ).toBe("unknown_proper_noun");
  });

  it("③ B2B SaaS 에 'Findable은 어디서 사는 거야?' → industry_banned", () => {
    expect(
      reasonOf(
        q("brand", "Findable은 어디서 사는 거야?", { basis: "brand" }),
        findable
      )
    ).toBe("industry_banned");
  });

  it("④ 브랜드 이름 뜻을 풀어 만든 '번호 매긴 스킨케어 제품 뭐가 좋아?' → 근거(site) 없는 대표 상품", () => {
    expect(
      reasonOf(
        q("representative", "번호 매긴 스킨케어 제품 뭐가 좋아?", {
          basis: "industry",
        }),
        numbuzin
      )
    ).toBe("no_basis");
    // 근거를 밝히지 않아도(제안 경로는 requireBasis) 버린다.
    expect(
      reasonOf(
        q("representative", "번호 매긴 스킨케어 제품 뭐가 좋아?"),
        numbuzin
      )
    ).toBe("no_basis");
  });

  it("⑤ '서울대 연구진 제품 있다고 했는데 뭐 있어?' 전제를 깐 문장 → presupposition", () => {
    expect(
      reasonOf(
        q("representative", "서울대 연구진 제품 있다고 했는데 뭐 있어?", {
          basis: "site",
        }),
        franz
      )
    ).toBe("presupposition");
  });

  it("⑤-2 '~만들었다는' 변형 전제도 막는다(실제 재생성에서 새던 것)", () => {
    expect(
      reasonOf(
        q(
          "representative",
          "서울대 연구진이 만들었다는 스킨케어 제품 뭐가 있어?",
          { basis: "site" }
        ),
        franz
      )
    ).toBe("presupposition");
  });

  it("⑤-3 재생성에서 새던 변형: '~하던데', '~좋대', '~고들 하던데'", () => {
    for (const text of [
      "요즘 AI 검색이 우리 마케팅에 영향을 미친다고들 하던데 정말?",
      "줄기세포 배양액 토너 효과가 좋대, 써본 사람 있어?",
      "이 크림이 인기라 하던데 어때?",
      "온라인몰 1위라고 한 아기 피부 제품 뭐야?",
    ]) {
      expect(
        reasonOf(q("category", text, { basis: "industry" }), franz),
        text
      ).toBe("presupposition");
    }
  });

  it("④-2 모델이 '이름 뜻에서 나왔다'고 밝힌 질문은 버린다(근거 검사를 통과하던 '번호 매긴 스킨케어 시스템')", () => {
    expect(
      reasonOf(
        q("category", "번호 매긴 스킨케어 시스템 어때?", {
          basis: "site",
          fromName: true,
        }),
        numbuzin
      )
    ).toBe("name_meaning");
  });

  it("⑥ '지메인' 류 철자 오류 단독 → engine_name", () => {
    expect(
      reasonOf(
        q("category", "지메인에서 추천하는 크림 뭐야?", { basis: "industry" }),
        franz
      )
    ).toBe("engine_name");
  });
});

describe("정상 질문은 통과한다(거짓 양성 점검)", () => {
  it("B2B 질문 틀: 도입·비교·가격·연동·보안·후기", () => {
    const r = guardQuestions(
      [
        q("category", "AI 검색 모니터링 도구 도입할 때 뭘 비교해야 해?", {
          basis: "industry",
        }),
        q("concern", "우리 회사가 AI 답변에 안 나오는데 어떻게 해?", {
          basis: "industry",
        }),
        q("category", "GEO 진단 서비스 가격은 보통 어때?", {
          basis: "industry",
        }),
        q("brand", "Findable은 어떤 서비스야?", { basis: "brand" }),
        q("brand", "파인더블 다른 도구랑 연동돼?", { basis: "brand" }),
        q("brand", "Findable 써 본 사람 후기 어때?", { basis: "brand" }),
      ],
      findable
    );
    expect(r.dropped).toEqual([]);
  });

  it("소비재 틀은 구매처 질문이 정상이다", () => {
    expect(
      guardQuestions(
        [q("brand", "프란츠 어디서 사?", { basis: "brand" })],
        franz
      ).dropped
    ).toEqual([]);
  });

  it("영어 질문: 문장 중간의 입력에 없는 대문자 이름만 막는다", () => {
    expect(
      reasonOf(
        {
          language: "en",
          type: "category",
          text: "Is there a tool like Intercom for AI search?",
          basis: "industry",
        },
        findable
      )
    ).toBe("unknown_proper_noun");
    expect(
      reasonOf(
        {
          language: "en",
          type: "category",
          text: "What should I look for when choosing B2B software?",
          basis: "industry",
        },
        findable
      )
    ).toBeNull();
  });

  it("등록 경쟁사 이름은 쓸 수 있다", () => {
    expect(
      reasonOf(
        q("alternative", "라운드랩 대신 쓸 만한 곳", { basis: "competitor" }),
        { ...franz, competitors: ["라운드랩"] }
      )
    ).toBeNull();
  });
});

describe("업종 틀 표 — 업종 enum 전체", () => {
  it("모든 업종에 틀(질문하는 사람·궁금한 것·예시·대안 문형)이 있다", () => {
    for (const key of Object.keys(INDUSTRY_QUESTION_LABEL)) {
      const frame = INDUSTRY_FRAMES[key];
      expect(frame, key).toBeDefined();
      expect(frame?.brandExamples.length, key).toBeGreaterThan(0);
      expect(frame?.alternativeForms.ko.length, key).toBeGreaterThanOrEqual(2);
      expect(frame?.alternativeForms.en.length, key).toBeGreaterThanOrEqual(2);
    }
  });

  it("업종 밖(other·미선택)은 구매를 전제하지 않는 중립 틀", () => {
    expect(industryFrame("other").banned.length).toBeGreaterThan(0);
    expect(industryFrame(null).brandExamples.join()).not.toContain("어디서 사");
  });

  it("구매처 질문 금지: 소비재·콘텐츠 외 업종", () => {
    const banned = (k: string) =>
      industryFrame(k).banned.some((re) =>
        re.test("{브랜드} 어디서 사?".replace("{브랜드}", "회사"))
      );
    for (const k of [
      "b2b_saas",
      "manufacturing",
      "finance",
      "healthcare",
      "education",
    ]) {
      expect(banned(k), k).toBe(true);
    }
    for (const k of ["beauty", "fashion", "food", "retail", "content_ip"]) {
      expect(banned(k), k).toBe(false);
    }
  });
});

describe("경쟁사가 없을 때 대안 질문은 고정 문형", () => {
  it("모델이 쓰지 않고 업종 분야 이름으로 만든다", () => {
    const alt = fixedAlternativeQuestions("b2b_saas", "korea");
    expect(alt).toHaveLength(2);
    expect(
      alt.every((x) => x.type === "alternative" && x.language === "ko")
    ).toBe(true);
    expect(alt[0]?.text).toContain("B2B 소프트웨어");
  });

  it("고정 문장은 업종에 맞는 자연스러운 말이다(금융에 '도입', 뷰티에 '화장품·뷰티 비슷한 곳' 금지)", () => {
    const all = (k: string) =>
      fixedAlternativeQuestions(k, "both")
        .map((x) => x.text)
        .join(" | ");
    expect(all("finance")).not.toContain("도입");
    expect(all("beauty")).not.toContain("화장품·뷰티");
    expect(all("b2b_saas")).toContain("도입");
    for (const k of Object.keys(INDUSTRY_QUESTION_LABEL)) {
      expect(all(k), k).not.toContain("{분야}");
    }
  });

  it("분야를 모르면 만들지 않는다(지어내지 않는다)", () => {
    expect(fixedAlternativeQuestions("other", "korea")).toEqual([]);
    expect(fixedAlternativeQuestions(null, "korea")).toEqual([]);
  });

  it("해외·둘 다 시장은 영어 문형을 섞는다", () => {
    expect(
      fixedAlternativeQuestions("beauty", "global").every(
        (x) => x.language === "en"
      )
    ).toBe(true);
    const both = fixedAlternativeQuestions("beauty", "both");
    expect(both.map((x) => x.language).sort()).toEqual(["en", "ko"]);
  });
});

// ── 통합: 모델 응답을 흉내 낸다 ────────────────────────────────────────────
const item = (text: string, basis?: string) => ({
  language: "ko",
  text,
  basis,
});
const findableInput = {
  aliases: ["파인더블"],
  brandName: "Findable",
  competitors: [],
  domain: "findable.co.kr",
  industry: "b2b_saas",
  marketScope: "korea" as const,
  site: {
    description: "AI 검색 가시성 진단 · 모니터링 GEO 플랫폼",
    h1: null,
    siteName: "Findable",
    title: "Findable | AI 검색 모니터링",
  },
};
const good = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) =>
    item(`${prefix} ${i} 추천해줘`, "industry")
  );
const llm = (over: Record<string, unknown> = {}) => ({
  object: {
    category: [
      item("지메인이나 클로드 같은 다양한 AI 모델에서 나와?", "industry"),
      ...good(11, "모니터링 도구"),
    ],
    concern: good(7, "고민"),
    representative: [
      item("AI 검색 모니터링 뭐가 좋아?", "site"),
      item("GEO 진단 서비스 알려줘", "site"),
      item("GEO 플랫폼 뭐 있어?", "site"),
    ],
    alternative: [
      item("센드버드나 인터콤 같은 도구와 달리 특화된 게 있나?", "industry"),
    ],
    brandUnderstanding: [
      item("Findable은 어디서 사는 거야?", "brand"),
      item("Findable은 어떤 서비스야?", "brand"),
      item("Findable 가격은 어때?", "brand"),
      item("파인더블 후기 어때?", "brand"),
    ],
    confident: true,
    ...over,
  },
});

beforeEach(() => h.generateObject.mockReset());

describe("suggestTrackingPrompts — 사고 사례가 최종 후보에 없다", () => {
  it("나쁜 3건은 빠지고, 대안 질문은 고정 문형으로 채워진다", async () => {
    h.generateObject.mockResolvedValue(llm());
    const { prompts } = await suggestTrackingPrompts(findableInput);
    const texts = prompts.map((p) => p.text);
    expect(texts.join("\n")).not.toMatch(/지메인|센드버드|인터콤|어디서 사/);
    expect(texts).toContain("Findable은 어떤 서비스야?");
    const alt = prompts.filter((p) => p.type === "alternative");
    expect(alt).toHaveLength(2);
    expect(alt[0]?.text).toContain("B2B 소프트웨어");
    expect(h.generateObject).toHaveBeenCalledTimes(1);
  });

  it("프롬프트에 업종 틀이 실리고 사고 원인 문구(어디서 사?)가 B2B 에는 없다", async () => {
    h.generateObject.mockResolvedValue(llm());
    await suggestTrackingPrompts(findableInput);
    const prompt: string = h.generateObject.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("서비스 도입을 검토하는 담당자");
    expect(prompt).toContain("도입·비교·가격·연동·보안·후기");
    expect(prompt).not.toContain("어디서 사?");
    expect(prompt).toContain("AI 서비스·모델 이름");
    expect(prompt).toContain("들은 이야기를 전제로");
    expect(prompt).toContain("경쟁사가 없으면 빈 배열");
  });

  it("질문이 모자라면 한 번 더 만들어 합친다(추가 호출 1회, 그 이상은 없다)", async () => {
    const thin = llm({
      category: good(3, "도구"),
      concern: good(1, "고민"),
      representative: [],
      brandUnderstanding: [item("Findable은 어떤 서비스야?", "brand")],
    });
    const more = llm({
      category: good(8, "추가 도구"),
      concern: good(4, "추가 고민"),
      representative: [item("AI 검색 모니터링 뭐가 좋아?", "site")],
      alternative: [],
      brandUnderstanding: [item("Findable 가격은 어때?", "brand")],
    });
    h.generateObject.mockResolvedValueOnce(thin).mockResolvedValueOnce(more);
    const { prompts } = await suggestTrackingPrompts(findableInput);
    expect(h.generateObject).toHaveBeenCalledTimes(2);
    expect(prompts.length).toBeGreaterThan(thin.object.category.length + 4);
  });

  it("충분하면 재생성하지 않는다(원가 보호)", async () => {
    h.generateObject.mockResolvedValue(llm());
    await suggestTrackingPrompts(findableInput);
    expect(h.generateObject).toHaveBeenCalledTimes(1);
  });
});

describe("사이트 재료 — 소제목·FAQ·본문이 질문 재료가 된다", () => {
  it("프롬프트에 소제목·FAQ·구조화 정보·본문 첫머리가 실리고, 얇은 사이트는 siteThin 으로 알린다", async () => {
    h.generateObject.mockResolvedValue(llm());
    const out = await suggestTrackingPrompts({
      ...findableInput,
      site: {
        ...findableInput.site,
        headings: ["GEO 브랜드 진단", "AI 검색 모니터링"],
        faq: ["GEO 가 뭔가요?"],
        jsonLdFacts: ["AI 검색 최적화 플랫폼"],
        bodySnippet: "브랜드가 AI 답변에 인용되는지 진단합니다",
        thin: true,
      },
    });
    const prompt: string = h.generateObject.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("소제목: GEO 브랜드 진단 · AI 검색 모니터링");
    expect(prompt).toContain("사이트 FAQ: GEO 가 뭔가요?");
    expect(prompt).toContain("구조화 정보: AI 검색 최적화 플랫폼");
    expect(prompt).toContain(
      "본문 첫머리: 브랜드가 AI 답변에 인용되는지 진단합니다"
    );
    expect(out.siteThin).toBe(true);
  });

  it("소제목에만 있는 말도 대표 상품 질문의 근거가 된다(예전엔 제목 한 줄만 봐서 대표 질문이 줄었다)", async () => {
    h.generateObject.mockResolvedValue(
      llm({ representative: [{ ...item("초유 보습 크림 추천해줘", "site") }] })
    );
    const withHeading = await suggestTrackingPrompts({
      ...findableInput,
      site: { title: "테스트", headings: ["활성 초유 보습 크림"] },
    });
    expect(withHeading.prompts.map((p) => p.text)).toContain(
      "초유 보습 크림 추천해줘"
    );
    h.generateObject.mockResolvedValue(
      llm({ representative: [{ ...item("초유 보습 크림 추천해줘", "site") }] })
    );
    const without = await suggestTrackingPrompts({
      ...findableInput,
      site: { title: "테스트" },
    });
    expect(without.prompts.map((p) => p.text)).not.toContain(
      "초유 보습 크림 추천해줘"
    );
  });
});

describe("건드리지 않는 것 — 기본 질문 폴백", () => {
  it("defaultConsumerQuestions 결과가 그대로다(뷰티·B2B 소프트웨어)", () => {
    const base = {
      englishName: "Findable",
      koreanName: "Findable",
      language: "ko" as const,
    };
    expect(
      defaultConsumerQuestions({ ...base, industry: "b2b_saas" })?.map(
        (d) => d.text
      )
    ).toEqual([
      "B2B 소프트웨어 추천해줘",
      "B2B 소프트웨어 뭐가 좋아?",
      "B2B 소프트웨어 처음 고를 때 뭘 봐야 해?",
      "Findable 후기 어때?",
    ]);
    expect(
      defaultConsumerQuestions({ ...base, industry: "beauty" })
    ).toHaveLength(4);
    expect(defaultConsumerQuestions({ ...base, industry: "other" })).toBeNull();
  });
});

describe("답변 유형 — 브랜드가 나열되는 질문 vs 설명만 하는 질문", () => {
  it("실제 생성물(Findable 자사 · 이름 없는 질문)을 모양으로 가른다", () => {
    const explain = [
      "AI 검색 최적화가 일반 SEO랑 다른 건 뭐야?",
      "GEO 진단이라는 게 정확히 뭐지?",
      "우리 브랜드 관련 정보를 정리하는 단계가 몇 단계나 되나?",
      "AI 검색에서 우리 브랜드가 얼마나 언급되고 있는지 어떻게 측정해?",
    ];
    const listing = [
      "AI 검색 모니터링 툴 추천해줄래?",
      "송금이나 결제 앱 뭐가 좋아?",
      "라운드랩 대신 쓸 만한 곳",
      "GEO 진단 서비스 중에 어떤 게 나아?",
      "What are the best AI visibility tools?",
    ];
    for (const text of explain) {
      expect(answerKindOf(text), text).toBe("explain");
    }
    for (const text of listing) {
      expect(answerKindOf(text), text).toBe("list");
    }
  });

  it("설명형이 많이 섞인 후보 8개 → 나열형이 먼저 채워지고 설명형은 30% 이내", () => {
    const pool = [
      ...[
        "SEO랑 뭐가 달라?",
        "GEO 가 뭐야?",
        "어떻게 측정해?",
        "작동 방식이 뭐야?",
        "단계가 몇 개야?",
      ].map((t) => q("category", t)),
      ...[
        "도구 추천해줘",
        "서비스 뭐가 좋아?",
        "대안 알려줘",
        "비교해 볼 만한 곳 있어?",
        "어떤 서비스가 나아?",
        "툴 추천해줄래?",
        "앱 뭐 써?",
        "플랫폼 추천해줘",
      ].map((t) => q("category", t)),
    ];
    const out = composeQuestions(pool, "korea", { preferListing: true }).filter(
      (x) => x.type === "category"
    );
    expect(out).toHaveLength(8);
    expect(
      out.filter((x) => answerKindOf(x.text) === "explain").length
    ).toBeLessThanOrEqual(2);
    expect(out[0]?.text).toBe("도구 추천해줘");
  });

  it("나열형이 모자라도 설명형으로 채우지 않는다(지어내지 않는다)", () => {
    const pool = [
      q("category", "도구 추천해줘"),
      ...Array.from({ length: 6 }, (_, i) =>
        q("category", `개념 ${i} 이 뭐야?`)
      ),
    ];
    const out = composeQuestions(pool, "korea", { preferListing: true }).filter(
      (x) => x.type === "category"
    );
    expect(out.length).toBeLessThanOrEqual(1 + Math.floor(8 * 0.3));
  });

  it("옵션을 안 켜면 기존 동작 그대로(앞에서부터 목표 개수)", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      q("category", `개념 ${i} 이 뭐야?`)
    );
    expect(
      composeQuestions(pool, "korea").filter((x) => x.type === "category")
    ).toHaveLength(8);
  });
});

describe("대안 고정 문형에 서비스 분야 이름 넣기(2026-10-15 · IR덱 세션 지적)", () => {
  it("분야 이름이 있으면 한국어 대안 문형에 들어간다(업종 라벨 'B2B 소프트웨어'만 쓰던 모호함 해소)", () => {
    const alt = fixedAlternativeQuestions(
      "b2b_saas",
      "korea",
      "AI 검색 가시성 진단 서비스"
    );
    expect(alt.map((a) => a.text)).toEqual([
      "AI 검색 가시성 진단 서비스 중에 비교해 볼 만한 다른 선택지는 뭐가 있어?",
      "AI 검색 가시성 진단 서비스 대신 많이 쓰는 대안 알려줘",
    ]);
  });

  it("분야 이름이 없으면 예전 업종 일반 문형 그대로", () => {
    expect(
      fixedAlternativeQuestions("b2b_saas", "korea", null)[0]?.text
    ).toContain("B2B 소프트웨어");
  });

  it("영어 문형은 분야 이름을 넣지 않는다(한국어 구절이 영어 문장에 섞이지 않게)", () => {
    const en = fixedAlternativeQuestions(
      "beauty",
      "global",
      "신생아용 보습 스킨케어"
    );
    expect(
      en.every((a) => a.language === "en" && !/[가-힣]/.test(a.text))
    ).toBe(true);
  });

  it("vetCategoryPhrase: 정상 분야 이름은 통과, 브랜드·엔진 이름·전제·너무 짧거나 긴 것은 버린다", () => {
    expect(vetCategoryPhrase("AI 검색 가시성 진단 서비스.", findable)).toBe(
      "AI 검색 가시성 진단 서비스"
    );
    expect(vetCategoryPhrase("Findable 같은 진단 서비스", findable)).toBeNull();
    expect(vetCategoryPhrase("ChatGPT 노출 진단 서비스", findable)).toBeNull();
    expect(vetCategoryPhrase("Profound 류의 서비스", findable)).toBeNull(); // 입력에 없는 고유명사
    expect(vetCategoryPhrase("순위 높다고 한 서비스", findable)).toBeNull();
    expect(vetCategoryPhrase("서비스", findable)).toBeNull();
    expect(vetCategoryPhrase("센드버드 서비스", findable)).toBeNull(); // 사이트에 없는 이름만 있는 분야 이름
    expect(vetCategoryPhrase("가".repeat(60), findable)).toBeNull();
    expect(vetCategoryPhrase("", findable)).toBeNull();
  });

  it("통합: 모델이 준 분야 이름이 최종 대안 질문에 들어가고, 오염된 분야 이름은 업종 문형으로 물러난다", async () => {
    h.generateObject.mockResolvedValue(
      llm({ categoryPhrase: "AI 검색 가시성 진단 서비스" })
    );
    const ok = await suggestTrackingPrompts(findableInput);
    expect(
      ok.prompts.filter((p) => p.type === "alternative").map((p) => p.text)[0]
    ).toContain("AI 검색 가시성 진단 서비스");
    h.generateObject.mockResolvedValue(
      llm({ categoryPhrase: "센드버드 같은 서비스" })
    );
    const bad = await suggestTrackingPrompts(findableInput);
    expect(
      bad.prompts.filter((p) => p.type === "alternative").map((p) => p.text)[0]
    ).toContain("B2B 소프트웨어");
  });
});

describe("AI 검색 업종 — 엔진 이름 허용·대표 상품 재시도(2026-10-16)", () => {
  const engineQuestion = q(
    "concern",
    "퍼플렉시티나 네이버 AI에서 경쟁사는 나오는데 우리는 왜 안 나와? 어떤 도구를 써야 해?",
    { basis: "industry" }
  );
  it("기본은 엔진 이름이 든 질문을 버린다", () => {
    expect(reasonOf(engineQuestion, findable)).toBe("engine_name");
  });
  it("allowEngineNames 면 통과한다(다른 가드는 그대로)", () => {
    expect(
      reasonOf(engineQuestion, { ...findable, allowEngineNames: true })
    ).toBeNull();
    // 전제 문장·브랜드 이름 혼입은 여전히 막는다.
    expect(
      reasonOf(q("concern", "챗지피티에서 Findable 어떻게 써야 해?"), {
        ...findable,
        allowEngineNames: true,
      })
    ).toBe("name_in_nameless");
  });

  const longSite = {
    ...findableInput.site,
    bodySnippet:
      "ChatGPT·Perplexity·네이버 AI 답변에서 우리 브랜드가 인용되는지 진단하는 GEO 플랫폼입니다. ".repeat(
        5
      ),
  };
  it("사이트 글에 엔진 이름이 있으면 프롬프트가 엔진 이름을 허용한다", async () => {
    h.generateObject.mockResolvedValue(llm());
    await suggestTrackingPrompts({ ...findableInput, site: longSite });
    const prompt: string = h.generateObject.mock.calls[0]?.[0].prompt;
    expect(prompt).toContain("써도 돼");
    expect(prompt).not.toContain("AI 서비스·모델 이름을 질문에 쓰지 마");
  });
  it("사이트 글이 충분한데 대표 상품이 하나도 안 남으면 한 번 더 만든다", async () => {
    const noRep = llm({ representative: [] });
    h.generateObject.mockResolvedValueOnce(noRep).mockResolvedValueOnce(llm());
    const { prompts } = await suggestTrackingPrompts({
      ...findableInput,
      site: longSite,
    });
    expect(h.generateObject).toHaveBeenCalledTimes(2);
    expect(prompts.some((p) => p.type === "representative")).toBe(true);
  });
  it("사이트 글이 짧으면 대표 상품이 없어도 재시도하지 않는다(헛호출 방지)", async () => {
    h.generateObject.mockResolvedValue(llm({ representative: [] }));
    await suggestTrackingPrompts(findableInput);
    expect(h.generateObject).toHaveBeenCalledTimes(1);
  });
});

describe("대표 상품 근거 — 조사가 붙은 한글 낱말(2026-10-16)", () => {
  const ctx: PlanGuardContext = {
    brandNames: ["넘버즈인", "numbuzin"],
    competitors: [],
    industry: "beauty",
    requireBasis: true,
    siteText:
      "넘버즈인 공식몰 1번 말끔 순삭 클렌징오일 200ml 토너패드 본품 2종 1+1 1번 진정 맑게담은 청초토너 300ml",
  };
  const rep = (text: string) => q("representative", text, { basis: "site" });
  it("사이트에 있는 상품 낱말에 조사가 붙어도 근거로 인정한다", () => {
    expect(
      reasonOf(rep("토너패드는 몇 매 들어있는 게 보통이야?"), ctx)
    ).toBeNull();
    expect(
      reasonOf(rep("클렌징오일로 더블 클렌징할 때 뭐가 좋아?"), ctx)
    ).toBeNull();
  });
  it("사이트에 없는 상품은 여전히 근거 없음", () => {
    expect(reasonOf(rep("선크림은 얼마나 발라야 돼?"), ctx)).toBe(
      "no_site_evidence"
    );
    expect(reasonOf(rep("립밤 뭐가 좋아?"), ctx)).toBe("no_site_evidence");
  });
});

describe("대표 상품 재시도 부작용 방지(2026-10-16)", () => {
  it("대표 상품만 비어 다시 만든 두 번째 응답이 '확신 없음'이어도 첫 결과를 버리지 않는다", async () => {
    const longSite = {
      ...findableInput.site,
      bodySnippet: "AI 검색 모니터링 GEO 진단 플랫폼입니다. ".repeat(20),
    };
    h.generateObject
      .mockResolvedValueOnce(llm({ representative: [] }))
      .mockResolvedValueOnce(
        llm({
          category: [],
          concern: [],
          representative: [],
          brandUnderstanding: [],
          alternative: [],
          confident: false,
        })
      );
    const { prompts } = await suggestTrackingPrompts({
      ...findableInput,
      site: longSite,
    });
    expect(h.generateObject).toHaveBeenCalledTimes(2);
    expect(prompts.length).toBeGreaterThanOrEqual(14);
  });
});
