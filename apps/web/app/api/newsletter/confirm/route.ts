import { createHash } from "node:crypto";
import { database } from "@repo/database";
import { NextResponse } from "next/server";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("Invalid confirmation link", { status: 400 });
  }
  const subscription = await database.newsletterSubscription.findUnique({
    where: { confirmationTokenHash: hash(token) },
    include: { publisher: true },
  });
  if (!subscription) {
    return new Response("Invalid or expired confirmation link", {
      status: 400,
    });
  }
  await database.newsletterSubscription.update({
    where: { id: subscription.id },
    data: {
      status: "active",
      confirmedAt: new Date(),
      confirmationTokenHash: null,
    },
  });
  return NextResponse.redirect(
    new URL(`/ko/p/${subscription.publisher.slug}?subscribed=1`, url.origin)
  );
}
