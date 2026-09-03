function hostname(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  try {
    return new URL(
      normalized.includes("://") ? normalized : `https://${normalized}`
    ).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** 브랜드 준비도는 등록된 도메인만 측정·표시해 다른 고객사 결과가 섞이지 않게 한다. */
export function readinessUrlMatchesBrand(
  url: string,
  brandDomain: string
): boolean {
  const target = hostname(url);
  const brand = hostname(brandDomain);
  return Boolean(target && brand && target === brand);
}
