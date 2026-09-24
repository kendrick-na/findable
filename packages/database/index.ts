import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { keys } from "./keys";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Supabase/Neon/자체 호스팅 PostgreSQL을 모두 사용할 수 있도록
// Neon 전용 어댑터 대신 표준 PostgreSQL 어댑터를 사용한다.
const databaseUrl = new URL(keys().DATABASE_URL);
const usesSupabase =
  databaseUrl.hostname.endsWith(".supabase.com") ||
  databaseUrl.hostname.endsWith(".supabase.co");
if (usesSupabase) {
  // node-postgres parses sslmode=require from the URL *after* the explicit ssl
  // config and discards our CA. Remove it and pin the verified Supabase root.
  databaseUrl.searchParams.delete("sslmode");
}
const adapter = new PrismaPg({
  connectionString: databaseUrl.toString(),
  ...(usesSupabase
    ? { ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true }, max: 1 }
    : {}),
});

export const database = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database;
}

export * from "./generated/client";
