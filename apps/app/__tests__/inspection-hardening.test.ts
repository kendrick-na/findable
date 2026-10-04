/** @vitest-environment node */

// Hardening from the adversarial review of 4b723e0 / fcc8126:
// - the operator kit must mirror `A ?? B` env fallbacks (app migrate reads
//   DATABASE_URL_UNPOOLED ?? DATABASE_URL), otherwise step 1 can never pass;
// - `?schema=` selects the Prisma schema, so it is part of the target and of
//   where _prisma_migrations / Engine live;
// - a live unfinished migration row means failed even next to a finished row
//   (Prisma `migrate status` reports failed, `migrate deploy` refuses P3009);
// - parse errors must not echo the raw value.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connectionSchema,
  fingerprintDatabaseUrl,
  parseTargetSpec,
  resolveEnvSpec,
  safeErrorLabel,
} from "@repo/database/prisma/db-target-fingerprint";
import { evaluateMigrationBaseline } from "@repo/database/prisma/migration-baseline-gate";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync("/tmp/findable-inspection-hardening-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const url = (db: string, query = "") =>
  `postgresql://u:p@ep-a-1.x.neon.tech/${db}${query}`;

describe("env spec fallbacks", () => {
  it("resolves the first non-empty variable of A??B like the runtime does", () => {
    const file = join(dir, "app.env");
    writeFileSync(
      file,
      `DATABASE_URL="${url("db")}"\nDATABASE_URL_UNPOOLED=""\n`
    );
    expect(resolveEnvSpec(`${file}#DATABASE_URL_UNPOOLED??DATABASE_URL`)).toBe(
      url("db")
    );
    expect(
      parseTargetSpec(`app.migrate=${file}#DATABASE_URL_UNPOOLED??DATABASE_URL`)
    ).toEqual({ label: "app.migrate", value: url("db") });
    expect(resolveEnvSpec(`${file}#NOPE??ALSO_NOPE`)).toBeUndefined();
  });
});

describe("schema-aware targets", () => {
  it("treats ?schema= as part of the target and defaults to public", () => {
    expect(connectionSchema(url("db"))).toBe("public");
    expect(connectionSchema(url("db", "?schema=tenant"))).toBe("tenant");
    expect(fingerprintDatabaseUrl(url("db", "?schema=tenant")).target).not.toBe(
      fingerprintDatabaseUrl(url("db")).target
    );
    expect(fingerprintDatabaseUrl(url("db", "?schema=public")).target).toBe(
      fingerprintDatabaseUrl(url("db")).target
    );
  });

  it("rejects schema names that are not plain identifiers", () => {
    expect(() => connectionSchema(url("db", '?schema=a"b'))).toThrow();
  });
});

describe("Prisma-equivalent failed state", () => {
  it("reports failed when an unfinished, non-rolled-back row sits next to a finished one", () => {
    const repo = [{ name: "20261004_tracking_row_key", checksum: "c" }];
    const verdict = evaluateMigrationBaseline(repo, [
      {
        migration_name: "20261004_tracking_row_key",
        checksum: "c",
        finished_at: null,
        rolled_back_at: null,
      },
      {
        migration_name: "20261004_tracking_row_key",
        checksum: "c",
        finished_at: new Date(),
        rolled_back_at: null,
      },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(["20261004_tracking_row_key"]);
  });
});

describe("safeErrorLabel", () => {
  it("never includes the error message, which may contain the raw value", () => {
    let caught: unknown;
    try {
      new URL("host=secret-host password=hunter2");
    } catch (error) {
      caught = error;
    }
    const label = safeErrorLabel(caught);
    expect(label).not.toContain("hunter2");
    expect(label).not.toContain("secret-host");
    expect(label).toMatch(/TypeError/);
  });
});
