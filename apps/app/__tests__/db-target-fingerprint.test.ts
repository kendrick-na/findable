/** @vitest-environment node */

// W0-0 runtime / migration target identity without revealing values.
// Web runtime reads FINDABLE_DATABASE_URL ?? DATABASE_URL, the migrate CLI reads
// DATABASE_URL_UNPOOLED ?? DATABASE_URL and the app reads DATABASE_URL. Neon's
// pooled hostname only adds "-pooler" to the endpoint ID, so the same endpoint
// and database mean the same branch even when one side is pooled.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareDatabaseTargets,
  fingerprintDatabaseUrl,
  parseEnvFile,
  parseTargetSpec,
} from "@repo/database/prisma/db-target-fingerprint";
import { afterAll, describe, expect, it } from "vitest";

const direct =
  "postgresql://owner:s3cret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";
const pooled =
  "postgresql://owner:s3cret@ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const otherBranch =
  "postgresql://owner:s3cret@ep-quiet-river-654321-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const otherDb =
  "postgresql://owner:s3cret@ep-cool-darkness-123456.us-east-2.aws.neon.tech/staging?sslmode=require";

describe("fingerprintDatabaseUrl", () => {
  it("treats Neon pooled and direct hostnames of one endpoint as one target", () => {
    const a = fingerprintDatabaseUrl(direct);
    const b = fingerprintDatabaseUrl(pooled);
    expect(a.target).toBe(b.target);
    expect(a.pooled).toBe(false);
    expect(b.pooled).toBe(true);
  });

  it("separates different endpoints and different databases", () => {
    const base = fingerprintDatabaseUrl(direct).target;
    expect(fingerprintDatabaseUrl(otherBranch).target).not.toBe(base);
    expect(fingerprintDatabaseUrl(otherDb).target).not.toBe(base);
  });

  it("never echoes the host, user, password or database name", () => {
    const serialized = JSON.stringify(fingerprintDatabaseUrl(pooled));
    for (const secret of [
      "s3cret",
      "owner",
      "ep-cool-darkness",
      "neondb",
      "neon.tech",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("compareDatabaseTargets", () => {
  it("reports one shared target only when every present value matches", () => {
    const same = compareDatabaseTargets({
      "web.runtime": pooled,
      "web.migrate": direct,
      "app.runtime": pooled,
    });
    expect(same.allSameTarget).toBe(true);
    expect(same.missing).toEqual([]);

    const split = compareDatabaseTargets({
      "web.runtime": pooled,
      "web.migrate": direct,
      "app.runtime": otherBranch,
    });
    expect(split.allSameTarget).toBe(false);
    expect(split.groups).toHaveLength(2);
  });

  it("fails closed when a requested variable is absent", () => {
    const verdict = compareDatabaseTargets({
      "web.runtime": pooled,
      "app.runtime": undefined,
    });
    expect(verdict.allSameTarget).toBe(false);
    expect(verdict.missing).toEqual(["app.runtime"]);
  });
});

const dir = mkdtempSync("/tmp/findable-db-target-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("env file target specs", () => {
  it("reads vercel env pull style files and resolves label=file#VAR", () => {
    const file = join(dir, "web.env");
    writeFileSync(
      file,
      `# Created by Vercel CLI\nFINDABLE_DATABASE_URL="${pooled}"\nDATABASE_URL_UNPOOLED="${direct}"\nEMPTY=""\n`
    );
    expect(parseEnvFile(file)).toEqual({
      FINDABLE_DATABASE_URL: pooled,
      DATABASE_URL_UNPOOLED: direct,
      EMPTY: "",
    });
    expect(
      parseTargetSpec(`web.runtime=${file}#FINDABLE_DATABASE_URL`)
    ).toEqual({
      label: "web.runtime",
      value: pooled,
    });
    expect(parseTargetSpec(`web.missing=${file}#NOPE`)).toEqual({
      label: "web.missing",
      value: undefined,
    });
    expect(parseTargetSpec(`web.empty=${file}#EMPTY`)).toEqual({
      label: "web.empty",
      value: undefined,
    });
  });
});
