// W0-0 DB 대상 동일성 — 값 비노출 지문 비교.
//
// 웹 runtime `FINDABLE_DATABASE_URL ?? DATABASE_URL`, migrate CLI `DATABASE_URL_UNPOOLED ??
// DATABASE_URL`, 앱 `DATABASE_URL` 이 같은 Neon 브랜치·DB를 가리키는지 확인한다.
// Neon pooled 주소는 endpoint ID 에 `-pooler` 만 붙인다(neon.com/docs/connect/connection-pooling,
// 2026-10-04 확인). endpoint 는 한 브랜치에 속하므로 endpoint+port+DB 가 같으면 같은 대상이다.
// 출력은 해시 지문뿐이며 호스트·계정·비밀번호·DB 이름은 내보내지 않는다.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface DatabaseFingerprint {
  pooled: boolean;
  role: string;
  target: string;
}

const short = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

export function fingerprintDatabaseUrl(value: string): DatabaseFingerprint {
  const url = new URL(value);
  const [first = "", ...rest] = url.hostname.toLowerCase().split(".");
  const pooled = first.endsWith("-pooler");
  const endpoint = pooled ? first.slice(0, -"-pooler".length) : first;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    pooled,
    target: short(
      [endpoint, rest.join("."), url.port || "5432", database].join("|")
    ),
    role: short(decodeURIComponent(url.username)),
  };
}

export interface TargetComparison {
  allSameTarget: boolean;
  groups: string[][];
  missing: string[];
  targets: Record<string, DatabaseFingerprint>;
}

export function compareDatabaseTargets(
  named: Record<string, string | undefined>
): TargetComparison {
  const targets: Record<string, DatabaseFingerprint> = {};
  const missing: string[] = [];
  const byTarget = new Map<string, string[]>();
  for (const [label, value] of Object.entries(named)) {
    if (!value) {
      missing.push(label);
      continue;
    }
    const fp = fingerprintDatabaseUrl(value);
    targets[label] = fp;
    byTarget.set(fp.target, [...(byTarget.get(fp.target) ?? []), label]);
  }
  const groups = [...byTarget.values()];
  return {
    allSameTarget: missing.length === 0 && groups.length === 1,
    groups,
    missing,
    targets,
  };
}

export function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      (value.startsWith('"') || value.startsWith("'")) &&
      value.endsWith(value[0] ?? "")
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function parseTargetSpec(spec: string): {
  label: string;
  value: string | undefined;
} {
  const eq = spec.indexOf("=");
  const hash = spec.lastIndexOf("#");
  if (eq <= 0 || hash <= eq) {
    throw new Error("target spec must be <label>=<env-file>#<VAR>");
  }
  const label = spec.slice(0, eq);
  const file = spec.slice(eq + 1, hash);
  const name = spec.slice(hash + 1);
  const value = parseEnvFile(file)[name];
  return { label, value: value ? value : undefined };
}
