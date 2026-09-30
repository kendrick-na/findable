import { describe, expect, it } from "vitest";
import { auditLanguageForMarketScope } from "./market-scope";

describe("auditLanguageForMarketScope", () => {
  it("uses the customer-confirmed market to choose first-run question language", () => {
    expect(auditLanguageForMarketScope("korea")).toBe("ko");
    expect(auditLanguageForMarketScope("global")).toBe("en");
    expect(auditLanguageForMarketScope("both")).toBe("both");
  });

  it("keeps legacy both-language behavior only when market is unavailable", () => {
    expect(auditLanguageForMarketScope(null)).toBe("both");
    expect(auditLanguageForMarketScope(undefined)).toBe("both");
  });
});
