import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { VERCEL_PROJECT_PRODUCTION_URL: "www.findable.co.kr" },
}));

import { Faq } from "../app/[locale]/(home)/components/faq";
import { GET } from "../app/ai-instructions/route";

describe("public definition of appearance rates", () => {
  it("defines GEO's stored rate as mixed and AI-only rate as adjudicated answers", async () => {
    const body = await GET().text();
    expect(body).toContain("AI·검색 합산 등장률");
    expect(body).toContain("판정이 끝난 AI 답변");
  });

  it.each([
    "ko",
    "en",
  ])("%s FAQ separates AI answers from the stored mixed rate", (locale) => {
    const html = renderToStaticMarkup(<Faq locale={locale} />);
    expect(html).toMatch(/AI·검색 합산 등장률|AI and search appearance rate/);
  });
});
