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
  expect(html).toContain("kendrick@indigochild.kr");
  expect(html).toContain("[시행일: 확인필요]");
});

it("en terms no longer promise annual billing and render the aligned billing clauses", async () => {
  const html = await renderTerms("en");
  expect(html).not.toContain("monthly or annually");
  expect(html).toContain("one-month pass (single payment)");
  expect(html).toContain("Article 4-2 (Cancellation and failed renewals)");
  expect(html).toContain("Article 4-3 (Withdrawal and refunds)");
  expect(html).toContain("[effective date: to be confirmed]");
});
