import { describe, expect, test } from "vitest";
import { describeSubscriptionError } from "@/lib/billing/subscription-error";

describe("describeSubscriptionError", () => {
  test("keeps a PortOne error code and message visible without serializing extra fields", () => {
    expect(
      describeSubscriptionError({
        code: "CHANNEL_NOT_FOUND",
        message: "channelKey is not correct.",
        billingKey: "must-never-be-displayed",
      })
    ).toBe("CHANNEL_NOT_FOUND: channelKey is not correct.");
  });

  test("uses a safe fallback for an unknown exception", () => {
    expect(describeSubscriptionError(null)).toBe("알 수 없는 오류");
  });
});
