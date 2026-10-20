import { describe, expect, it, vi } from "vitest";

import { describeRateLimitError, limitOrAllow } from "./limit-or-allow";

describe("limitOrAllow", () => {
  it("allows when the limiter answers success", async () => {
    const onUnavailable = vi.fn();
    const decision = await limitOrAllow(
      { limit: vi.fn().mockResolvedValue({ success: true }) },
      "k",
      onUnavailable
    );
    expect(decision).toEqual({ allowed: true, reason: "ok" });
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("blocks when the limiter answers success:false (real over-limit)", async () => {
    const onUnavailable = vi.fn();
    const decision = await limitOrAllow(
      { limit: vi.fn().mockResolvedValue({ success: false }) },
      "k",
      onUnavailable
    );
    expect(decision).toEqual({ allowed: false, reason: "limited" });
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("fails open and reports once when the limiter call itself throws", async () => {
    const onUnavailable = vi.fn();
    const failure = new Error("database is archived");
    const decision = await limitOrAllow(
      { limit: vi.fn().mockRejectedValue(failure) },
      "k",
      onUnavailable
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("unavailable");
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith(failure);
  });

  it("still fails open when the reporter itself throws", async () => {
    const decision = await limitOrAllow(
      { limit: vi.fn().mockRejectedValue(new Error("x")) },
      "k",
      () => {
        throw new Error("logger down");
      }
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("describeRateLimitError", () => {
  it("drops URLs and long token-like strings", () => {
    const text = describeRateLimitError(
      new Error(
        "fetch https://abc.upstash.io/pipeline failed AAAAbbbbCCCCddddEEEEffff1234"
      )
    );
    expect(text).not.toContain("upstash.io");
    expect(text).not.toContain("AAAAbbbbCCCCddddEEEEffff1234");
    expect(text).toBe("Error: fetch [url] failed [redacted]");
  });
});
