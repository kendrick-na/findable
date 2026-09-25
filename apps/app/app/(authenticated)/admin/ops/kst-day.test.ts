import { describe, expect, it } from "vitest";
import { startOfKoreanDay } from "./kst-day";

describe("startOfKoreanDay", () => {
  it("uses Seoul midnight on a UTC server", () => {
    expect(startOfKoreanDay(new Date("2026-09-25T14:59:59Z")).toISOString())
      .toBe("2026-09-24T15:00:00.000Z");
    expect(startOfKoreanDay(new Date("2026-09-25T15:00:00Z")).toISOString())
      .toBe("2026-09-25T15:00:00.000Z");
  });
});
