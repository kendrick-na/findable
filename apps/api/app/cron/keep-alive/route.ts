import { database } from "@repo/database";
import type { NextRequest } from "next/server";

export const GET = async (request: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";

  const authorized = cronSecret
    ? authHeader === `Bearer ${cronSecret}`
    : isVercelCron;

  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 커넥션 워밍업(keep-alive) 목적. next-forge 기본 템플릿은 존재하지 않는 Page
  // 모델을 create/delete 했으나 Findable 스키마엔 Page 가 없다 → 스키마 무관하게
  // 커넥션만 깨우는 `SELECT 1` 로 교체(타입오류 2건 해소, 부수효과 0).
  await database.$queryRaw`SELECT 1`;

  return new Response("OK", { status: 200 });
};
