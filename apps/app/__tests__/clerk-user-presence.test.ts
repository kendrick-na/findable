/**
 * Clerk 사용자 존재 확인 — 늦은 웹훅 부활 방지(2026-10-20).
 * 404 만 「없음」으로 보고, 그 밖의 실패는 던져서 웹훅이 500(재시도)을 돌려주게 한다.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/auth/server", () => ({
  clerkClient: () => {
    throw new Error("테스트는 getUser 를 주입한다 — 실제 Clerk 호출 금지");
  },
}));

const { clerkUserPresence } = await import("@/lib/privacy/clerk-user-presence");

const clerkError = (status: number) =>
  Object.assign(new Error(`clerk ${status}`), { status });

describe("clerkUserPresence", () => {
  it("조회되면 exists", async () => {
    await expect(
      clerkUserPresence("user_1", () => Promise.resolve({ id: "user_1" }))
    ).resolves.toBe("exists");
  });

  it("404 면 gone", async () => {
    await expect(
      clerkUserPresence("user_1", () => Promise.reject(clerkError(404)))
    ).resolves.toBe("gone");
  });

  it.each([
    500, 429, 401,
  ])("%s 는 던진다(없다고 단정하지 않는다)", async (status) => {
    await expect(
      clerkUserPresence("user_1", () => Promise.reject(clerkError(status)))
    ).rejects.toThrow(`clerk ${status}`);
  });

  it("상태 없는 네트워크 오류도 던진다", async () => {
    await expect(
      clerkUserPresence("user_1", () => Promise.reject(new Error("ECONNRESET")))
    ).rejects.toThrow("ECONNRESET");
  });
});
