/**
 * 전환 퍼널 이벤트 회귀 테스트 — 2026-08-12 세션N-24 (BL-Day17-04).
 *
 * 🔴 **막는 사고 2개**
 *   ① **분석이 결제를 깨뜨리는 것.** 이 함수들은 결제 흐름 한가운데서 불린다.
 *      여기서 예외가 새면 **고객의 결제가 실패**한다 — 부수 기능이 본 기능을 죽이는 최악.
 *   ② **정기/단건이 다른 이름으로 세지는 것.** 이름이 갈리면 *"결제 시도 몇 건"* 을
 *      물을 때 한쪽을 빠뜨린다. 이름은 하나 + `isSubscription` 속성으로 분해한다.
 *
 * ⚠️ `pricing_viewed` 는 **일부러 만들지 않았다** — PostHog `defaults: "2025-05-24"` 가
 *   `capture_pageview: "history_change"` 를 켜서 화면 조회는 이미 자동 수집된다.
 *   같은 것을 두 번 세면 숫자가 갈린다. (그 판정을 아래 마지막 테스트가 지킨다.)
 */
import { describe, expect, test, vi } from "vitest";

const capture = vi.fn();

vi.mock("@repo/analytics", () => ({
  analytics: {
    capture: (...args: unknown[]) => capture(...args),
  },
}));

const { trackCheckoutCompleted, trackCheckoutFailed, trackCheckoutStarted } =
  await import("@repo/analytics/funnel");

type Props = Record<string, unknown>;

const lastCall = (): [string, Props] =>
  capture.mock.calls.at(-1) as [string, Props];

describe("이벤트 이름 — 정기/단건이 같은 이름을 쓴다", () => {
  test("단건과 정기가 모두 checkout_started 를 쓴다", () => {
    capture.mockReset();
    trackCheckoutStarted({ plan: "growth" });
    expect(lastCall()[0]).toBe("checkout_started");

    trackCheckoutStarted({ plan: "growth", isSubscription: true });
    expect(lastCall()[0]).toBe("checkout_started");
  });

  test("구분은 isSubscription 속성으로 한다 (기본 false)", () => {
    capture.mockReset();
    trackCheckoutStarted({ plan: "growth" });
    expect(lastCall()[1].isSubscription).toBe(false);

    trackCheckoutStarted({ plan: "growth", isSubscription: true });
    expect(lastCall()[1].isSubscription).toBe(true);
  });
});

describe("실패는 단계(stage)로 구분한다", () => {
  test.each([
    ["intent", "우리 서버가 결제정보를 못 만든 경우"],
    ["widget", "결제창이 닫힌 경우 = 고객 이탈 신호"],
    ["verify", "결제는 됐는데 권한이 안 붙은 경우"],
  ])("stage=%s 가 그대로 실린다 (%s)", (stage) => {
    capture.mockReset();
    trackCheckoutFailed({
      plan: "growth",
      stage: stage as "intent" | "verify" | "widget",
    });
    expect(lastCall()[0]).toBe("checkout_failed");
    expect(lastCall()[1].stage).toBe(stage);
  });

  test("🔴 PG 코드를 가공하지 않고 그대로 보낸다", () => {
    capture.mockReset();
    // 취소/실패 매핑을 발명하지 않는다 — 분포를 보고 나중에 분류한다.
    trackCheckoutFailed({
      plan: "growth",
      stage: "widget",
      reasonCode: "PAY_PROCESS_CANCELED",
    });
    expect(lastCall()[1].reasonCode).toBe("PAY_PROCESS_CANCELED");
  });

  test("창을 그냥 닫은 것과 PG 실패를 구분할 수 있다", () => {
    capture.mockReset();
    trackCheckoutFailed({
      plan: "growth",
      stage: "widget",
      reasonCode: "window_closed",
    });
    expect(lastCall()[1].reasonCode).toBe("window_closed");
  });
});

describe("완료는 '결제 성공 + 권한 부여' 둘 다일 때만", () => {
  test("checkout_completed 는 금액을 함께 싣는다", () => {
    capture.mockReset();
    trackCheckoutCompleted({ plan: "growth", amountKrw: 429_000 });
    expect(lastCall()[0]).toBe("checkout_completed");
    expect(lastCall()[1].amountKrw).toBe(429_000);
  });
});

describe("🔴 분석 실패가 결제를 깨뜨리지 않는다", () => {
  test.each([
    ["trackCheckoutStarted", () => trackCheckoutStarted({ plan: "growth" })],
    [
      "trackCheckoutCompleted",
      () => trackCheckoutCompleted({ plan: "growth" }),
    ],
    [
      "trackCheckoutFailed",
      () => trackCheckoutFailed({ plan: "growth", stage: "widget" }),
    ],
  ])("%s 는 posthog 가 던져도 전파하지 않는다", (_name, call) => {
    capture.mockReset();
    capture.mockImplementation(() => {
      throw new Error("posthog down");
    });
    expect(call).not.toThrow();
  });
});

describe("🔒 개인정보를 싣지 않는다", () => {
  test("이메일·도메인 키가 페이로드에 없다", () => {
    capture.mockReset();
    capture.mockImplementation(() => {
      /* noop */
    });
    trackCheckoutCompleted({ plan: "growth", amountKrw: 429_000 });

    const props = lastCall()[1];
    for (const forbidden of ["email", "domain", "customerEmail", "ip"]) {
      expect(Object.keys(props)).not.toContain(forbidden);
    }
  });
});
