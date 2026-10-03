#!/usr/bin/env node

/**
 * Generate audit action golden fixtures from an already-extracted historical
 * source tree. CI must read committed fixtures; this script is for controlled
 * provenance-preserving regeneration only.
 *
 * Usage:
 *   node scripts/generate-audit-action-fixtures.mjs \
 *     --source-dir /tmp/findable-37088 \
 *     --commit 37088ab82dc98330fb2a6747a4afae292fbcf210 \
 *     --out packages/audit/__fixtures__/action-generators/37088ab.json
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i]?.startsWith("--")) {
    args.set(process.argv[i].slice(2), process.argv[i + 1]);
    i += 1;
  }
}

const sourceDir = resolve(args.get("source-dir") ?? "");
const commit = args.get("commit");
const output = resolve(args.get("out") ?? "");
if (!sourceDir || !commit || !output) {
  throw new Error("--source-dir, --commit, and --out are required");
}

const scenarios = [
  {
    id: "korea-no-owned",
    brandName: "설화수",
    brandDomain: "sulwhasoo.com",
    averageMentionPosition: null,
    enginesMeasured: 4,
    enginesMentioned: 1,
    marketScope: "korea",
  },
  {
    id: "global-no-owned",
    brandName: "설화수",
    brandDomain: "sulwhasoo.com",
    averageMentionPosition: null,
    enginesMeasured: 4,
    enginesMentioned: 1,
    marketScope: "global",
  },
  {
    id: "both-no-owned",
    brandName: "설화수",
    brandDomain: "sulwhasoo.com",
    averageMentionPosition: null,
    enginesMeasured: 4,
    enginesMentioned: 1,
    marketScope: "both",
  },
  {
    id: "both-owned",
    brandName: "설화수",
    brandDomain: "sulwhasoo.com",
    averageMentionPosition: null,
    enginesMeasured: 4,
    enginesMentioned: 1,
    marketScope: "both",
    ownedCitationCount: 2,
  },
];

const baseVerdicts = {
  confusedQuotes: [],
  counts: {
    absent: 0,
    answered: 10,
    confirmed: 1,
    differentEntity: 0,
    engineError: 0,
    total: 10,
    unclassified: 0,
    unknownBrand: 6,
    unverified: 0,
  },
  differentEntityEngines: [],
};
const inputs = scenarios.map(({ id, ownedCitationCount = 0, ...scenario }) => ({
  ...scenario,
  prompts: [{ hit: 0, text: "설화수 추천해줘", total: 4 }],
  verdicts: { ...baseVerdicts, ownedCitationCount },
  id,
}));
const inputHash = createHash("sha256")
  .update(JSON.stringify(inputs))
  .digest("hex");
const driver = `.findable-golden-driver.${process.pid}.test.ts`;
const driverPath = resolve(sourceDir, driver);
const driverText = `import { buildGeoActions } from "./packages/audit/actions";
import { describe, expect, it } from "vitest";
const inputs = ${JSON.stringify(inputs)};
describe("historical audit action fixture", () => {
  it("emits generated cards", () => {
    const output = inputs.map(({ id, ...input }) => ({
      id,
      cards: buildGeoActions(input as never),
    }));
    expect(output).toHaveLength(${inputs.length});
    process.stdout.write(
      \`GOLDEN_JSON_BASE64=\${Buffer.from(JSON.stringify(output)).toString("base64")}\\n\`
    );
  });
});
`;
writeFileSync(driverPath, driverText);
try {
  const stdout = execFileSync(
    "pnpm",
    ["exec", "vitest", "run", driver, "--reporter=dot"],
    { cwd: sourceDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  const encoded = stdout.match(/^GOLDEN_JSON_BASE64=(.+)$/m)?.[1];
  if (!encoded) {
    throw new Error("historical generator did not emit a golden payload");
  }
  const generated = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const cards = generated.map(({ id, cards: allCards }) => ({
    id,
    cards: allCards
      .filter(({ kind }) => kind === "naver_blog" || kind === "content_fix")
      .map(({ kind, title, source, evidence, how, verification, where, guide }) => ({
        kind,
        title,
        source,
        evidence,
        how,
        verification,
        where,
        guide,
      })),
  }));
  const scriptHash = createHash("sha256")
    .update(readFileSync(new URL(import.meta.url)))
    .digest("hex");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        provenance: {
          commit,
          sourceFiles: ["packages/audit/actions.ts", "packages/audit/action-rules.ts"],
          inputSha256: inputHash,
          generatorScript: "scripts/generate-audit-action-fixtures.mjs",
          generatorScriptSha256: scriptHash,
          projection: ["kind", "title", "source", "evidence", "how", "verification", "where", "guide"],
        },
        scenarios: cards,
      },
      null,
      2
    )}\n`,
  );
} finally {
  unlinkSync(driverPath);
}
