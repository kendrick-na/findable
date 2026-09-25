import { describe, expect, it } from "vitest";
import { extractOfficialSiteIdentity, readIdentityHtml } from "./official-site-identity";

describe("official site identity response", () => {
  it("reads a usable head without downloading a large page body", async () => {
    const head = '<html><head><title>이니스프리 | 공식몰</title><meta name="description" content="화장품 공식몰"></head>';
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
    const identity = extractOfficialSiteIdentity(html, "https://www.innisfree.com/");
    expect(identity?.title).toContain("이니스프리");
    expect(identity?.description).toBe("화장품 공식몰");
    expect(html.length).toBeLessThan(1000);
  });
});
