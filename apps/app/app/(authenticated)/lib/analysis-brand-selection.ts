export function selectAnalysisBrandId(
  brandIds: string[],
  requestedBrandId?: string,
  latestAuditBrandId?: string | null
): string | null {
  const candidate = requestedBrandId ?? latestAuditBrandId;
  return brandIds.find((id) => id === candidate) ?? brandIds[0] ?? null;
}
