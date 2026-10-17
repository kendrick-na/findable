import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daumAdapter } from "./korean-adapters";

const query = {
  brandName: "프롬맘",
  engineId: "daum" as const,
  language: "ko" as const,
  prompt: "프롬맘 후기 어때?",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("daumAdapter — 검색 결과 0건은 측정 실패가 아니라 미노출(진단 ⑤)", () => {
  beforeEach(() => {
    vi.stubEnv("KAKAO_REST_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("요청이 모두 정상인데 문서가 0건이면 오류가 아니다 — 언급 없음으로 기록, 글에 질의(브랜드 이름)를 넣지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ documents: [] })))
    );
    const res = await daumAdapter(query);
    expect(res.errorMessage).toBeNull();
    expect(res.isStub).toBe(false);
    expect(res.brandMentioned).toBe(false);
    expect(res.rawResponse).toBe("검색 결과가 없습니다.");
    expect(res.rawResponse).not.toContain("프롬맘");
    expect(res.citedSources).toEqual([]);
  });

  it("검색 요청이 하나라도 실패(HTTP 오류)하면 예전처럼 오류로 남는다 — 못 잰 것을 미노출로 세지 않는다", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(
          calls === 1 ? json({}, 500) : json({ documents: [] })
        );
      })
    );
    const res = await daumAdapter(query);
    expect(res.errorMessage).toBe("Daum/Kakao 검색 결과 없음");
    expect(res.rawResponse).toBe("");
  });

  it("네트워크 오류로 요청이 거부돼도 오류로 남는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network")))
    );
    const res = await daumAdapter(query);
    expect(res.errorMessage).not.toBeNull();
  });

  it("문서가 있으면 기존 경로 그대로(근거 글·출처가 채워진다)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          documents: [
            {
              contents: "프롬맘 활성 초유 보습 크림 후기",
              title: "프롬맘 후기",
              url: "https://blog.example.kr/1",
            },
          ],
        })
      )
    );
    const res = await daumAdapter(query);
    expect(res.errorMessage).toBeNull();
    expect(res.rawResponse).toContain("프롬맘");
    expect(res.citedSources.length).toBeGreaterThan(0);
  });
});
