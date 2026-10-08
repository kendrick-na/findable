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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LEADING_SLASH = /^\//;
const LINE_BREAK = /\r?\n/;

/** Prisma's `?schema=` selects where tables and _prisma_migrations live (default public). */
export function connectionSchema(value: string): string {
  const schema = new URL(value).searchParams.get("schema") || "public";
  if (!IDENTIFIER.test(schema)) {
    throw new Error("unsupported schema identifier");
  }
  return schema;
}

/** Error label without the message: URL parse errors can echo the raw value. */
export function safeErrorLabel(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name}(${code})` : error.name;
  }
  return "unknown";
}

const SUPABASE_DIRECT_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/;
const SUPABASE_POOLER_HOST = /\.pooler\.supabase\.com$/;
const SUPABASE_POOLER_USER = /^[^.]+\.([a-z0-9]+)$/;

/**
 * Identity of the database a connection reaches, without the secret parts.
 * - Neon: the pooled hostname only adds "-pooler" to the endpoint ID.
 * - Supabase (supabase.com/docs/guides/database/connecting-to-postgres, checked
 *   2026-10-04): direct = db.<ref>.supabase.co, shared pooler =
 *   aws-<n>-<region>.pooler.supabase.com:5432|6543 with user postgres.<ref>.
 *   Every project in a region shares the pooler host, so the project ref is the
 *   target; session/transaction ports and the direct host collapse onto it.
 */
function targetKey(url: URL, value: string): { key: string; pooled: boolean } {
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(LEADING_SLASH, ""));
  const schema = connectionSchema(value);
  const direct = SUPABASE_DIRECT_HOST.exec(host);
  if (direct) {
    return {
      key: ["supabase", direct[1], database, schema].join("|"),
      pooled: false,
    };
  }
  if (SUPABASE_POOLER_HOST.test(host)) {
    const ref = SUPABASE_POOLER_USER.exec(
      decodeURIComponent(url.username).toLowerCase()
    )?.[1];
    if (!ref) {
      throw new Error("supabase pooler user lacks a project ref");
    }
    return {
      key: ["supabase", ref, database, schema].join("|"),
      pooled: true,
    };
  }
  const [first = "", ...rest] = host.split(".");
  const pooled = first.endsWith("-pooler");
  const endpoint = pooled ? first.slice(0, -"-pooler".length) : first;
  return {
    key: [endpoint, rest.join("."), url.port || "5432", database, schema].join(
      "|"
    ),
    pooled,
  };
}

export function fingerprintDatabaseUrl(value: string): DatabaseFingerprint {
  const url = new URL(value);
  const { key, pooled } = targetKey(url, value);
  return {
    pooled,
    target: short(key),
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
  for (const raw of readFileSync(path, "utf8").split(LINE_BREAK)) {
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

/**
 * `<env-file>#VAR` or `<env-file>#A??B`, resolved with JS `??` semantics to
 * mirror the runtime/CLI fallbacks (e.g. migrate reads DATABASE_URL_UNPOOLED ?? DATABASE_URL).
 */
export function resolveEnvSpec(spec: string): string | undefined {
  const hash = spec.lastIndexOf("#");
  if (hash <= 0) {
    throw new Error("env spec must be <env-file>#<VAR>[??<VAR>...]");
  }
  const env = parseEnvFile(spec.slice(0, hash));
  for (const raw of spec.slice(hash + 1).split("??")) {
    const name = raw.trim();
    if (Object.hasOwn(env, name)) {
      // JS `??` stops at the first defined value even when it is "" — the
      // runtime then fails z.url(). A pulled Sensitive variable also reads as
      // "", so an empty value is reported missing instead of falling back.
      return env[name] === "" ? undefined : env[name];
    }
  }
  return undefined;
}

export function parseTargetSpec(spec: string): {
  label: string;
  value: string | undefined;
} {
  const eq = spec.indexOf("=");
  if (eq <= 0) {
    throw new Error("target spec must be <label>=<env-file>#<VAR>[??<VAR>]");
  }
  return {
    label: spec.slice(0, eq),
    value: resolveEnvSpec(spec.slice(eq + 1)),
  };
}
