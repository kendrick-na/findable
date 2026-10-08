import enDict from "@repo/internationalization/dictionaries/en.json";
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PurchaseNotice } from "../app/(authenticated)/features/billing/purchase-notice";

/** 구매 안내를 실제로 그려 본다 — 한국어는 예전 문장 그대로, 영어는 공개 영문 약관 문장. */
describe("PurchaseNotice render", () => {
  it("한국어: 기존 고지 문장이 그대로 나온다", () => {
    const { container } = render(
      <PurchaseNotice
        kind="subscription"
        t={koDict.app.purchaseNotice}
        termsHref="/t"
      />
    );
    expect(container.textContent).toContain("청약철회·환불 안내");
    expect(container.textContent).toContain(
      "결제일부터 7일 이내에 청약철회할 수 있어요."
    );
    expect(container.textContent).toContain("이메일(kendrick@indigochild.kr)");
  });

  it("영어: 약관 문장과 이메일이 채워져 나온다", () => {
    const { container } = render(
      <PurchaseNotice
        kind="one-off"
        t={enDict.app.purchaseNotice}
        termsHref="/t"
      />
    );
    expect(container.textContent).toContain("Withdrawal and refunds");
    expect(container.textContent).toContain(
      "by email (kendrick@indigochild.kr)"
    );
    expect(container.textContent).toContain(
      "A one-month pass does not renew automatically."
    );
    expect(container.textContent).not.toContain("{email}");
  });
});
