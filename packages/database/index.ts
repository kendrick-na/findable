import "server-only";

import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "./generated/client";
import { keys } from "./keys";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Vercel Functions(serverless)에서는 WebSocket이 작동 안 하므로 HTTP fetch 모드 강제.
// 로컬 dev(Node 18+)에선 ws 모듈로 WebSocket 폴백.
if (process.env.VERCEL || process.env.NEXT_RUNTIME === "edge") {
  neonConfig.poolQueryViaFetch = true;
} else {
  neonConfig.webSocketConstructor = ws;
}

const adapter = new PrismaNeon({ connectionString: keys().DATABASE_URL });

export const database = globalForPrisma.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database;
}

export * from "./generated/client";
