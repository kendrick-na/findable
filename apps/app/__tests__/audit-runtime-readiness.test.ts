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

  it("does not treat the force-live switch as provider authentication", () => {
    expect(
      getAuditRuntimeReadiness({
        DATABASE_URL: "postgres://db",
        FINDABLE_FORCE_LIVE: "1",
      })
    ).toEqual({
      ready: false,
      missing: [
        "LETSUR_API_KEY 또는 AI Gateway 인증",
        "GOOGLE_API_KEY 또는 AI Gateway 인증",
        "PERPLEXITY_API_KEY 또는 AI Gateway 인증",
      ],
    });
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

  it("does not gate core audit on the obsolete automatic briefing flag", () => {
    expect(
      getAuditRuntimeReadiness({
        ...completeEnv,
        AUDIT_BRIEFING_IN_MAIN_ENABLED: "true",
      })
    ).toEqual({ ready: true });
  });

  it("skips provider keys in local stub mode", () => {
    expect(
      getAuditRuntimeReadiness({
        DATABASE_URL: "postgres://db",
        FINDABLE_AUDIT_STUB_MODE: "1",
      })
    ).toEqual({ ready: true });
  });

  it("never skips provider keys on production, even with the stub flag", () => {
    expect(
      getAuditRuntimeReadiness({
        DATABASE_URL: "postgres://db",
        FINDABLE_AUDIT_STUB_MODE: "1",
        VERCEL_ENV: "production",
      }).ready
    ).toBe(false);
  });

  it("still requires a database in stub mode", () => {
    expect(getAuditRuntimeReadiness({ VERCEL_ENV: "preview" })).toEqual({
      ready: false,
      missing: ["DATABASE_URL"],
    });
  });
});
