import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AuditSummarySsr } from "../app/[locale]/audit/[jobId]/components/audit-summary-ssr";

it("does not call mixed search exposure an AI mention in the public SSR summary", () => {
  const html = renderToStaticMarkup(
    <AuditSummarySsr
      job={
        {
          domain: "example.com",
          status: "completed",
          result: {
            brandName: "Example",
            engineResponses: [
              {
                engineId: "chatgpt",
                brandMentioned: false,
                promptKind: "brand",
              },
              { engineId: "naver", brandMentioned: true, promptKind: "brand" },
            ],
            geoActions: [],
            metrics: {
              enginesCovered: ["chatgpt", "naver"],
              enginesWithMention: ["naver"],
              sov: 50,
            },
          },
        } as never
      }
      locale="ko"
    />
  );
  expect(html).toContain("엔진 기준 · AI·검색 노출 확인");
  expect(html).toContain("1/2");
  expect(html).not.toContain("우리를 말한 AI");
  expect(html).toContain("AI·검색 합산 등장률");
});
