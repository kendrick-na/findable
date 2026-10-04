import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AuditMetricBasisNotice } from "../app/[locale]/audit/[jobId]/components/metric-basis-notice";

it("tells readers that the current figures may differ from immutable older copies", () => {
  const ko = renderToStaticMarkup(<AuditMetricBasisNotice locale="ko" />);
  const en = renderToStaticMarkup(<AuditMetricBasisNotice locale="en" />);

  expect(ko).toContain("집계 기준이 변경");
  expect(ko).toContain("이전에 받은 이메일·PDF");
  expect(ko).not.toContain("성과가 개선");
  expect(en).toContain("calculation rules changed");
  expect(en).toContain("earlier emails or PDFs");
});
