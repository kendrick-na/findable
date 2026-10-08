import { log } from "@repo/observability/log";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyMentions } from "./mention-verdict";
import {
  isVerdictV3ShadowEnabled,
  verifyMentionV3,
} from "./mention-verdict-v3";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./mention-verdict-v3", () => ({
  isVerdictV3ShadowEnabled: vi.fn(() => true),
  verifyMentionV3: vi.fn(),
}));

// 브랜드명이 없는 답변 → v2 는 규칙(absent)으로 끝나 LLM 을 부르지 않는다.
const row = (i: number) => ({
  brandMentioned: false,
  errorMessage: null,
  rawResponse: `일반적인 쇼핑 추천 답변 ${i}`,
  citedSources: [],
});
const rows = Array.from({ length: 8 }, (_, i) => row(i));
const brand = { brandName: "인디고차일드", brandDomain: "indigochild.kr" };

afterEach(() => {
  vi.mocked(verifyMentionV3).mockReset();
  vi.mocked(isVerdictV3ShadowEnabled).mockReturnValue(true);
  vi.mocked(log.info).mockClear();
});

describe("shadow v3 never extends the v2 critical path", () => {
  it("starts shadow v3 only after every v2 chunk has finished", async () => {
    const order: string[] = [];
    vi.mocked(verifyMentionV3).mockImplementation(() => {
      order.push("v3");
      return Promise.resolve({
        counted: false,
        quality: "absent",
        via: "rule",
      });
    });

    const out = await verifyMentions(rows, brand, ({ chunkIndex, phase }) => {
      order.push(`v2:${chunkIndex}:${phase}`);
    });

    expect(order.slice(0, 4)).toEqual([
      "v2:0:started",
      "v2:0:finished",
      "v2:1:started",
      "v2:1:finished",
    ]);
    expect(order.slice(4)).toEqual(new Array(8).fill("v3"));
    expect(out.every((r) => r.verdictV3?.quality === "absent")).toBe(true);
  });

  it("skips shadow v3 and logs the reason when under 60s of budget remain", async () => {
    const out = await verifyMentions(rows, {
      ...brand,
      shadowDeadlineAtMs: Date.now() + 30_000,
    });

    expect(verifyMentionV3).not.toHaveBeenCalled();
    expect(out.some((r) => "verdictV3" in r)).toBe(false);
    expect(log.info).toHaveBeenCalledWith(
      "mention.verdict_v3.shadow_skipped",
      expect.objectContaining({ reason: "budget", skippedRows: 8 })
    );
  });

  it("keeps v2 output identical whether the shadow runs, is skipped or is off", async () => {
    vi.mocked(verifyMentionV3).mockResolvedValue({
      counted: true,
      quality: "confirmed",
      via: "llm",
    });
    const withShadow = await verifyMentions(rows, brand);
    const skipped = await verifyMentions(rows, {
      ...brand,
      shadowDeadlineAtMs: Date.now(),
    });
    vi.mocked(isVerdictV3ShadowEnabled).mockReturnValue(false);
    const off = await verifyMentions(rows, brand);

    const strip = (list: typeof withShadow) =>
      list.map(({ verdictV3: _shadow, ...rest }) => rest);
    expect(strip(withShadow)).toEqual(off);
    expect(skipped).toEqual(off);
    expect(withShadow.every((r) => r.verdictV3?.quality === "confirmed")).toBe(
      true
    );
  });
});
