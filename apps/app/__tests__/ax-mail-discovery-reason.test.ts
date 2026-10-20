/** @vitest-environment node */
import { describe, expect, test } from "vitest";
import { ingestReasonCode } from "@/lib/ax-mail/discovery/ingest-reason";

const base = { fetched: 0, result: null, source: "fsc" as const };

describe("실패 이유 코드 — 원천 결과를 화면 이유로 바꾼다", () => {
  test("ok → ok", () => {
    expect(ingestReasonCode({ ...base, status: "ok" })).toBe("ok");
  });
  test("partial(예산 소진) → timeout", () => {
    expect(ingestReasonCode({ ...base, status: "partial" })).toBe("timeout");
  });
  test("unavailable(키 없음·응답 없음) → source_unavailable", () => {
    expect(ingestReasonCode({ ...base, status: "unavailable" })).toBe(
      "source_unavailable"
    );
  });
  test("error → error (다른 원천은 계속된다)", () => {
    expect(ingestReasonCode({ ...base, status: "error" })).toBe("error");
  });
});
