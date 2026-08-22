import { createHash, randomBytes } from "node:crypto";
import { database } from "@repo/database";
import { resend } from "@repo/email";
import { NewsletterConfirmationEmail } from "@repo/email/templates/newsletter-confirmation";
import { createRateLimiter, slidingWindow } from "@repo/rate-limit";
import { z } from "zod";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.enum(["ko", "en"]).default("ko"),
  publisherSlug: z.string().trim().min(1).max(160),
});

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const limiter =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? createRateLimiter({
        limiter: slidingWindow(5, "1 h"),
        prefix: "newsletter-subscribe",
      })
    : null;

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!resend) {
    return Response.json({ error: "email_unavailable" }, { status: 503 });
  }
  if (limiter) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
    const result = await limiter.limit(
      `${forwarded ?? "unknown"}:${parsed.data.email}`
    );
    if (!result.success) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
  }
  const publisher = await database.publisher.findFirst({
    where: {
      slug: parsed.data.publisherSlug,
      newsletterEnabled: true,
      suspendedAt: null,
    },
  });
  if (!publisher) {
    return Response.json({ error: "publisher_not_found" }, { status: 404 });
  }
  const confirmationToken = randomBytes(32).toString("hex");
  const unsubscribeToken = randomBytes(32).toString("hex");
  const confirmationTokenHash = hash(confirmationToken);
  await database.newsletterSubscription.upsert({
    where: {
      publisherId_email: {
        publisherId: publisher.id,
        email: parsed.data.email,
      },
    },
    create: {
      publisherId: publisher.id,
      email: parsed.data.email,
      locale: parsed.data.locale,
      confirmationTokenHash,
      unsubscribeTokenHash: hash(unsubscribeToken),
    },
    update: {
      locale: parsed.data.locale,
      status: "pending",
      confirmationTokenHash,
      unsubscribeTokenHash: hash(unsubscribeToken),
      confirmedAt: null,
      unsubscribedAt: null,
    },
  });
  const webUrl =
    process.env.NEXT_PUBLIC_WEB_URL ?? "https://www.findable.co.kr";
  const confirmUrl = `${webUrl}/api/newsletter/confirm?token=${confirmationToken}`;
  await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Findable <newsletter@findable.co.kr>",
    to: parsed.data.email,
    subject: `${publisher.name} 뉴스레터 구독 확인`,
    react: NewsletterConfirmationEmail({
      confirmUrl,
      publisherName: publisher.name,
    }),
  });
  return Response.json({ ok: true });
}
