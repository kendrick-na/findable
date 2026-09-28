import { describe, expect, it } from "vitest";
import {
  domainStem,
  englishPromptName,
  officialSiteAliases,
} from "./brand-aliases";

describe("official-site brand aliases", () => {
  it("adds the site's own romanized name (KNOWVERSE)", () => {
    expect(
      officialSiteAliases("knowverse.net", {
        siteName: "KNOWVERSE",
        title: "노우버스 | AI 전략 · CTO 구독 · 기술실사 · AI 교육",
      })
    ).toEqual(["KNOWVERSE"]); // detection is case-insensitive: one spelling is enough
  });

  it("takes a title segment only when it spells the domain name", () => {
    expect(
      officialSiteAliases("https://www.indigochild.kr/", {
        siteName: null,
        title: "Indigochild",
      })
    ).toEqual(["Indigochild"]);
    // Slogans and generic words are not aliases.
    expect(
      officialSiteAliases("indigochild.kr", {
        siteName: "Home",
        title: "We Create the Future",
      })
    ).toEqual(["indigochild"]);
  });

  it("skips short or public-suffix domain names that would match ordinary words", () => {
    expect(domainStem("kia.com")).toBeNull();
    expect(domainStem("toss.im")).toBeNull();
    expect(domainStem("dd.knowverse.net")).toBe("knowverse");
    expect(officialSiteAliases("kia.com", { siteName: "Kia" })).toEqual([]);
  });
});

describe("English prompt brand name", () => {
  it("uses the romanized display name for a Hangul brand", () => {
    expect(englishPromptName("노우버스", ["knowverse", "KNOWVERSE"])).toBe(
      "KNOWVERSE"
    );
  });

  it("keeps a Latin brand name and falls back to the Hangul name when nothing romanized exists", () => {
    expect(englishPromptName("Findable", ["파인더블"])).toBe("Findable");
    expect(englishPromptName("노우버스", [])).toBe("노우버스");
  });
});
