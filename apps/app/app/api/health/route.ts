import { database } from "@repo/database";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

export const GET = async () => {
  try {
    await database.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers, status: 200 });
  } catch {
    return Response.json({ ok: false }, { headers, status: 503 });
  }
};
