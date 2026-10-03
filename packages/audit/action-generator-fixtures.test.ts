import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterStoredGeoActions } from "./action-display-filter";

type Fixture = {
  provenance: {
    commit: string;
    sourceFiles: string[];
    inputSha256: string;
    generatorScript: string;
    generatorScriptSha256: string;
    projection: string[];
  };
  scenarios: Array<{
    id: string;
    cards: Array<Record<string, unknown>>;
  }>;
};

type Manifest = {
  generatorScript: string;
  generatorScriptSha256: string;
  inputSha256: string;
  sourceFiles: string[];
  commits: Array<{
    commit: string;
    fixture: string;
    sourceBlobs: Record<string, string>;
  }>;
};

const fixtureDir = new URL("./__fixtures__/action-generators/", import.meta.url);
const fixtureNames = ["37088ab.json", "3618c25.json", "0dce32e.json"];
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", fixtureDir), "utf8")
) as Manifest;
const generatorScriptSha256 = createHash("sha256")
  .update(
    readFileSync(
      new URL("../../scripts/generate-audit-action-fixtures.mjs", import.meta.url)
    )
  )
  .digest("hex");

function readFixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(new URL(name, fixtureDir), "utf8")
  ) as Fixture;
}

describe("historical audit action generator fixtures", () => {
  it("keep committed provenance and scenario coverage stable", () => {
    expect(manifest.generatorScript).toBe(
      "scripts/generate-audit-action-fixtures.mjs"
    );
    expect(manifest.generatorScriptSha256).toBe(generatorScriptSha256);
    expect(manifest.sourceFiles).toEqual([
      "packages/audit/actions.ts",
      "packages/audit/action-rules.ts",
    ]);

    for (const name of fixtureNames) {
      const fixture = readFixture(name);
      const manifestEntry = manifest.commits.find(
        ({ fixture: fixtureName }) => fixtureName === name
      );
      expect(manifestEntry).toBeDefined();
      expect(fixture.provenance.commit).toBe(manifestEntry?.commit);
      expect(fixture.provenance.inputSha256).toBe(manifest.inputSha256);
      expect(fixture.provenance.generatorScript).toBe(manifest.generatorScript);
      expect(fixture.provenance.generatorScriptSha256).toBe(
        manifest.generatorScriptSha256
      );
      expect(fixture.provenance.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(fixture.provenance.sourceFiles).toEqual([
        "packages/audit/actions.ts",
        "packages/audit/action-rules.ts",
      ]);
      expect(fixture.provenance.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.provenance.generatorScript).toBe(
        "scripts/generate-audit-action-fixtures.mjs"
      );
      expect(fixture.provenance.generatorScriptSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.scenarios.map(({ id }) => id)).toEqual([
        "korea-no-owned",
        "global-no-owned",
        "both-no-owned",
        "both-owned",
      ]);
      expect(fixture.scenarios.flatMap(({ cards }) => cards).every(
        ({ kind }) => kind === "naver_blog" || kind === "content_fix"
      )).toBe(true);
    }
  });

  it("preserves honest cards while hiding historical dangerous cards", () => {
    for (const name of fixtureNames) {
      const fixture = readFixture(name);

      for (const scenario of fixture.scenarios) {
        const filtered = filterStoredGeoActions(scenario.cards);
        const expectedKinds =
          fixture.provenance.commit ===
          "37088ab82dc98330fb2a6747a4afae292fbcf210"
            ? []
            : fixture.provenance.commit ===
                "3618c25b618c23de43b138530fc8ffa50399341f"
              ? scenario.cards
                  .filter(({ kind }) => kind === "naver_blog")
                  .map(({ kind }) => kind as string)
              : scenario.cards.map(({ kind }) => kind as string);
        expect(filtered.map(({ kind }) => kind)).toEqual(expectedKinds);
      }
    }
  });
});
