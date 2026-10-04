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
        ? "이 회차는 저장 당시와 현재의 집계 기준이 변경되어 화면 수치를 다시 계산했습니다. 이전에 받은 이메일·PDF의 숫자와 다를 수 있습니다. 이는 제품 효과나 성과 개선을 뜻하지 않습니다."
        : "The calculation rules changed after this run was saved, so the figures on this page were recalculated. They may differ from earlier emails or PDFs. This does not establish a product effect or improved results."}
    </aside>
  );
}
