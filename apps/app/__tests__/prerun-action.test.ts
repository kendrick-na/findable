/**
 * 질문 미리 돌려 보기 서버액션(2026-10-14) — 기본 off, 소유 확인, 질문 정리·상한, 엔진 1곳(gemini)에 1번씩.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: false,
  queryEngine: vi.fn(),
  brand: { current: null as unknown },
}));
vi.mock("@repo/ai/lib/engines", () => ({ queryEngine: h.queryEngine }));
vi.mock("@repo/audit/question-prerun", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isQuestionPrerunEnabled: () => h.enabled,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/db/scoped", () => ({
  requireOrg: () => Promise.resolve("org_1"),
  scopedBrandById: () => Promise.resolve(h.brand.current),
}));

import { prerunQuestionsAction } from "../app/actions/brand/prerun-questions";

const list = "추천:\n1. 라운드랩 - 크림\n2. 토리든 - 세럼\n3. 아누아 - 토너\n";

beforeEach(() => {
  h.enabled = true;
  h.queryEngine.mockReset();
  h.queryEngine.mockResolvedValue({
    errorMessage: null,
    isStub: false,
    rawResponse: list,
  });
  h.brand.current = {
    id: "b1",
    name: "프란츠",
    domain: "franzskincare.com",
    entityVariants: ["FRANZ"],
    competitors: [],
  };
});

describe("prerunQuestionsAction", () => {
  it("꺼져 있으면 엔진을 호출하지 않는다", async () => {
    h.enabled = false;
    const r = await prerunQuestionsAction({
      brandId: "b1",
      questions: ["크림 추천해줘"],
    });
    expect(r).toHaveProperty("error");
    expect(h.queryEngine).not.toHaveBeenCalled();
  });

  it("남의 브랜드(소유 확인 실패)면 호출하지 않는다", async () => {
    h.brand.current = null;
    const r = await prerunQuestionsAction({
      brandId: "other",
      questions: ["크림 추천해줘"],
    });
    expect(r).toHaveProperty("error");
    expect(h.queryEngine).not.toHaveBeenCalled();
  });

  it("질문마다 gemini 에 1번씩 호출하고 신호를 돌려준다", async () => {
    const r = await prerunQuestionsAction({
      brandId: "b1",
      questions: ["크림 추천해줘", "토너 추천해줘"],
    });
    expect(h.queryEngine).toHaveBeenCalledTimes(2);
    expect(h.queryEngine.mock.calls[0]?.[0]).toMatchObject({
      engineId: "gemini",
      language: "ko",
      brandName: "프란츠",
    });
    if (!("ok" in r)) {
      throw new Error("expected ok");
    }
    expect(r.signals).toHaveLength(2);
    expect(r.signals[0]?.brandsListed).toBeGreaterThan(0);
  });

  it("너무 짧거나 긴 질문·중복·20개 초과는 서버가 다시 거른다", async () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `질문 번호 ${i} 추천해줘`
    );
    await prerunQuestionsAction({
      brandId: "b1",
      questions: [
        "a",
        "가".repeat(201),
        "크림 추천해줘",
        "크림 추천해줘",
        ...many,
      ],
    });
    expect(h.queryEngine).toHaveBeenCalledTimes(20);
  });

  it("엔진 오류는 그 질문만 error 로 표시한다(저장·점수에 영향 없음)", async () => {
    h.queryEngine.mockResolvedValue({
      errorMessage: "429",
      isStub: false,
      rawResponse: "",
    });
    const r = await prerunQuestionsAction({
      brandId: "b1",
      questions: ["크림 추천해줘"],
    });
    if (!("ok" in r)) {
      throw new Error("expected ok");
    }
    expect(r.signals[0]?.error).toBe(true);
  });
});
