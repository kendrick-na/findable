import "server-only";

import { createPrismaClient } from "./create-client";
import type { PrismaClient } from "./generated/client";
import { keys } from "./keys";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Supabase/Neon/자체 호스팅 PostgreSQL을 모두 사용할 수 있도록
// Neon 전용 어댑터 대신 표준 PostgreSQL 어댑터를 사용한다.
// 어댑터·SSL(Supabase CA 고정)·풀 크기(max 1) 규칙은 `create-client.ts` 한 곳에 있다 —
// 운영 빌드 게이트도 같은 함수를 쓴다(2026-10-20 게이트 P1011 사고).
const databaseUrl = keys().DATABASE_URL;

export const database =
  globalForPrisma.prisma || createPrismaClient(databaseUrl);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database;
}

export * from "./generated/client";
