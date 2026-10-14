import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

import { extractSiteProfile, THIN_SITE_TEXT_CHARS } from "./site-profile";

const page = (body: string, head = "") =>
  `<html><head><title>프롬맘 | 아기 보습</title><meta name="description" content="활성 초유로 아기 피부를"><meta property="og:site_name" content="프롬맘">${head}</head><body><header><nav>메뉴 로그인 장바구니</nav></header>${body}<footer>사업자등록번호</footer></body></html>`;

describe("extractSiteProfile — 질문 제안용 사이트 재료", () => {
  it("제목·설명·H1·사이트명 + 소제목·본문 첫머리를 뽑고, 메뉴·푸터 글자는 뺀다", () => {
    const html = page(
      `<h1>아기 피부 고민엔 프롬맘</h1><h2>활성 초유 보습 크림</h2><h3>신생아 로션</h3><p>${"우리 아이 피부를 위한 순한 보습 제품입니다. ".repeat(20)}</p>`
    );
    const p = extractSiteProfile(html);
    expect(p.title).toBe("프롬맘 | 아기 보습");
    expect(p.siteName).toBe("프롬맘");
    expect(p.h1).toBe("아기 피부 고민엔 프롬맘");
    expect(p.headings).toEqual(["활성 초유 보습 크림", "신생아 로션"]);
    expect(p.bodySnippet).toContain("순한 보습 제품");
    expect(p.bodySnippet).not.toContain("장바구니");
    expect(p.thin).toBe(false);
  });

  it("JSON-LD 의 Organization·Product 설명과 FAQ 질문을 뽑는다", () => {
    const ld = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        {
          "@type": "Organization",
          name: "프롬맘",
          description: "영유아 스킨케어 브랜드",
        },
        {
          "@type": "FAQPage",
          mainEntity: [{ "@type": "Question", name: "신생아도 쓸 수 있나요?" }],
        },
      ],
    })}</script>`;
    const p = extractSiteProfile(page("<p>x</p>", ld));
    expect(p.jsonLdFacts).toEqual(
      expect.arrayContaining(["프롬맘", "영유아 스킨케어 브랜드"])
    );
    expect(p.faq).toEqual(["신생아도 쓸 수 있나요?"]);
  });

  it("깨진 JSON-LD·스크립트 속 글자는 무시한다", () => {
    const p = extractSiteProfile(
      page(
        `<script>var x="<h2>가짜 소제목입니다</h2>"</script><p>본문</p>`,
        `<script type="application/ld+json">{깨짐</script>`
      )
    );
    expect(p.headings).toEqual([]);
    expect(p.jsonLdFacts).toEqual([]);
  });

  it(`눈에 보이는 글자가 ${THIN_SITE_TEXT_CHARS}자 미만이면 thin(JS 렌더링·차단 의심)`, () => {
    expect(extractSiteProfile(page("<div id='root'></div>")).thin).toBe(true);
  });
});
