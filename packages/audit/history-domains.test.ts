import { describe, expect, it } from "vitest";

import { historyDomainCandidates } from "./history";

describe("historyDomainCandidates", () => {
  it("includes only the bare and www forms of the same domain", () => {
    expect(historyDomainCandidates("HTTPS://WWW.Findable.co.kr/")).toEqual([
      "findable.co.kr",
      "www.findable.co.kr",
    ]);
  });

  it("does not include unrelated brands in the history lookup", () => {
    expect(historyDomainCandidates("indigochild.kr")).toEqual([
      "indigochild.kr",
      "www.indigochild.kr",
    ]);
  });
});
