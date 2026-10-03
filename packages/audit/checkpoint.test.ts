import { describe, expect, it } from "vitest";
import {
  assertCheckpointProvenance,
  makeAuditCheckpoint,
  readAuditCheckpoint,
} from "./checkpoint";

const scope = {
  brandId: "brand-1",
  domain: "example.com",
  language: "both" as const,
  organizationId: "org-1",
};
const context = {
  brandName: "Example",
  brandVariants: ["예시"],
  identityGrounded: true,
  officialSiteIdentity: {
    finalUrl: "https://example.com",
    title: "Example",
    description: null,
    h1: null,
    siteName: null,
  },
};

describe("audit question checkpoint", () => {
  it("keeps a fixed question plan and completed-prefix responses", () => {
    const checkpoint = makeAuditCheckpoint(scope, context, [
      { text: "question 1", lang: "ko", kind: "brand" },
      { text: "question 2", lang: "en", kind: "discovery" },
    ]);
    expect(readAuditCheckpoint(checkpoint, scope)?.responses).toEqual([]);
  });

  it("rejects a checkpoint from another brand or a malformed response prefix", () => {
    const checkpoint = makeAuditCheckpoint(scope, context, [
      { text: "question 1", lang: "ko" },
    ]);
    expect(() =>
      readAuditCheckpoint(checkpoint, { ...scope, brandId: "other" })
    ).toThrow("scope mismatch");
    expect(() =>
      readAuditCheckpoint({ ...checkpoint, responses: [[], []] }, scope)
    ).toThrow("invalid audit checkpoint");
  });

  it("binds a checkpoint to its original job and expires it after 24 hours", () => {
    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    const checkpoint = makeAuditCheckpoint(
      scope,
      context,
      [],
      createdAt.toISOString()
    );
    expect(() =>
      assertCheckpointProvenance(
        checkpoint,
        createdAt,
        createdAt.getTime() + 60_000
      )
    ).not.toThrow();
    expect(() =>
      assertCheckpointProvenance(
        checkpoint,
        new Date(createdAt.getTime() + 1),
        createdAt.getTime() + 60_000
      )
    ).toThrow("provenance");
    expect(() =>
      assertCheckpointProvenance(
        checkpoint,
        createdAt,
        createdAt.getTime() + 25 * 60 * 60 * 1000
      )
    ).toThrow("age");
  });
});
