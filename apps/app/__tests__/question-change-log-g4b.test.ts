/**
 * 질문 변경 이력(G4b · 2026-10-14) — 측정 이력이 있는 브랜드만, 실패해도 본 동작을 막지 않는다.
 *
 * @vitest-environment node
 */
import koDict from "@repo/internationalization/dictionaries/ko.json";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  tracking: vi.fn(),
}));
vi.mock("@repo/database", () => ({
  database: {
    tracking: { findFirst: h.tracking },
    annotation: { create: h.create },
  },
}));
vi.mock("@repo/auth/server", () => ({
  auth: () => Promise.resolve({ userId: "user_1" }),
}));
vi.mock("@/lib/i18n", () => ({
  getAppDictionary: () => Promise.resolve(koDict.app),
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { recordQuestionChange } from "../lib/brand/question-change-log";

beforeEach(() => {
  h.create.mockReset();
  h.create.mockResolvedValue({});
  h.tracking.mockReset();
  h.tracking.mockResolvedValue({ id: "t1" });
});

describe("recordQuestionChange", () => {
  it("측정 이력이 있으면 주석을 남긴다(시각·행위자 포함)", async () => {
    await recordQuestionChange("b1", { kind: "added", count: 3 });
    expect(h.create).toHaveBeenCalledTimes(1);
    const data = h.create.mock.calls[0]?.[0].data;
    expect(data.brandId).toBe("b1");
    expect(data.createdBy).toBe("user_1");
    expect(data.label).toContain("3개 추가");
    expect(data.occurredAt).toBeInstanceOf(Date);
  });

  it("측정 이력이 없으면(첫 질문 세트) 남기지 않는다", async () => {
    h.tracking.mockResolvedValue(null);
    await recordQuestionChange("b1", { kind: "added", count: 20 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("긴 질문 문구는 60자 안으로 자른다", async () => {
    await recordQuestionChange("b1", {
      kind: "edited",
      text: "가".repeat(200),
    });
    expect(h.create.mock.calls[0]?.[0].data.label.length).toBeLessThanOrEqual(
      60
    );
  });

  it("기록이 실패해도 던지지 않는다", async () => {
    h.create.mockRejectedValue(new Error("db down"));
    await expect(
      recordQuestionChange("b1", { kind: "deleted", text: "질문" })
    ).resolves.toBeUndefined();
  });
});
