import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-10-20 운영 사고 회귀 시험: 레이트 리밋 저장소(Upstash)가 보관(Archived)돼
 * `limit()` 호출이 예외를 던져도 문의 폼·뉴스레터 구독은 진행돼야 한다.
 * 진짜 제한 초과(success:false)는 계속 막는다.
 */

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  send: vi.fn(),
  warn: vi.fn(),
  parseError: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@repo/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
  slidingWindow: () => ({}),
}));
vi.mock("@repo/rate-limit/keys", () => ({
  isRateLimitConfigured: () => true,
}));
vi.mock("@repo/email", () => ({ resend: { emails: { send: mocks.send } } }));
vi.mock("@repo/email/templates/contact", () => ({
  ContactTemplate: () => null,
}));
vi.mock("@repo/email/templates/newsletter-confirmation", () => ({
  NewsletterConfirmationEmail: () => null,
}));
vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}));
vi.mock("@repo/observability/error", () => ({
  parseError: mocks.parseError,
}));
vi.mock("@repo/database", () => ({
  database: {
    publisher: { findFirst: mocks.findFirst },
    newsletterSubscription: { upsert: mocks.upsert },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("@/env", () => ({
  env: {
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "synthetic",
    RESEND_FROM: "Findable <hello@example.test>",
  },
}));

import { contact } from "../app/[locale]/contact/actions/contact";
import { POST } from "../app/api/newsletter/subscribe/route";

const archived = new Error("Upstash: database is archived (synthetic)");

const subscribe = () =>
  POST(
    new Request("https://www.example.test/api/newsletter/subscribe", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({
        email: "reader@example.test",
        publisherSlug: "synthetic-publisher",
      }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ data: { id: "m1" }, error: null });
  mocks.findFirst.mockResolvedValue({ id: "p1", name: "Synthetic" });
  mocks.upsert.mockResolvedValue({});
});

describe("contact form rate limit", () => {
  it("sends the inquiry and logs once when the limiter call fails", async () => {
    mocks.limit.mockRejectedValue(archived);
    await expect(contact("이름", "a@example.test", "문의")).resolves.toEqual(
      {}
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]?.[1]).toMatchObject({
      scope: "contact-form",
    });
  });

  it("blocks with a code (no raw message) when over the limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });
    await expect(contact("이름", "a@example.test", "문의")).resolves.toEqual({
      error: "rate_limited",
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("sends normally when under the limit", async () => {
    mocks.limit.mockResolvedValue({ success: true });
    await expect(contact("이름", "a@example.test", "문의")).resolves.toEqual(
      {}
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("returns only a code when sending fails (raw error stays server-side)", async () => {
    mocks.limit.mockResolvedValue({ success: true });
    mocks.send.mockRejectedValue(new Error("resend 401 secret-ish detail"));
    const result = await contact("이름", "a@example.test", "문의");
    expect(result).toEqual({ error: "send_failed" });
    expect(JSON.stringify(result)).not.toContain("secret-ish");
    expect(mocks.parseError).toHaveBeenCalledTimes(1);
  });
});

describe("newsletter subscribe rate limit", () => {
  it("subscribes and logs once when the limiter call fails (no 500)", async () => {
    mocks.limit.mockRejectedValue(archived);
    const res = await subscribe();
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]?.[1]).toMatchObject({
      scope: "newsletter-subscribe",
    });
  });

  it("returns 429 when over the limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });
    const res = await subscribe();
    expect(res.status).toBe(429);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("subscribes normally when under the limit", async () => {
    mocks.limit.mockResolvedValue({ success: true });
    const res = await subscribe();
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
