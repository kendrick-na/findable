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
  // 제4조의3 제5항: 앱 내 요청 버튼과 같은 이름
  expect(html).toContain("요금제 화면의 「환불·청약철회 요청」 또는 이메일");
});

it("ko terms charge no mid-term cancellation fee (0%, approved 2026-10-05)", async () => {
  const html = await renderTerms("ko");
  expect(html).not.toContain("10%");
  expect(html).not.toContain("잔여 기간 이용요금");
  expect(html).toContain(
    "결제 금액에서 결제일부터 해지일까지의 이용일수에 해당하는 금액"
  );
  expect(html).toContain("위약금이나 수수료는 청구하지 않습니다");
});

it("ko terms use consumer-domicile jurisdiction instead of a fixed court", async () => {
  const html = await renderTerms("ko");
  expect(html).not.toContain("청주지방법원");
  expect(html).toContain("「민사소송법」에 따른 관할 법원");
  expect(html).toContain(
    "이용자가 소비자인 경우에는 소 제기 당시 이용자의 주소를, 주소가 없는 경우에는 거소를 관할하는 지방법원의 전속관할"
  );
});

it("ko terms state the announcement and effective dates", async () => {
  const html = await renderTerms("ko");
  expect(html).not.toContain("확인필요");
  expect(html).toContain(
    "2026년 10월 5일에 공지하고 2026년 10월 12일부터 시행됩니다"
  );
  expect(html).toContain("최종 업데이트 · <!-- -->2026년 10월 5일");
});

it("ko terms render the key summary box above the articles", async () => {
  const html = await renderTerms("ko");
  const summaryAt = html.indexOf("핵심 요약");
  const firstArticleAt = html.indexOf("제1조 (목적)");
  expect(summaryAt).toBeGreaterThan(-1);
  expect(summaryAt).toBeLessThan(firstArticleAt);
  const items = html.slice(summaryAt, firstArticleAt).match(/<li>/g) ?? [];
  expect(items.length).toBeGreaterThanOrEqual(5);
  expect(items.length).toBeLessThanOrEqual(7);
  expect(html).toContain("갱신 결제가 실패하면 결제 예정일부터 7일 동안");
  expect(html).toContain("위약금이나 수수료는 받지 않아요");
  expect(html).toContain("3영업일 안에");
  expect(html).toContain("요약과 아래 약관 본문이 다르면 본문이 우선해요");
});

it("privacy policy renders no summary box", async () => {
  const element = await LegalPage({
    params: Promise.resolve({ slug: "privacy", locale: "ko" }),
  });
  expect(renderToString(element)).not.toContain("핵심 요약");
});

it("en terms no longer promise annual billing and render the aligned billing clauses", async () => {
  const html = await renderTerms("en");
  expect(html).not.toContain("monthly or annually");
  expect(html).toContain("one-month pass (single payment)");
  expect(html).toContain("Article 4-2 (Cancellation and failed renewals)");
  expect(html).toContain("Article 4-3 (Withdrawal and refunds)");
  expect(html).toContain("within 3 business days");
  expect(html).not.toContain("limited to the unused portion");
  expect(html).not.toContain("10%");
  expect(html).toContain("with no penalty or fee");
  expect(html).not.toContain("Cheongju");
  expect(html).toContain("exclusive jurisdiction");
  expect(html).not.toContain("to be confirmed");
  expect(html).toContain(
    "announced on October 5, 2026 and take effect on October 12, 2026"
  );
  expect(html).toContain("Key summary");
  expect(html).toContain(
    "If it differs from the terms below, the terms prevail."
  );
});
