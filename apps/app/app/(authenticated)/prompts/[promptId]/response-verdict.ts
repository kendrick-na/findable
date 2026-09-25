/** Tracking rows predate the current entity-verdict schema. Never call them confirmed. */
export function responseVerdict(response: {
  brandMentioned: boolean;
  errorMessage: string | null;
}) {
  if (response.errorMessage) {
    return { label: "응답 수집 실패", tone: "text-amber-300 text-xs" };
  }
  if (response.brandMentioned) {
    return {
      label: "저장된 언급 후보 · 재확인 필요",
      tone: "text-emerald-300 text-xs",
    };
  }
  return {
    label: "저장된 판정: 해당 브랜드 미확인",
    tone: "text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs",
  };
}
