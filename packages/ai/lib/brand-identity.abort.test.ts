import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();

vi.mock("ai", () => ({ generateObject }));

describe("brand identity deadline contract", () => {
  beforeEach(() => generateObject.mockReset());

  it("stops before any LLM call when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("deadline", "AbortError"));
    const { resolveBrandIdentity } = await import("./brand-identity");

    await expect(
      resolveBrandIdentity("long-tail.example", undefined, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generateObject).not.toHaveBeenCalled();
  });
});
