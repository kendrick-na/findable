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

  const newPage = await database.page.create({
    data: {
      name: "cron-temp",
    },
  });

  await database.page.delete({
    where: {
      id: newPage.id,
    },
  });

  return new Response("OK", { status: 200 });
};
