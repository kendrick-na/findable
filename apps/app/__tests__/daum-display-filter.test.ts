/**
 * daum 근거 오염 분리 + 감성 분모 방어 회귀 테스트 (2026-08-10 세션N-14).
 *
 * 여기서 지키는 것 두 가지 =
 *   ① **화면 근거에 브랜드와 무관한 문서가 실리지 않는다**
 *   ② **점수 입력은 1도 바뀌지 않는다**
 *
 * 🔴 왜: 전면 감사 실측에서 daum 응답 **279건 중 129건(46%)** 에 무관 문서가
 *   "AI 답변"으로 고객 화면에 나가고 있었다 —
 *     · 조선미녀 → *"나무위키:접근 제한/문서 목록… 화성의과학대학교, 푸바오"*
 *     · 메디큐브 → *"아이폰 단축어, 노션, 자기관리, 앱 추천"*
 *     · SK하이닉스 → *"말왕 - 나무위키"*, *"애플TV 4K 리뷰"*
 *   원인은 P0-c(2026-07-27)가 프롬프트 검색에 더해 **브랜드명으로도 검색해 뒤에 붙이는데**,
 *   카카오가 엉뚱한 문서를 돌려주면 그게 그대로 근거가 되기 때문이다.
 *   (정식 명칭 = contamination / label leakage)
 *
 * ⚠️ **점수 로직은 건드리지 않는다.** 실측상 daum 언급률은 46%로 8개 엔진 중 **최저**라
 *   오히려 점수를 낮추고 있었다("가짜 언급이 점수를 부풀린다"는 가설은 실측으로 틀렸다).
 *   그래서 이 테스트의 절반은 **"점수가 안 바뀌었음"을 지키는 데** 쓴다.
 *
 * @vitest-environment node
 */

import { normalizeSentiment } from "@repo/ai/lib/engines/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const KAKAO_KEY = "test-kakao-key";

/** 카카오 검색 응답 1건. */
interface Doc {
  contents: string;
  title: string;
  url: string;
}

/**
 * 카카오 검색 API 를 가짜로 세운다.
 *
 * 어댑터는 쿼리마다 web·blog·cafe **3개 엔드포인트**를 호출하므로, 같은 문서가 3번
 * 잡히지 않도록 **web 에만 문서를 주고 나머지는 빈 배열**로 둔다(실제 중복 제거 로직을
 * 검증하는 테스트가 아니다).
 */
function mockKakao(byQuery: Record<string, Doc[]>) {
  return vi.fn((input: string | URL) => {
    const url = new URL(String(input));
    const query = url.searchParams.get("query") ?? "";
    const isWeb = url.pathname.includes("/web");
    const documents = isWeb ? (byQuery[query] ?? []) : [];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ documents }),
    } as Response);
  });
}

