import { describe, expect, it } from "vitest";
import {
  extractOfficialSiteIdentity,
  readIdentityHtml,
} from "./official-site-identity";

describe("official site identity response", () => {
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
});
