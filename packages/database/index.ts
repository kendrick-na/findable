import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { keys } from "./keys";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Supabase/Neon/자체 호스팅 PostgreSQL을 모두 사용할 수 있도록
// Neon 전용 어댑터 대신 표준 PostgreSQL 어댑터를 사용한다.
const adapter = new PrismaPg({ connectionString: keys().DATABASE_URL });

export const database = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database;
}

export * from "./generated/client";
