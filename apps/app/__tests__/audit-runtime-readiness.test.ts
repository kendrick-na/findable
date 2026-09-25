import { describe, expect, it } from "vitest";
import { getAuditRuntimeReadiness } from "@/lib/audit/runtime-readiness";

const completeEnv = {
  DATABASE_URL: "postgres://db",
  LETSUR_API_KEY: "letsur",
  GOOGLE_API_KEY: "google",
  PERPLEXITY_API_KEY: "perplexity",
};

describe("getAuditRuntimeReadiness", () => {
  it("accepts the direct provider configuration used by production", () => {
    expect(getAuditRuntimeReadiness(completeEnv)).toEqual({ ready: true });
  });

  it("accepts a gateway route for all global engines", () => {
    expect(
      getAuditRuntimeReadiness({
        DATABASE_URL: "postgres://db",
        AI_GATEWAY_API_KEY: "gateway",
      })
    ).toEqual({ ready: true });
  });

  it("reports missing runtime configuration without exposing values", () => {
    expect(getAuditRuntimeReadiness({})).toEqual({
      ready: false,
      missing: [
        "DATABASE_URL",
        "LETSUR_API_KEY 또는 AI Gateway 인증",
        "GOOGLE_API_KEY 또는 AI Gateway 인증",
        "PERPLEXITY_API_KEY 또는 AI Gateway 인증",
      ],
    });
  });

  it("requires Firecrawl when the main briefing is enabled", () => {
    expect(
      getAuditRuntimeReadiness({
        ...completeEnv,
        AUDIT_BRIEFING_IN_MAIN_ENABLED: "true",
      })
    ).toEqual({ ready: false, missing: ["FIRECRAWL_API_KEY"] });
  });
});
