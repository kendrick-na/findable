import { AuditReportEmail } from "@repo/email/templates/audit-report";
import { renderToReadableStream } from "react-dom/server";
import { expect, it } from "vitest";

it("names AI answers and search exposure separately in the audit email", async () => {
  const stream = await renderToReadableStream(
    <AuditReportEmail
      brandName="Example"
      domain="example.com"
      enginesMentioned={1}
      enginesTotal={2}
      geoScore={50}
      resultUrl="https://findable.example/ko/audit/example"
      tierLabel="경쟁 가능"
    />
  );
  const html = await new Response(stream).text();
  expect(html).toContain("AI·검색");
  expect(html).not.toContain("AI 엔진 2개 중 1개");
});

it("does not invent a coverage ratio when stored answer rows are unavailable", async () => {
  const stream = await renderToReadableStream(
    <AuditReportEmail
      brandName="Example"
      domain="example.com"
      enginesMentioned={null}
      enginesTotal={null}
      geoScore={50}
      resultUrl="https://findable.example/ko/audit/example"
      tierLabel="경쟁 가능"
    />
  );
  const html = await new Response(stream).text();
  expect(html).toContain("산출할 수 없습니다");
  expect(html).not.toContain("0곳 중 0곳");
});
