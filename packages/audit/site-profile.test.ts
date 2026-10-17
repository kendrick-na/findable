import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

import {
  alternateOrigin,
  extractSiteProfile,
  mergeSiteProfiles,
  readLimitedText,
  THIN_SITE_TEXT_CHARS,
} from "./site-profile";

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

describe("mergeSiteProfiles — 홈 + 서비스 페이지", () => {
  it("서비스 페이지의 소제목·본문이 합쳐지고, 홈이 얇아도 서비스 페이지 글이 있으면 thin 이 아니다", () => {
    const home = extractSiteProfile(page("<div id='root'></div>"));
    expect(home.thin).toBe(true);
    const service = extractSiteProfile(
      page(
        `<h1>법인 송금 서비스</h1><h2>수수료 안내</h2><p>${"사업자를 위한 빠른 송금과 정산 서비스입니다. ".repeat(12)}</p>`
      )
    );
    const merged = mergeSiteProfiles(home, [service]);
    expect(merged.headings).toEqual(
      expect.arrayContaining(["법인 송금 서비스", "수수료 안내"])
    );
    expect(merged.bodySnippet).toContain("법인 송금 서비스: ");
    expect(merged.thin).toBe(false);
    expect(merged.pagesRead).toBe(2);
  });

  it("글자 수 상한을 넘지 않는다", () => {
    const big = extractSiteProfile(
      page(`<p>${"가나다라마바사 ".repeat(400)}</p>`)
    );
    const merged = mergeSiteProfiles(big, [big, big, big]);
    expect(merged.bodySnippet.length).toBeLessThanOrEqual(2000);
    expect(merged.headings.length).toBeLessThanOrEqual(16);
  });
});

describe("alternateOrigin — apex ↔ www", () => {
  it("apex 는 www 로, www 는 apex 로 바꾼다(포트·프로토콜 유지)", () => {
    expect(alternateOrigin("https://starbucks.co.kr")).toBe(
      "https://www.starbucks.co.kr"
    );
    expect(alternateOrigin("https://www.skax.com")).toBe("https://skax.com");
    expect(alternateOrigin("http://example.com:8080")).toBe(
      "http://www.example.com:8080"
    );
  });
});

describe("readLimitedText — 큰 페이지는 앞부분만 읽고 끊는다(I-27: 7.8MB 홈페이지)", () => {
  const stream = (chunkBytes: number, chunks: number) => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunks) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(new Uint8Array(chunkBytes).fill(97)); // 'a'
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      body,
      arrayBuffer: () => Promise.reject(new Error("통째로 읽으면 안 된다")),
      state: () => ({ cancelled, pulled }),
    };
  };

  it("상한(500KB)까지만 읽고 스트림을 취소한다 — 나머지는 받지 않는다", async () => {
    const res = stream(64 * 1024, 120); // 7.5MB 분량
    const text = await readLimitedText(res, 500_000);
    expect(text.length).toBe(500_000);
    const { cancelled, pulled } = res.state();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(20); // 8개 남짓만 받고 끊음(120개 전부 아님)
  });

  it("상한보다 작은 페이지는 통째로 같은 글자(정상 사이트 결과 불변)", async () => {
    const html = "<html><title>작은 페이지</title></html>";
    const bytes = new TextEncoder().encode(html);
    const res = {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 10));
          controller.enqueue(bytes.subarray(10));
          controller.close();
        },
      }),
      arrayBuffer: () => Promise.reject(new Error("unused")),
    };
    expect(await readLimitedText(res, 500_000)).toBe(html);
  });

  it("본문 스트림이 없으면 예전처럼 통째로 읽고 자른다", async () => {
    const bytes = new TextEncoder().encode("가나다라마바사");
    const res = {
      body: null,
      arrayBuffer: () => Promise.resolve(bytes.buffer as ArrayBuffer),
    };
    expect(await readLimitedText(res, 500_000)).toBe("가나다라마바사");
  });

  it("한글이 상한 경계에서 잘려도 깨진 글자 하나로 끝난다(오류 없음)", async () => {
    const bytes = new TextEncoder().encode("가".repeat(10)); // 30바이트
    const res = {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      arrayBuffer: () => Promise.reject(new Error("unused")),
    };
    const text = await readLimitedText(res, 10);
    expect(text.startsWith("가가가")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(5);
  });
});
