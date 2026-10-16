/**
 * 판별 JSON 에 매출 초안을 넣는 순수 함수 — 클라이언트 컴포넌트에서도 쓰므로
 * server-only 모듈(DB·http)을 import 하지 않는다.
 */

export interface RevenueBlock {
  ai_routed_annual: number;
  annual_revenue: number;
  miss_den?: number;
  miss_num?: number;
  miss_pct?: number;
  missed_annual?: number;
  missed_monthly?: number;
  monthly: number;
  revenue_source: string;
  [key: string]: unknown;
}

/**
 * 판별 JSON 글자 안의 copy.revenue_opportunity 만 바꾼 새 글자를 돌려준다(다른 칸은 그대로).
 * JSON 이 아니거나 객체가 아니면 null.
 */
export function applyRevenueBlock(
  reviewText: string,
  block: RevenueBlock
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reviewText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const draft = parsed as Record<string, unknown>;
  const copy =
    draft.copy && typeof draft.copy === "object" && !Array.isArray(draft.copy)
      ? (draft.copy as Record<string, unknown>)
      : {};
  return JSON.stringify(
    { ...draft, copy: { ...copy, revenue_opportunity: block } },
    null,
    2
  );
}