async function runDaum(query: {
  prompt: string;
  brandName?: string;
  brandVariants?: string[];
}) {
  const { daumAdapter } = await import("@repo/ai/lib/engines/korean-adapters");
  return await daumAdapter(query as Parameters<typeof daumAdapter>[0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("daum 화면 근거 오염 분리", () => {
  it("🔴 브랜드명 검색으로 붙은 무관 문서가 화면 근거에서 빠진다 (실측 사례)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", KAKAO_KEY);
    vi.stubGlobal(
      "fetch",
      mockKakao({
        // 프롬프트 검색 — 경쟁 지형(브랜드명이 없어도 근거로 유효하다)
        "한국 스킨케어 브랜드 추천": [
          {
            title: "2026 스킨케어 브랜드 TOP 10",
            contents: "닥터지, 라운드랩, 토리든 등이 인기입니다.",
            url: "https://blog.example.com/skincare-top10",
          },
        ],
        // 브랜드명 검색 — 🔴 카카오가 돌려준 실측 오염 문서
        조선미녀: [
          {
            title: "나무위키:접근 제한/문서 목록",
            contents: "화성의과학대학교, 나사렛대학교, 푸바오",
            url: "https://namu.wiki/w/나무위키:접근제한",
          },
        ],
      })
    );

    const res = await runDaum({
      prompt: "한국 스킨케어 브랜드 추천",
      brandName: "조선미녀",
    });

    // 화면 근거에 "푸바오"가 있으면 안 된다 — 이게 사용자가 제보한 그 화면이다.
    expect(res.rawResponse).not.toContain("푸바오");
    expect(res.rawResponse).not.toContain("화성의과학대학교");
    expect(res.rawResponse).not.toContain("나무위키:접근 제한");
    // 프롬프트로 찾은 경쟁 지형은 브랜드명이 없어도 남아야 한다(그게 진단 결과다).
    expect(res.rawResponse).toContain("스킨케어 브랜드 TOP 10");
  });

  it("🔴 무관 문서를 걸러도 **판정(점수)은 그대로다** — 언급 판정이 유지된다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", KAKAO_KEY);
    vi.stubGlobal(
      "fetch",
      mockKakao({
        "수분크림 추천": [
          {
            title: "수분크림 순위",
            contents: "라네즈, 아이오페가 상위권입니다.",
            url: "https://blog.example.com/cream",
          },
        ],
        // 브랜드 검색 결과가 무관 문서뿐 — 화면에선 빠지지만
        메디큐브: [
          {
            title: "아이폰 단축어 활용법",
            contents: "노션, 자기관리, 앱 추천",
            url: "https://blog.example.com/iphone",
          },
        ],
      })
    );

    const res = await runDaum({
      prompt: "수분크림 추천",
      brandName: "메디큐브",
    });

    // 화면에선 빠졌지만…
    expect(res.rawResponse).not.toContain("아이폰 단축어");
    // …판정 입력에는 남아 있으므로 P0-c 의 "브랜드 실재" 정합이 그대로 유지된다.
    //   ⚠️ 여기가 깨지면 소급 점수와 어긋난다("점수는 건드리지 말 것").
    expect(res.brandMentioned).toBe(false);
    // 오염 문서의 출처도 화면 인용목록에서 빠져야 한다(근거와 출처가 어긋나면 안 된다).
    expect(res.citedSources.map((s) => s.url)).not.toContain(
      "https://blog.example.com/iphone"
    );
  });

  it("🔴 브랜드가 **실제로 담긴** 브랜드검색 문서는 남는다 (과잉 삭제 방지)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", KAKAO_KEY);
    vi.stubGlobal(
      "fetch",
      mockKakao({
        "화장품 추천": [
          {
            title: "화장품 순위",
            contents: "여러 브랜드가 경쟁 중입니다.",
            url: "https://blog.example.com/cosmetics",
          },
        ],
        조선미녀: [
          {
            title: "조선미녀 맑은쌀 선크림 후기",
            contents: "조선미녀 제품을 사용해봤습니다.",
            url: "https://blog.example.com/joseon-review",
          },
        ],
      })
    );

    const res = await runDaum({
      prompt: "화장품 추천",
      brandName: "조선미녀",
    });

    expect(res.rawResponse).toContain("조선미녀 맑은쌀 선크림 후기");
    expect(res.brandMentioned).toBe(true);
  });

  it("🔴 카카오 `<b>` 하이라이트가 씌워져 있어도 버리지 않는다 (정제 후 매칭)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", KAKAO_KEY);
    vi.stubGlobal(
      "fetch",
      mockKakao({
        "선크림 추천": [
          {
            title: "선크림 순위",
            contents: "여러 제품 비교",
            url: "https://blog.example.com/suncream",
          },
        ],
        // 🔴 카카오 라이브 실측 형태: 브랜드명을 **토큰 단위로 쪼개** 각각 감싼다
        //   (`<b>조선</b><b>미녀</b>`). `조선미녀` 검색 10건 중 **9건**이 이랬다.
        //   정제 없이 원문으로 비교하면 태그가 글자 사이에 끼어 "조선미녀" 가 안 잡히고,
        //   **브랜드가 실려 있는 문서를 오히려 버린다.**
        //   (`<b>조선미녀</b>` 처럼 통째로 감싼 형태는 substring 이 그냥 통과하므로
        //    이 결함을 드러내지 못한다 — 반드시 태그가 **글자 사이에** 있어야 한다.)
        조선미녀: [
          {
            title: "<b>조선</b><b>미녀</b> 선크림 리뷰",
            contents: "<b>조선</b><b>미녀</b> 제품 후기입니다.",
            url: "https://blog.example.com/highlighted",
          },
        ],
      })
    );

    const res = await runDaum({
      prompt: "선크림 추천",
      brandName: "조선미녀",
    });

    expect(res.rawResponse).toContain("조선미녀 선크림 리뷰");
    // 정제도 함께 걸렸는지 — 화면에 태그가 그대로 보이면 안 된다(세션N-13 회귀 방지).
    expect(res.rawResponse).not.toContain("<b>");
  });

  it("브랜드명이 없으면 거를 기준이 없으므로 기존 동작을 유지한다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", KAKAO_KEY);
    vi.stubGlobal(
      "fetch",
      mockKakao({
        "커피 추천": [
          {
            title: "커피 원두 순위",
            contents: "여러 원두를 비교합니다.",
            url: "https://blog.example.com/coffee",
          },
        ],
      })
    );

    const res = await runDaum({ prompt: "커피 추천" });
    expect(res.rawResponse).toContain("커피 원두 순위");
  });

  it("🔴 걸러낸 결과가 비면 원문으로 되돌린다 (빈 근거 화면 방지)", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", KAKAO_KEY);
    vi.stubGlobal(
      "fetch",
      mockKakao({
        // 프롬프트 검색은 0건, 브랜드 검색만 잡혔는데 그게 전부 무관 문서인 경우.
        "없는 질의": [],
        스타트업브랜드: [
          {
            title: "전혀 다른 문서",
            contents: "관련 없는 내용입니다.",
            url: "https://blog.example.com/unrelated",
          },
        ],
      })
    );

    const res = await runDaum({
      prompt: "없는 질의",
      brandName: "스타트업브랜드",
    });

    // 근거가 **빈 화면**으로 나가느니 맥락이 섞인 원문이 낫다.
    expect(res.rawResponse.trim().length).toBeGreaterThan(0);
    expect(res.errorMessage).toBeNull();
  });
});

