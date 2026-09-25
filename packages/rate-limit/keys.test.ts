import { describe, expect, it } from "vitest";

import { resolveRedisEnv } from "./keys";

describe("resolveRedisEnv", () => {
  it("uses the variable names provided by the Vercel Upstash integration", () => {
    expect(
      resolveRedisEnv({
        UPSTASH_REDIS_REST_KV_REST_API_URL: "https://redis.example.com",
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "token",
      })
    ).toEqual({ url: "https://redis.example.com", token: "token" });
  });

  it("prefers the existing explicit variable names", () => {
    expect(
      resolveRedisEnv({
        UPSTASH_REDIS_REST_URL: "https://direct.example.com",
        UPSTASH_REDIS_REST_TOKEN: "direct",
        UPSTASH_REDIS_REST_KV_REST_API_URL: "https://integrated.example.com",
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "integrated",
      })
    ).toEqual({ url: "https://direct.example.com", token: "direct" });
  });
});
