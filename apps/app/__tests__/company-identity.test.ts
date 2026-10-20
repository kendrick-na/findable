/** @vitest-environment node */

// 회사 동일성 대조 — 「엑스포·목록에 나온 그 회사」가 「DART가 확정한 그 회사」와 같은지.
// 이름이 같은 다른 회사에 매출을 붙이면 영업 메일에 틀린 숫자가 들어간다(사실 규칙 위반).
// 근거는 약한 것부터: 이름만 → 소재지 일치 → 홈페이지의 사업자번호 일치(가장 강함).

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const lib = await import("../lib/ax-mail/sources/company-identity");

describe("extractBizNumbers — 홈페이지 글에서 사업자등록번호 읽기", () => {
  test("라벨 옆의 000-00-00000 형식만 읽는다", () => {
    const text =
      "상호 주식회사 파이온텍 | 대표자 홍길동 | 사업자등록번호 : 123-45-67890 | 통신판매업신고 제2024-청주흥덕-0123호";
    expect(lib.extractBizNumbers(text)).toEqual(["1234567890"]);
  });

  test("라벨 없는 숫자열·전화번호·통신판매업 번호는 읽지 않는다", () => {
    const text =
      "대표전화 043-123-4567 · 통신판매업 2024-서울강남-01234 · 우편번호 12345 · 123-45-67890";
    expect(lib.extractBizNumbers(text)).toEqual([]);
  });

  test("여러 번호가 있으면 모두 돌려주고 중복은 합친다", () => {
    const text =
      "사업자등록번호 123-45-67890 / Business Registration No. 123-45-67890 / 사업자 번호: 987-65-43210";
    expect(lib.extractBizNumbers(text).sort()).toEqual([
      "1234567890",
      "9876543210",
    ]);
  });

  test("공백·점·붙여쓴 표기도 읽는다", () => {
    expect(lib.extractBizNumbers("사업자등록번호 123 45 67890")).toEqual([
      "1234567890",
    ]);
    expect(lib.extractBizNumbers("사업자등록번호:1234567890")).toEqual([
      "1234567890",
    ]);
  });
});

describe("judgeIdentity — 근거를 모아 등급을 정한다", () => {
  const dart = {
    address: "충청북도 청주시 흥덕구 오송읍 오송생명1로 194",
    bizNo: "1234567890",
    name: "주식회사 파이온텍",
  };

  test("홈페이지 사업자번호가 DART와 같으면 confirmed", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)파이온텍",
      expoRegion: "청주",
      homepageBizNos: ["1234567890"],
    });
    expect(r.level).toBe("confirmed");
    expect(r.reasons).toContain("homepage_biz_no_match");
  });

  test("홈페이지 사업자번호가 DART와 다르면 mismatch — 매출을 붙이지 않는다", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)파이온텍",
      homepageBizNos: ["9999999999"],
    });
    expect(r.level).toBe("mismatch");
    expect(r.reasons).toContain("homepage_biz_no_conflict");
  });

  test("홈페이지를 못 읽었으면 소재지가 맞아도 probable까지만", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)파이온텍",
      expoRegion: "청주",
      homepageBizNos: [],
    });
    expect(r.level).toBe("probable");
    expect(r.reasons).toEqual(["name_match", "region_match"]);
  });

  test("이름만 같고 소재지도 다르면 name_only", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)파이온텍",
      expoRegion: "서울",
      homepageBizNos: [],
    });
    expect(r.level).toBe("name_only");
    expect(r.reasons).toContain("region_conflict");
  });

  test("이름이 서로 다르면 mismatch", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)전혀다른회사",
      homepageBizNos: ["1234567890"],
    });
    expect(r.level).toBe("mismatch");
  });

  test("홈페이지에 여러 번호가 있고 그중 하나가 DART와 같으면 confirmed(계열사 표기 허용)", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)파이온텍",
      homepageBizNos: ["9999999999", "1234567890"],
    });
    expect(r.level).toBe("confirmed");
  });
});

