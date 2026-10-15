import { describe, expect, test } from "vitest";
import { formatDisplayDate } from "../lib/format-date";

describe("formatDisplayDate — 한국 시간 기준 날짜", () => {
  // 2026-10-15T17:03:35Z = 한국 시간 2026-10-16 02:03
  const lateUtc = new Date("2026-10-15T17:03:35.896Z");

  test("UTC 로는 전날인 새벽 발행 글이 한국 날짜로 표시된다", () => {
    expect(formatDisplayDate(lateUtc, "ko")).toBe("2026. 10. 16.");
    expect(formatDisplayDate(lateUtc, "ko-KR")).toBe("2026. 10. 16.");
    expect(formatDisplayDate(lateUtc, "en-US")).toBe("10/16/2026");
  });

  test("한국 시간 낮에 올린 글은 그대로", () => {
    expect(formatDisplayDate(new Date("2026-08-28T14:37:13Z"), "ko")).toBe(
      "2026. 8. 28."
    );
  });

  test("날짜가 없으면 undefined", () => {
    expect(formatDisplayDate(null, "ko")).toBeUndefined();
    expect(formatDisplayDate(undefined, "en")).toBeUndefined();
  });
});
