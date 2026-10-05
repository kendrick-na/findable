import { describe, expect, it } from "vitest";
import { entityMatchesDomain } from "./wiki-presence";

const site = (url: string) => ({
  claims: { P856: [{ mainsnak: { datavalue: { value: url } } }] },
});

describe("wiki presence — official website match", () => {
  it("accepts the same site with or without www, scheme or path", () => {
    expect(
      entityMatchesDomain(site("https://www.apple.com/"), "apple.com")
    ).toBe(true);
    expect(
      entityMatchesDomain(
        site("http://innisfree.com/kr/ko"),
        "www.innisfree.com"
      )
    ).toBe(true);
    expect(
      entityMatchesDomain(site("https://us.sulwhasoo.com"), "sulwhasoo.com")
    ).toBe(true);
  });

  it("rejects a namesake whose official site is another domain", () => {
    expect(
      entityMatchesDomain(site("https://meetfranz.com"), "franzskincare.com")
    ).toBe(false);
    expect(entityMatchesDomain({}, "franzskincare.com")).toBe(false);
  });
});
