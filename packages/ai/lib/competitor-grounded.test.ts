import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("./models", () => ({ models: { chat: "stub" } }));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "stub",
  letsurModelWithFallback: () => null,
}));
vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

import {
  filterCompetitorCandidates,
  type GroundedDeps,
  suggestCompetitorsGrounded,
} from "./competitor-suggest";

const input = {
  aliases: ["파인더블"],
  brandName: "Findable",
  domain: "findable.co.kr",
  industry: "b2b_saas",
  site: { description: "AI 검색 가시성 진단" },
};

describe("filterCompetitorCandidates", () => {
  it("자사 이름·도메인 줄기·AI 엔진 이름·중복을 뺀다(운영 실측 ChatGPT 응답 모양)", () => {
    const raw = [
      "Profound",
      "AthenaHQ",
      "Peec AI",
      "Findable",
      "파인더블",
      "ChatGPT",
      "Perplexity",
      "Gemini",
      "Claude",
      "Copilot",
      "peec ai",
      "Otterly.AI",
    ];
    expect(
      filterCompetitorCandidates(raw, ["Findable", "파인더블", "findable"])
    ).toEqual(["Profound", "AthenaHQ", "Peec AI", "Otterly.AI"]);
  });
  it("같은 회사의 하위 브랜드는 하나로(운영 점검 실측: Accenture 4개·Deloitte 2개 — 띄어쓰기 없는 한글 하위 브랜드는 추출 프롬프트가 합친다)", () => {
    const raw = [
      "Accenture",
      "Accenture Song",
      "Accenture Cloud First",
      "Deloitte",
      "Deloitte Consulting",
      "토스뱅크",
    ];
    expect(filterCompetitorCandidates(raw, ["SK AX"])).toEqual([
      "Accenture",
      "Deloitte",
      "토스뱅크",
    ]);
  });

  it("8개까지만", () => {
    const raw = Array.from({ length: 10 }, (_, i) => `Brand${i}X`);
    expect(filterCompetitorCandidates(raw, [])).toHaveLength(8);
  });
});

describe("suggestCompetitorsGrounded", () => {
  const deps = (over: Partial<GroundedDeps> = {}): GroundedDeps => ({
    categoryOf: vi.fn().mockResolvedValue("AI 검색 가시성 측정·개선 서비스"),
    search: vi.fn().mockResolvedValue("답변 본문"),
    extract: vi
      .fn()
      .mockResolvedValue(["Profound", "Peec AI", "Findable", "ChatGPT"]),
    ...over,
  });

  it("분야 → 웹 검색 → 이름 추출 → 자사·엔진 이름 제거 순서로 후보를 만든다", async () => {
    const d = deps();
    expect(await suggestCompetitorsGrounded(input, d)).toEqual([
      "Profound",
      "Peec AI",
    ]);
    expect(d.search).toHaveBeenCalledWith(
      expect.stringContaining("AI 검색 가시성 측정·개선 서비스")
    );
    // 질문에 우리 브랜드 이름을 넣지 않는다(자기 자신 얘기로 흐르지 않게).
    expect(vi.mocked(d.search).mock.calls[0]?.[0]).not.toContain("Findable");
  });

  it("시장을 지정하면 '그 시장'과 '시장 지정 없음' 두 번 묻고 번갈아 합친다(신생·글로벌 카테고리의 해외 경쟁사 누락 방지)", async () => {
    const d = deps({
      search: vi.fn(async (q: string) =>
        q.startsWith("한국에서") ? "국내 답변" : "전체 답변"
      ),
      extract: vi.fn(async (a: string) =>
        a === "국내 답변" ? ["블랙키위", "썸트렌드"] : ["Profound", "Peec AI"]
      ),
    });
    const out = await suggestCompetitorsGrounded(
      { ...input, marketScope: "korea" },
      d
    );
    expect(d.search).toHaveBeenCalledTimes(2);
    expect(out).toEqual(["블랙키위", "Profound", "썸트렌드", "Peec AI"]);
  });

  it("시장을 지정하지 않으면 한 번만 묻는다", async () => {
    const d = deps();
    await suggestCompetitorsGrounded(input, d);
    expect(d.search).toHaveBeenCalledTimes(1);
  });

  it("시장을 지정해 묻고, 추출에는 자사 이름·분야·시장을 넘긴다(자사 영문명 'Karrot' 같은 오염 방지)", async () => {
    const d = deps();
    await suggestCompetitorsGrounded({ ...input, marketScope: "korea" }, d);
    expect(vi.mocked(d.search).mock.calls[0]?.[0]).toContain("한국에서");
    const ctx = vi.mocked(d.extract).mock.calls[0]?.[1];
    expect(ctx?.market).toBe("한국");
    expect(ctx?.category).toBe("AI 검색 가시성 측정·개선 서비스");
    expect(ctx?.ownNames).toEqual(
      expect.arrayContaining(["Findable", "파인더블", "findable"])
    );
  });

  it("분야를 못 만들면 검색하지 않고 빈 배열(원가 보호·지어내지 않음)", async () => {
    const d = deps({ categoryOf: vi.fn().mockResolvedValue(null) });
    expect(await suggestCompetitorsGrounded(input, d)).toEqual([]);
    expect(d.search).not.toHaveBeenCalled();
  });

  it("검색·추출이 실패하면 빈 배열", async () => {
    expect(
      await suggestCompetitorsGrounded(
        input,
        deps({ search: vi.fn().mockResolvedValue(null) })
      )
    ).toEqual([]);
    expect(
      await suggestCompetitorsGrounded(
        input,
        deps({ extract: vi.fn().mockResolvedValue(null) })
      )
    ).toEqual([]);
    expect(
      await suggestCompetitorsGrounded(
        input,
        deps({ search: vi.fn().mockRejectedValue(new Error("x")) })
      )
    ).toEqual([]);
  });
});
