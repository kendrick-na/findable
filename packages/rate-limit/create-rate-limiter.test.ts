import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createRateLimiter 가 Upstash Ratelimit 생성자에 timeout 을 실제로 넘기는지 확인한다.
 * (기본 5초 대기 대신 1초 — 2026-10-20 문의 폼·구독 fail-open 수정)
 */

const mocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  slidingWindow: vi.fn(() => "sliding-window-default"),
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = mocks.slidingWindow;
    constructor(config: unknown) {
      mocks.ctor(config);
    }
  }
  return { Ratelimit };
});
vi.mock("@upstash/redis", () => ({
  Redis: class {
    readonly marker = "synthetic-redis";
  },
}));
vi.mock("./keys", () => ({
  keys: () => ({
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "synthetic",
  }),
}));

import { createRateLimiter, RATE_LIMIT_TIMEOUT_MS } from "./index";

beforeEach(() => {
  mocks.ctor.mockClear();
});

describe("createRateLimiter", () => {
  it("passes timeout 1000ms to the Ratelimit constructor by default", () => {
    createRateLimiter({ limiter: "custom-limiter" as never, prefix: "p" });
    expect(RATE_LIMIT_TIMEOUT_MS).toBe(1000);
    expect(mocks.ctor).toHaveBeenCalledTimes(1);
    expect(mocks.ctor.mock.calls[0]?.[0]).toMatchObject({
      limiter: "custom-limiter",
      prefix: "p",
      timeout: 1000,
    });
  });

  it("keeps an explicit timeout when a caller sets one", () => {
    createRateLimiter({ limiter: "custom-limiter" as never, timeout: 250 });
    expect(mocks.ctor.mock.calls[0]?.[0]).toMatchObject({ timeout: 250 });
  });
});