describe("revenueAllowed — 영업 문서에 매출 숫자를 쓸 수 있는 등급", () => {
  test("confirmed만 true, 나머지는 false(확인 필요로 둔다)", () => {
    expect(lib.revenueAllowed("confirmed")).toBe(true);
    for (const level of ["probable", "name_only", "mismatch"] as const) {
      expect(lib.revenueAllowed(level)).toBe(false);
    }
  });
});

// ── 홈페이지에서 사업자등록번호 읽기: 안전 규칙은 이메일 수집과 같다 ─────────────────
const identityPages = await import("../lib/ax-mail/sources/contact-email");

type Pages = Record<string, { body: string; status?: number }>;
function fakeFetch(pages: Pages) {
  const calls: string[] = [];
  const impl = ((input: URL | RequestInfo) => {
    const url = input.toString();
    calls.push(url);
    const page = pages[url];
    return Promise.resolve(
      new Response(page?.body ?? "", {
        headers: { "content-type": "text/html; charset=utf-8" },
        status: page?.status ?? (page ? 200 : 404),
      })
    );
  }) as typeof fetch;
  return { calls, impl };
}
const deps = (impl: typeof fetch) => ({
  assertUrl: () => Promise.resolve(),
  fetchImpl: impl,
});

describe("readHomepageText — 홈페이지 본문 읽기(사업자번호 대조용)", () => {
  test("홈페이지 푸터 글을 돌려준다", async () => {
    const { impl } = fakeFetch({
      "https://example-co.com/": {
        body: "<html><body><footer>상호 (주)예시 사업자등록번호 123-45-67890</footer></body></html>",
      },
      "https://example-co.com/robots.txt": { body: "User-agent: *\nAllow: /" },
    });
    const r = await identityPages.readHomepageText(
      "example-co.com",
      deps(impl)
    );
    expect(r.status).toBe("ok");
    expect(r.text).toContain("123-45-67890");
  });

  test("robots.txt가 홈페이지를 막으면 읽지 않는다", async () => {
    const { impl, calls } = fakeFetch({
      "https://example-co.com/robots.txt": {
        body: "User-agent: *\nDisallow: /",
      },
      "https://example-co.com/": { body: "사업자등록번호 123-45-67890" },
    });
    const r = await identityPages.readHomepageText(
      "example-co.com",
      deps(impl)
    );
    expect(r.status).toBe("blocked_by_robots");
    expect(r.text).toBe("");
    expect(calls).not.toContain("https://example-co.com/");
  });

  test("이메일 무단수집 거부 게시가 있으면 본문을 쓰지 않는다", async () => {
    const { impl } = fakeFetch({
      "https://example-co.com/": {
        body: "<footer>이메일무단수집거부 · 사업자등록번호 123-45-67890</footer>",
      },
      "https://example-co.com/robots.txt": { body: "User-agent: *\nAllow: /" },
    });
    const r = await identityPages.readHomepageText(
      "example-co.com",
      deps(impl)
    );
    expect(r.status).toBe("refused");
    expect(r.text).toBe("");
  });

  test("잘못된 도메인이면 아무것도 요청하지 않는다", async () => {
    const { impl, calls } = fakeFetch({});
    const r = await identityPages.readHomepageText("not a domain", deps(impl));
    expect(r.status).toBe("skipped");
    expect(calls).toEqual([]);
  });
});

