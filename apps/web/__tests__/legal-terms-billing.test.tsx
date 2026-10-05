import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import LegalPage from "../app/[locale]/legal/[slug]/page";

const renderTerms = async (locale: string): Promise<string> => {
  const element = await LegalPage({
    params: Promise.resolve({ slug: "terms", locale }),
  });
  return renderToString(element);
};

it("ko terms no longer promise annual billing and render the aligned billing clauses", async () => {
  const html = await renderTerms("ko");
  expect(html).not.toContain("월/연");
  expect(html).not.toContain("연 단위");
  expect(html).toContain(
    "월 단위 자동결제 또는 1개월 이용권(1회 결제) 방식으로 결제됩니다"
  );
  expect(html).toContain("제4조의2 (해지 및 갱신 결제 실패)");
  expect(html).toContain("이미 결제한 이용 기간의 종료일까지");
  expect(html).toContain("결제 예정일로부터 7일 동안 유료 기능 이용이 유지");
  expect(html).toContain("제4조의3 (청약철회 및 환불)");
  expect(html).toContain("이용 이력이 없는 경우 결제 금액 전액을 환불");
  // 전자상거래법 제17조 제2항 제5호 단서·제18조 제9항: 이용일수만 공제, 위약금 없음
  expect(html).toContain("이용일수에 해당하는 금액(결제 금액 × 이용일수 ÷");
  expect(html).toContain("위약금은 청구하지 않습니다");
  // 전자상거래법 제17조 제3항: 표시·광고와 다른 경우 3개월·30일
  expect(html).toContain(
    "3개월 이내, 그 사실을 안 날 또는 알 수 있었던 날부터 30일 이내"
  );
  // 전자상거래법 제18조 제2항: 3영업일 이내 환급
  expect(html).toContain("3영업일 이내에 결제대행사 포트원(PortOne)을 통해");
  // 근거 없는 "미사용분에 한해" 문구가 남지 않는다
  expect(html).not.toContain("미사용분에 한해");
  expect(html).toContain("kendrick@indigochild.kr");
  expect(html).toContain("[시행일: 확인필요]");
});

it("en terms no longer promise annual billing and render the aligned billing clauses", async () => {
  const html = await renderTerms("en");
  expect(html).not.toContain("monthly or annually");
  expect(html).toContain("one-month pass (single payment)");
  expect(html).toContain("Article 4-2 (Cancellation and failed renewals)");
  expect(html).toContain("Article 4-3 (Withdrawal and refunds)");
  expect(html).toContain("within 3 business days");
  expect(html).not.toContain("limited to the unused portion");
  expect(html).toContain("[effective date: to be confirmed]");
});
