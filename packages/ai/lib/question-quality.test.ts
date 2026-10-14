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
  defaultConsumerQuestions,
  fixedAlternativeQuestions,
  guardQuestions,
  INDUSTRY_FRAMES,
  INDUSTRY_QUESTION_LABEL,
  industryFrame,
  type PlanGuardContext,
  type PlanQuestion,
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
    description: "AI 검색 모니터링 GEO 플랫폼",
    h1: null,
    siteName: "Findable",
    title: "Findable | AI 검색 모니터링",
  },
};
const good = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) =>
    item(`${prefix} 도입 질문 ${i} 알려줘`, "industry")
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
      llm({ representative: [{ ...item("초유 보습 크림 어때?", "site") }] })
    );
    const withHeading = await suggestTrackingPrompts({
      ...findableInput,
      site: { title: "테스트", headings: ["활성 초유 보습 크림"] },
    });
    expect(withHeading.prompts.map((p) => p.text)).toContain(
      "초유 보습 크림 어때?"
    );
    h.generateObject.mockResolvedValue(
      llm({ representative: [{ ...item("초유 보습 크림 어때?", "site") }] })
    );
    const without = await suggestTrackingPrompts({
      ...findableInput,
      site: { title: "테스트" },
    });
    expect(without.prompts.map((p) => p.text)).not.toContain(
      "초유 보습 크림 어때?"
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
