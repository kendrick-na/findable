import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * (packages/ai 쪽에 둔 이유: 질문 생성 모델 모킹이 이 패키지의 `ai` 를 가로채야 한다. 읽기 모듈은 상대 경로로 가져온다.)
 * I-05형(글이 이미지 안) 흐름 시험 — 사이트 읽기(얇음) → 이미지 글자 읽기(가짜 모델) → 질문 생성(가짜 모델)까지 이어지는지(2026-10-19).
 * 실제 모델·네트워크 호출 없음. 이미지에서 나온 글자가 질문 생성 재료에 들어가고, 그 재료로 만든 질문이 검사를 통과한다.
 */
const h = vi.hoisted(() => ({
  extractImageText: vi.fn(),
  generateObject: vi.fn(),
}));
vi.mock("ai", () => ({ generateObject: h.generateObject }));
vi.mock("./models", () => ({ models: { chat: "stub-model" } }));
vi.mock("./letsur-fallback", () => ({
  HELPER_GATEWAY_MODEL_ID: "stub",
  letsurModelWithFallback: () => null,
}));
vi.mock("./image-text", () => ({
  extractImageText: h.extractImageText,
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../audit/public-url-security", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertPublicUrl: () => Promise.resolve(),
}));
vi.mock("../../audit/site-render", () => ({
  renderSiteHtml: () => Promise.resolve(null),
  siteRenderStatus: () => "flag_off",
}));

import { readSiteProfileWithOutcome } from "../../audit/site-profile";
import { suggestTrackingPrompts } from "./prompt-suggestions";

const PAGE = `<html><head><title>x</title></head><body><div id="root"></div>
<img src="/detail1.png" width="800" height="1200"><img src="/detail2.png" width="800" height="1000"></body></html>`;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const IMAGE_TEXT = `${"프란츠 시카 크림 민감성 피부 보습 진정 크림 비타민 앰플 신생아 보습 로션 순한 성분 피부 장벽 케어 데일리 스킨케어 루틴 추천 세트 구성 안내 사용 방법 주의 사항 ".repeat(3)}`;

beforeEach(() => {
  h.extractImageText.mockReset();
  h.generateObject.mockReset();
  vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname === "/") {
        return Promise.resolve(
          new Response(PAGE, {
            headers: { "content-type": "text/html" },
            status: 200,
          })
        );
      }
      if (url.pathname.endsWith(".png")) {
        return Promise.resolve(
          new Response(PNG, {
            headers: { "content-type": "image/png" },
            status: 200,
          })
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const item = (text: string) => ({ language: "ko" as const, text });

describe("이미지 글자 → 질문 생성 흐름", () => {
  it("이미지에서 읽은 글자가 질문 생성 재료에 들어가고, 그 재료로 만든 질문이 통과한다", async () => {
    h.extractImageText.mockResolvedValue({
      inputTokens: 900,
      outputTokens: 60,
      text: IMAGE_TEXT,
    });
    const read = await readSiteProfileWithOutcome("example.test");
    expect(read.outcome).toBe("image_text_used");
    expect(read.methods).toContain("image_text");
    expect(read.profile?.thin).toBe(false);

    h.generateObject.mockResolvedValue({
      object: {
        category: Array.from({ length: 8 }, (_, i) =>
          item(`민감성 피부 보습 크림 ${i}번 추천해줘`)
        ),
        concern: Array.from({ length: 4 }, (_, i) =>
          item(`피부가 당기는데 어떤 보습 크림이 좋아 ${i}`)
        ),
        representative: [
          { ...item("시카 크림 비타민 앰플 뭐가 좋아?"), basis: "site" },
        ],
        alternative: [],
        brandUnderstanding: [
          item("프란츠 후기 어때?"),
          item("프란츠 장단점 알려줘"),
        ],
        categoryPhrase: "",
        confident: true,
      },
    });
    const out = await suggestTrackingPrompts({
      brandName: "프란츠",
      domain: "example.test",
      industry: "retail",
      marketScope: "korea",
      site: read.profile,
    } as never);

    // 질문 생성 호출의 재료에 이미지에서 읽은 글자가 들어갔다
    const prompt = String(h.generateObject.mock.calls[0]?.[0]?.prompt ?? "");
    expect(prompt).toContain("시카 크림");
    // 대표 상품 질문은 사이트 문구(= 이미지에서 읽은 글자)에 근거가 있어 통과한다
    expect(out.prompts.length).toBeGreaterThanOrEqual(8);
    expect(out.prompts.some((p) => p.type === "representative")).toBe(true);
    expect(out.prompts.some((p) => p.type === "brand")).toBe(true);
  });

  it("이미지 글자 읽기 없이는(플래그 꺼짐) 같은 사이트가 얇게 남아 대표 상품 질문이 통과하지 못한다", async () => {
    vi.stubEnv("SITE_IMAGE_TEXT_ENABLED", "");
    const read = await readSiteProfileWithOutcome("example.test");
    expect(read.outcome).toBe("render_needed");
    expect(h.extractImageText).not.toHaveBeenCalled();
    h.generateObject.mockResolvedValue({
      object: {
        category: Array.from({ length: 8 }, (_, i) =>
          item(`민감성 피부 보습 크림 ${i}번 추천해줘`)
        ),
        concern: [],
        representative: [
          { ...item("시카 크림 비타민 앰플 뭐가 좋아?"), basis: "site" },
        ],
        alternative: [],
        brandUnderstanding: [item("프란츠 후기 어때?")],
        categoryPhrase: "",
        confident: true,
      },
    });
    const out = await suggestTrackingPrompts({
      brandName: "프란츠",
      domain: "example.test",
      industry: "retail",
      marketScope: "korea",
      site: read.profile,
    } as never);
    // 재료가 얇으면 사이트 근거가 필요한 대표 상품 질문이 통과하지 못한다 — 이미지 글자 읽기가 채우는 간극이다
    expect(out.prompts.some((p) => p.type === "representative")).toBe(false);
  });
});
