import { describe, expect, it, vi } from "vitest";

import {
  describeRateLimitError,
  limitOrAllow,
  RateLimitTimeoutError,
} from "./limit-or-allow";

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

describe("limitOrAllow timeout", () => {
  it("treats the library's success:true + reason:timeout as unavailable and reports once", async () => {
    const onUnavailable = vi.fn();
    const decision = await limitOrAllow(
      {
        limit: vi.fn().mockResolvedValue({ success: true, reason: "timeout" }),
      },
      "k",
      onUnavailable
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("unavailable");
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable.mock.calls[0]?.[0]).toBeInstanceOf(
      RateLimitTimeoutError
    );
    expect(describeRateLimitError(onUnavailable.mock.calls[0]?.[0])).toEqual({
      kind: "timeout",
      name: "TimeoutError",
      status: null,
    });
  });
});

describe("describeRateLimitError", () => {
  it("never keeps the raw message (email, IP, short token, command args)", () => {
    const error = new Error(
      'WRONGPASS invalid or missing auth token, command was: ["evalsha","x",1,"203.0.113.7:reader@example.test","tok3n"] https://abc.upstash.io'
    );
    const summary = describeRateLimitError(error);
    const serialized = JSON.stringify(summary);
    for (const leak of [
      "reader@example.test",
      "203.0.113.7",
      "tok3n",
      "upstash.io",
      "evalsha",
      "WRONGPASS",
    ]) {
      expect(serialized).not.toContain(leak);
    }
    expect(summary).toEqual({ kind: "auth", name: "Error", status: null });
  });

  it("classifies network, status-code auth, and unknown failures", () => {
    expect(describeRateLimitError(new TypeError("fetch failed"))).toEqual({
      kind: "network",
      name: "TypeError",
      status: null,
    });
    const httpError = Object.assign(new Error("denied"), { status: 401 });
    expect(describeRateLimitError(httpError)).toEqual({
      kind: "auth",
      name: "Error",
      status: 401,
    });
    expect(describeRateLimitError("something odd")).toEqual({
      kind: "unknown",
      name: "Unknown",
      status: null,
    });
  });

  it("drops an unsafe error name", () => {
    const error = new Error("x");
    error.name = "reader@example.test";
    expect(describeRateLimitError(error).name).toBe("Unknown");
  });
});