describe("소재지 미확인은 근거가 아니다(충돌로 세지 않는다)", () => {
  const dart = {
    address: "서울특별시 강남구 학동로31길 12",
    bizNo: "1234567890",
    name: "주식회사 에쓰씨케이",
  };
  test("「미확인」「확인 필요」「-」는 소재지 없음으로 본다 → region_conflict 아님", () => {
    for (const expoRegion of [
      "미확인",
      "확인 필요",
      "-",
      "  ",
      null,
      undefined,
    ]) {
      const r = lib.judgeIdentity({
        dart,
        expoName: "(주)에쓰씨케이",
        expoRegion,
        homepageBizNos: [],
      });
      expect(r.reasons).not.toContain("region_conflict");
      expect(r.level).toBe("name_only");
    }
  });
  test("실제 다른 지역이면 여전히 충돌", () => {
    const r = lib.judgeIdentity({
      dart,
      expoName: "(주)에쓰씨케이",
      expoRegion: "청주",
      homepageBizNos: [],
    });
    expect(r.reasons).toContain("region_conflict");
  });
});

describe("readHomepageText — 첫 쪽에 없으면 회사소개·정책 쪽까지(최대 3쪽)", () => {
  const ok = {
    "https://example-co.com/robots.txt": { body: "User-agent: *\nAllow: /" },
  };

  test("첫 쪽에 번호가 없으면 회사소개 링크를 따라가 읽는다", async () => {
    const { impl, calls } = fakeFetch({
      ...ok,
      "https://example-co.com/": {
        body: '<body><a href="/company/about">회사소개</a><a href="/shop">쇼핑</a></body>',
      },
      "https://example-co.com/company/about": {
        body: "<footer>사업자등록번호 123-45-67890</footer>",
      },
      "https://example-co.com/shop": { body: "상품" },
    });
    const r = await identityPages.readHomepageText("example-co.com", {
      ...deps(impl),
      maxPages: 3,
      delayMs: 0,
    });
    expect(r.text).toContain("123-45-67890");
    expect(calls).toContain("https://example-co.com/company/about");
    expect(calls).not.toContain("https://example-co.com/shop");
  });

  test("개인정보처리방침·이용약관·사업자정보 링크도 후보다", async () => {
    const { impl, calls } = fakeFetch({
      ...ok,
      "https://example-co.com/": {
        body: '<a href="/policy/privacy">개인정보처리방침</a><a href="/terms">이용약관</a>',
      },
      "https://example-co.com/policy/privacy": {
        body: "개인정보 보호책임자 ... 사업자등록번호 123-45-67890",
      },
      "https://example-co.com/terms": { body: "약관" },
    });
    const r = await identityPages.readHomepageText("example-co.com", {
      ...deps(impl),
      maxPages: 3,
      delayMs: 0,
    });
    expect(r.text).toContain("123-45-67890");
    expect(calls).toContain("https://example-co.com/policy/privacy");
  });

  test("번호를 찾으면 더 읽지 않고 멈춘다(요청 최소화)", async () => {
    const { impl, calls } = fakeFetch({
      ...ok,
      "https://example-co.com/": {
        body: '<footer>사업자등록번호 123-45-67890</footer><a href="/company/about">회사소개</a>',
      },
      "https://example-co.com/company/about": { body: "소개" },
    });
    await identityPages.readHomepageText("example-co.com", {
      ...deps(impl),
      maxPages: 3,
      delayMs: 0,
      stopWhen: (t: string) => /\d{3}-\d{2}-\d{5}/.test(t),
    });
    expect(calls).not.toContain("https://example-co.com/company/about");
  });

  test("링크를 따라가도 다른 도메인으로는 가지 않고, 쪽 수 상한을 넘기지 않는다", async () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `<a href="/company/p${i}">회사소개 ${i}</a>`
    ).join("");
    const { impl, calls } = fakeFetch({
      ...ok,
      "https://example-co.com/": {
        body: `${links}<a href="https://evil.example.org/company">회사소개</a>`,
      },
    });
    await identityPages.readHomepageText("example-co.com", {
      ...deps(impl),
      maxPages: 3,
      delayMs: 0,
    });
    const pages = calls.filter((u) => !u.endsWith("robots.txt"));
    expect(pages.length).toBeLessThanOrEqual(3);
    expect(calls.some((u) => u.includes("evil.example.org"))).toBe(false);
  });
});
