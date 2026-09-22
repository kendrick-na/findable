/**
 * 카카오페이는 빌링키 발급 창에도 최초 주문 금액을 요구한다.
 * PortOne V2에서 이 값은 발급 창 표시용이므로, 실제 초회 청구는 서버의
 * `payWithBillingKey` 한 곳에서만 수행한다.
 */
export function kakaoBillingKeyDisplayAmount(amount: number) {
  return {
    displayAmount: amount,
    currency: "KRW" as const,
  };
}
