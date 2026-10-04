/** A correction disclosure, never a claim about customer outcomes. */
export function AuditMetricBasisNotice({ locale }: { locale: string }) {
  const isKo = locale.startsWith("ko");
  return (
    <aside
      aria-label={isKo ? "집계 기준 변경 안내" : "Calculation update notice"}
      className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-amber-100 text-sm"
      data-testid="audit-metric-basis-notice"
    >
      {isKo
        ? "이 회차는 저장 이후 검증·집계 기준이 변경되어 현재 화면에 다시 적용했습니다. 수치가 재계산되거나 표시가 보류될 수 있으며, 이전에 받은 이메일·PDF의 내용과 다를 수 있습니다. 이 변경 자체는 제품 효과나 성과 개선을 뜻하지 않습니다."
        : "Verification or calculation rules changed after this run was saved and were reapplied here. Figures may be recalculated or withheld, and this page may differ from earlier emails or PDFs. The change itself does not establish a product effect or improved results."}
    </aside>
  );
}
