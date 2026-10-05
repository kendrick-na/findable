import { describe, expect, it, vi } from "vitest";
import {
  extractOfficialSiteIdentity,
  readIdentityAndFooter,
  readIdentityHtml,
  registeredBrandIdentityFallback,
} from "./official-site-identity";

describe("official site identity response", () => {
  it("propagates a caller abort instead of converting it to registration fallback", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("deadline", "AbortError"));

    await expect(
      import("./official-site-identity").then(
        ({ resolveOfficialSiteIdentity }) =>
          resolveOfficialSiteIdentity("https://example.com", controller.signal)
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back only for a confirmed organisation brand and does not invent site evidence", () => {
    expect(
      registeredBrandIdentityFallback({
        brandId: "brand-1",
        brandName: "코스메카코리아",
        domain: "cosmecca.com",
      })
    ).toEqual({
      description: null,
      finalUrl: "cosmecca.com",
      h1: null,
      siteName: null,
      title: null,
    });
    expect(
      registeredBrandIdentityFallback({
        brandName: "코스메카코리아",
        domain: "cosmecca.com",
      })
    ).toBeNull();
  });

  it("does not treat a script template as visible identity evidence", () => {
    const html =
      '<head><title>Example</title></head><body><script>const card = "<p>Fake marketing service from a script.</p>";</script><p>Actual customer-facing consulting service.</p></body>';
    expect(
      extractOfficialSiteIdentity(html, "https://example.com")?.description
    ).toBe("Actual customer-facing consulting service.");
  });

  it("ignores script/style markup that only looks like visible site evidence", async () => {
    const html =
      '<html><head><title>Indigochild</title><script>const template = "<p>Fake service statement from a template.</p>";</script></head><body><p>Real service statement for customers.</p></body></html>';
    const response = new Response(html, {
      headers: { "content-type": "text/html" },
    });
    const read = await readIdentityHtml(response);
    expect(
      extractOfficialSiteIdentity(read, "https://indigochild.kr/")
    ).toMatchObject({
      description: "Real service statement for customers.",
    });
  });

  it("uses a visible service statement when a generic head has no description", async () => {
    const html =
      "<html><head><title>Indigochild</title></head><body><h1>We Create the Future</h1><p>Providing comprehensive marketing consulting and social media branding services.</p></body></html>";
    const response = new Response(html, {
      headers: { "content-type": "text/html" },
    });
    const read = await readIdentityHtml(response);
    expect(
      extractOfficialSiteIdentity(read, "https://indigochild.kr/")
    ).toMatchObject({
      title: "Indigochild",
      description:
        "Providing comprehensive marketing consulting and social media branding services.",
    });
  });

  it("reads the footer business info of a Korean store homepage", () => {
    const html =
      '<html><head><title>프란츠 스킨케어 FRANZ SKINCARE</title><meta property="og:site_name" content="프란츠 스킨케어" /></head><body><div class="xans-company"><span>상호: 바이오센서연구소(주)</span><span>대표: 홍길동</span><span>사업자등록번호: 119-86-72928 <a>[사업자정보확인]</a></span></div><!-- 상호: 주석회사 --></body></html>';
    expect(
      extractOfficialSiteIdentity(html, "https://franzskincare.com/")
    ).toMatchObject({
      legalName: "바이오센서연구소(주)",
      businessNumber: "119-86-72928",
      siteName: "프란츠 스킨케어",
    });
  });

  it("reads a usable head without downloading a large page body", async () => {
    const head =
      '<html><head><title>이니스프리 | 공식몰</title><meta name="description" content="화장품 공식몰"></head>';
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(head));
        },
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(1_100_000)));
          controller.close();
        },
      }),
      { headers: { "content-length": "1100123", "content-type": "text/html" } }
    );

    const html = await readIdentityHtml(response);
    const identity = extractOfficialSiteIdentity(
      html,
      "https://www.innisfree.com/"
    );
    expect(identity?.title).toContain("이니스프리");
    expect(identity?.description).toBe("화장품 공식몰");
    expect(html.length).toBeLessThan(1000);
  });

  // 2026-10-05 컨트롤타워 검증: 푸터를 더 읽어도 판정용 식별 구간(H1 등)은 기존과 같아야 한다.
  it("keeps the identity window unchanged and finds the footer separately", async () => {
    const head =
      '<html><head><title>프란츠 스킨케어</title><meta name="description" content="피부 과학"></head>';
    const late = `${"<p>x</p>".repeat(3000)}<h1>늦은 제목</h1><div>상호: 바이오센서연구소(주) 대표: 홍길동</div>`;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(head));
          controller.enqueue(new TextEncoder().encode(late));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/html" } }
    );
    const { html, footerHtml } = await readIdentityAndFooter(response);
    expect(extractOfficialSiteIdentity(html, "https://x/")?.h1).toBeNull();
    expect(footerHtml).toContain("바이오센서연구소");
  });

  it("stops the footer search on a slow stream without failing", async () => {
    vi.useFakeTimers();
    const head =
      '<html><head><title>T</title><meta name="description" content="D"></head>';
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(head));
        },
        pull() {
          return new Promise(() => undefined); // 영영 안 오는 다음 조각
        },
      }),
      { headers: { "content-type": "text/html" } }
    );
    const pending = readIdentityAndFooter(response);
    await vi.advanceTimersByTimeAsync(3100);
    const { html, footerHtml } = await pending;
    vi.useRealTimers();
    expect(extractOfficialSiteIdentity(html, "https://x/")?.title).toBe("T");
    expect(footerHtml).toBe("");
  });
});
