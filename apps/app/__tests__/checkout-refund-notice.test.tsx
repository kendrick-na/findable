import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 결제 전 청약철회·환불 고지 (전자상거래법 제13조 제2항·제17조 제6항, 2026-10-05).
 *
 * 🔴 막는 사고: 고지 없이 결제되면 이용일수 공제를 주장할 수 없다(전상법 제17조 제2항 단서·
 *   제6항 → 전액 환불). 정기결제·1회 결제·법인카드 결제 **모두** 결제창을 열기 전에
 *   ① 7일 청약철회·방법·효과 ② 유료 기능 이용 시 이용일수 공제 ③ 해지 안내 ④ 약관 링크를
 *   보여 주고, 확인 체크 전에는 결제 버튼이 눌리지 않아야 한다.
 *
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_PORTONE_STORE_ID = "store-test";
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY = "channel-easy-pay";
  process.env.NEXT_PUBLIC_PORTONE_CARD_CHANNEL_KEY = "channel-card";
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY_BILLING = "channel-billing";
});

const mocks = vi.hoisted(() => ({
  requestPayment: vi.fn(),
  requestIssueBillingKey: vi.fn(),
  createCheckoutIntent: vi.fn(),
  createSubscribeIntent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@portone/browser-sdk/v2", () => ({
  requestPayment: mocks.requestPayment,
  requestIssueBillingKey: mocks.requestIssueBillingKey,
}));
vi.mock("@repo/auth/client", () => ({
  useUser: () => ({ user: null }),
}));
vi.mock("@repo/analytics/funnel", () => ({
  trackCheckoutCompleted: vi.fn(),
  trackCheckoutFailed: vi.fn(),
  trackCheckoutStarted: vi.fn(),
}));
vi.mock("@/app/actions/billing/checkout", () => ({
  createCheckoutIntent: mocks.createCheckoutIntent,
  verifyPaymentAndGrant: vi.fn(),
}));
vi.mock("@/app/actions/billing/subscription", () => ({
  createSubscribeIntent: mocks.createSubscribeIntent,
  confirmSubscription: vi.fn(),
}));

import { SubscribeButton } from "../app/(authenticated)/features/billing/subscribe-button";
import { UpgradeButton } from "../app/(authenticated)/features/billing/upgrade-button";

const TERMS = "https://findable.test/ko/legal/terms";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 고지에 반드시 있어야 할 문장 조각. 빠진 것만 돌려준다(없으면 빈 배열). */
const REQUIRED_NOTICE = [
  "7일 이내",
  "청약철회",
  "유료 기능(자동 재측정·측정 데이터 내보내기)을 이용하면 이용일수만큼 공제",
  "환불·청약철회 요청",
  "kendrick@indigochild.kr",
  "3영업일",
  // 약관 제4조의3 제4항(2026-10-12 시행): 중도 해지도 이용일수만 공제, 위약금·수수료 0%
  "7일이 지난 뒤 이용 중에 해지·환불을 요청해도 이용일수만 공제",
  "위약금·수수료는 없어요",
];
/** 약관과 어긋나는 옛 문구(잔여 요금 10% 공제 초안). 보이면 실패. */
const FORBIDDEN_NOTICE = ["10%", "잔여 기간"];
const missingNotice = (text: string) => [
  ...REQUIRED_NOTICE.filter((phrase) => !text.includes(phrase)),
  ...FORBIDDEN_NOTICE.filter((phrase) => text.includes(phrase)).map(
    (phrase) => `forbidden: ${phrase}`
  ),
];

describe("정기결제 — 결제 전 환불·해지 고지와 확인 체크", () => {
  const renderSubscribe = () =>
    render(
      <SubscribeButton
        chargedPrice={108_900}
        contactHref="https://findable.test/ko/contact"
        label="Starter 월 자동결제 시작"
        listPrice={99_000}
        notice={koDict.app.purchaseNotice}
        plan="starter"
        t={koDict.app.subscribe}
        termsHref={TERMS}
      />
    );

  it("고지를 보여 주고, 확인 체크 전에는 결제 버튼이 비활성이다", () => {
    const view = renderSubscribe();
    fireEvent.click(view.getByText("Starter 월 자동결제 시작"));

    const body = view.container.textContent ?? "";
    expect(missingNotice(body)).toEqual([]);
    expect(body).toContain("언제든 해지");
    expect(body).toContain("다음 결제는 청구되지 않");
    expect(body).toContain("이미 결제한 기간이 끝날 때까지 이용");

    const terms = view.getByRole("link", { name: /이용약관/ });
    expect(terms.getAttribute("href")).toBe(TERMS);

    const pay = view.getByRole("button", { name: "동의하고 정기결제 시작" });
    expect((pay as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pay);
    expect(mocks.createSubscribeIntent).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("checkbox"));
    expect((pay as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("1회 결제 — 결제창 전에 고지와 확인 체크", () => {
  const renderOneOff = (paymentMethod?: "card") =>
    render(
      <UpgradeButton
        contactHref="https://findable.test/ko/contact"
        label={paymentMethod ? "법인카드로 결제하기" : "1회만 결제하기"}
        notice={koDict.app.purchaseNotice}
        paymentMethod={paymentMethod}
        plan="starter"
        t={koDict.app.upgrade}
        termsHref={TERMS}
      />
    );

  it("첫 클릭은 결제창을 열지 않고 고지를 보여 준다", () => {
    const view = renderOneOff();
    fireEvent.click(view.getByText("1회만 결제하기"));

    expect(mocks.createCheckoutIntent).not.toHaveBeenCalled();
    expect(mocks.requestPayment).not.toHaveBeenCalled();
    const body = view.container.textContent ?? "";
    expect(missingNotice(body)).toEqual([]);
    expect(body).toContain("자동으로 갱신되지 않");
    expect(
      view.getByRole("link", { name: /이용약관/ }).getAttribute("href")
    ).toBe(TERMS);
    expect(view.getByText("위 내용을 확인했습니다.")).toBeTruthy();
  });

  it("확인 체크 전에는 결제 버튼이 비활성, 체크하면 활성", () => {
    const view = renderOneOff("card");
    fireEvent.click(view.getByText("법인카드로 결제하기"));

    const pay = view.getByRole("button", { name: "동의하고 결제하기" });
    expect((pay as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pay);
    expect(mocks.createCheckoutIntent).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("checkbox"));
    expect((pay as HTMLButtonElement).disabled).toBe(false);
  });

  it("취소하면 고지를 닫고 원래 버튼으로 돌아간다", () => {
    const view = renderOneOff();
    fireEvent.click(view.getByText("1회만 결제하기"));
    fireEvent.click(view.getByRole("button", { name: "취소" }));
    expect(view.queryByRole("checkbox")).toBeNull();
    expect(view.getByText("1회만 결제하기")).toBeTruthy();
  });
});
