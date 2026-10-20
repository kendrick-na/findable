/**
 * Prisma 클라이언트 생성 — **단일 진입점** (2026-10-20 운영 빌드 게이트 P1011 사고 후 분리).
 *
 * 앱 런타임(`index.ts`)과 운영 빌드 게이트(`scripts/privacy-table-gate.ts`)가 **같은 함수**로 클라이언트를 만든다.
 * 🔴 사고: 게이트가 `new PrismaPg({ connectionString })` 를 직접 만들어 Supabase 의 `sslmode=require` 를 그대로
 *   pg 에 넘겼고, 우리 CA 고정(SUPABASE_ROOT_CA)이 빠져 TLS 검증 실패(P1011) → 운영 빌드가 막혔다.
 *   런타임은 아래 규칙으로 정상 접속 중이었다. → 규칙을 여기 한 곳에 두고 둘 다 이것만 쓴다.
 * ⚠️ `server-only` 를 import 하지 않는다(빌드 스크립트가 bun 으로 직접 실행하므로). 서버 전용 표시는 index.ts 가 맡는다.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

export interface PgAdapterExtra {
  /** pg 연결 시도 제한(ms). 런타임은 지정하지 않는다(pg 기본값). */
  connectionTimeoutMillis?: number;
}

const isSupabaseHost = (hostname: string): boolean =>
  hostname.endsWith(".supabase.com") || hostname.endsWith(".supabase.co");

/**
 * pg 어댑터 설정(입출력 없음 — 시험 대상). Supabase/Neon/자체 호스팅 PostgreSQL 공통.
 * Supabase 면 URL 의 `sslmode` 를 지우고 검증된 Supabase 루트 CA 를 고정한다.
 */
export function pgAdapterConfig(
  rawConnectionString: string,
  extra: PgAdapterExtra = {}
) {
  const databaseUrl = new URL(rawConnectionString);
  const usesSupabase = isSupabaseHost(databaseUrl.hostname);
  if (usesSupabase) {
    // node-postgres parses sslmode=require from the URL *after* the explicit ssl
    // config and discards our CA. Remove it and pin the verified Supabase root.
    databaseUrl.searchParams.delete("sslmode");
  }
  return {
    connectionString: databaseUrl.toString(),
    ...extra,
    ...(usesSupabase
      ? { ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } }
      : {}),
  };
}

export function createPgAdapter(
  rawConnectionString: string,
  extra: PgAdapterExtra = {}
): PrismaPg {
  const adapter = new PrismaPg({
    ...pgAdapterConfig(rawConnectionString, extra),
    // `pg` otherwise defaults to ten connections per serverless instance.
    // Several concurrent Vercel instances can exhaust the production pool even
    // when the connection string itself points at a pooled database endpoint.
    max: 1,
  });
  return adapter;
}

/** 런타임·게이트 공용 Prisma 클라이언트 생성. 직접 `new PrismaClient` 하지 말 것. */
export function createPrismaClient(
  rawConnectionString: string,
  extra: PgAdapterExtra = {}
): PrismaClient {
  return new PrismaClient({
    adapter: createPgAdapter(rawConnectionString, extra),
  });
}
