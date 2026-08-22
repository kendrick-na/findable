import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { database } from "@repo/database";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  const form = await request.formData();
  const token = form.get("token");
  if (typeof token !== "string" || !token) {
    return new Response("Invalid unsubscribe request", { status: 400 });
  }
  const [subscriptionId, signature] = token.split(".");
  const expected = subscriptionId
    ? createHmac("sha256", process.env.CRON_SECRET ?? "")
        .update(subscriptionId)
        .digest("hex")
    : "";
  const signedTokenValid =
    Boolean(process.env.CRON_SECRET) &&
    Boolean(signature) &&
    signature?.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  const subscription = signedTokenValid
    ? await database.newsletterSubscription.findUnique({
        where: { id: subscriptionId },
      })
    : await database.newsletterSubscription.findUnique({
        where: { unsubscribeTokenHash: hash(token) },
      });
  if (subscription) {
    await database.newsletterSubscription.update({
      where: { id: subscription.id },
      data: { status: "unsubscribed", unsubscribedAt: new Date() },
    });
  }
  return new Response("수신거부가 완료되었습니다.", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>뉴스레터 수신거부</title><body style="font-family:sans-serif;max-width:560px;margin:80px auto;padding:24px"><h1>뉴스레터 수신거부</h1><p>아래 버튼을 누르면 이메일 발송을 중단합니다.</p><form method="post"><input type="hidden" name="token" value="${token.replace(/[&<>"]/g, "")}"><button style="padding:12px 18px">수신거부 확인</button></form></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
