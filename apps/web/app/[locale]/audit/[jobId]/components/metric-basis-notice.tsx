/** A correction disclosure, never a claim about customer outcomes. */
export function AuditMetricBasisNotice({
  adviceBasisChanged = false,
  locale,
  metricBasisChanged = false,
}: {
  adviceBasisChanged?: boolean;
  locale: string;
  metricBasisChanged?: boolean;
}) {
  const isKo = locale.startsWith("ko");
  const metricCopy = isKo
    ? "저장 이후 검증·집계 기준을 다시 적용하여 수치가 재계산되거나 표시가 보류될 수 있습니다."
    : "Verification or calculation rules were reapplied after this run was saved, so figures may be recalculated or withheld.";
  const adviceCopy = isKo
    ? "저장된 일부 실행 권고는 현재 근거 기준에 맞지 않아 화면에서 제외하거나 수정했습니다."
    : "Some saved action recommendations were removed or revised because they do not meet current evidence standards.";
  return (
    <aside
      aria-label={
        isKo ? "과거 결과 변경 안내" : "Historical result update notice"
      }
      className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-amber-100 text-sm"
      data-testid="audit-metric-basis-notice"
    >
      {metricBasisChanged && metricCopy} {adviceBasisChanged && adviceCopy}{" "}
      {isKo
        ? "현재 화면은 이전에 받은 이메일·PDF와 다를 수 있습니다. 이 변경 자체는 제품 효과나 성과 개선을 뜻하지 않습니다."
        : "This page may differ from earlier emails or PDFs. The change itself does not establish a product effect or improved results."}
    </aside>
  );
}
