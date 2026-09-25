import { describe, expect, it } from "vitest";
import { isPromptId } from "./prompt-id";

describe("isPromptId", () => {
  it("accepts real five-group prompt UUIDs", () => {
    expect(isPromptId("92006506-4ccd-4c6c-81a6-7a77916b5253")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isPromptId("92006506-4ccd-4c6c-7a77916b5253")).toBe(false);
    expect(isPromptId("../admin/orgs")).toBe(false);
  });
});
