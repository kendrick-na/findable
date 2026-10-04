import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AuditMetricBasisNotice } from "../app/[locale]/audit/[jobId]/components/metric-basis-notice";

it("tells readers that the current figures may differ from immutable older copies", () => {
  const ko = renderToStaticMarkup(
    <AuditMetricBasisNotice locale="ko" metricBasisChanged />
  );
  const en = renderToStaticMarkup(
    <AuditMetricBasisNotice locale="en" metricBasisChanged />
  );

  expect(ko).toContain("검증·집계 기준을 다시 적용");
  expect(ko).toContain("표시가 보류될 수");
  expect(ko).toContain("이전에 받은 이메일·PDF");
  expect(ko).not.toContain("성과가 개선");
  expect(en).toContain("Verification or calculation rules were reapplied");
  expect(en).toContain("may be recalculated or withheld");
  expect(en).toContain("earlier emails or PDFs");
});

it("does not imply a provisional run displays corrected action advice", () => {
  const ko = renderToStaticMarkup(
    <AuditMetricBasisNotice adviceBasisChanged locale="ko" provisional />
  );

  expect(ko).toContain("실행 권고는 판정 보류로 공개하지 않습니다");
  expect(ko).not.toContain("화면에서 제외하거나 수정했습니다");
  expect(ko).not.toContain("수치가 재계산");
});