describe("normalizeSentiment — 감성 분모 방어막", () => {
  it("🔴 합이 0이면 null (0으로 나누지 않는다) — 실측 회차", () => {
    // DB 실측: {"neutral":0,"negative":0,"positive":0} 회차가 실재한다
    //   (엔진 전멸 — AI Gateway 크레딧 고갈).
    expect(normalizeSentiment({ positive: 0, neutral: 0, negative: 0 })).toBe(
      null
    );
  });

  it("정상 분포는 퍼센트를 함께 돌려준다", () => {
    // DB 실측: {"neutral":20,"negative":0,"positive":6} 합=26
    const s = normalizeSentiment({ positive: 6, neutral: 20, negative: 0 });
    expect(s).not.toBeNull();
    expect(s?.total).toBe(26);
    expect(s?.positivePercent).toBe(23); // 6/26 = 23%
    expect(s?.neutralPercent).toBe(77);
    expect(s?.negativePercent).toBe(0);
  });

  it("🔴 NaN·음수·문자열·누락을 0으로 접는다 (퍼센트가 음수로 나가지 않는다)", () => {
    expect(
      normalizeSentiment({ positive: Number.NaN, neutral: 0, negative: 0 })
    ).toBe(null);
    expect(normalizeSentiment({ positive: -5, neutral: 0, negative: 0 })).toBe(
      null
    );
    const s = normalizeSentiment({
      positive: "3",
      neutral: 2,
      negative: Number.POSITIVE_INFINITY,
    });
    // "3" 은 0 으로 접히므로 중립 2건만 남는다.
    expect(s?.total).toBe(2);
    expect(s?.neutralPercent).toBe(100);
  });

  it("값이 아예 없으면 null (측정 없음과 전부 중립을 구분한다)", () => {
    expect(normalizeSentiment(null)).toBe(null);
    expect(normalizeSentiment(undefined)).toBe(null);
    expect(normalizeSentiment("문자열")).toBe(null);
    expect(normalizeSentiment({})).toBe(null);
  });
});
