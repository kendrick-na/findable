import { createHmac } from "node:crypto";
import { database } from "@repo/database";
import { resend } from "@repo/email";
import { NewsletterArticleEmail } from "@repo/email/templates/newsletter-article";
import { denyIfNotCron } from "@repo/security/cron";
import { Receiver } from "@upstash/qstash";
import type { NextRequest } from "next/server";

export const maxDuration = 300;

const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? "https://www.findable.co.kr";
const signingSecret = process.env.CRON_SECRET ?? "";

async function denyIfNotPublishingCron(request: NextRequest) {
  const signature = request.headers.get("upstash-signature");
  if (signature) {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

    if (currentSigningKey && nextSigningKey) {
      try {
        const receiver = new Receiver({ currentSigningKey, nextSigningKey });
        const verified = await receiver.verify({
          signature,
          body: "",
          url: request.url,
          clockTolerance: 5,
          upstashRegion: request.headers.get("upstash-region") ?? undefined,
        });
        if (verified) {
          return null;
        }
      } catch {
        // Invalid QStash signatures fall through to the existing Vercel cron guard.
      }
    }
  }

  return denyIfNotCron(request);
}

function articleUrl(content: {
  locale: string;
  slug: string;
  publisher: {
    customDomain: string | null;
    customDomainStatus: string;
    slug: string;
  };
}) {
  if (
    content.publisher.customDomain &&
    content.publisher.customDomainStatus === "active"
  ) {
    const prefix = content.locale === "ko" ? "" : `/${content.locale}`;
    return `https://${content.publisher.customDomain}${prefix}/p/${content.slug}`;
  }
  return `${webUrl}/${content.locale}/p/${content.publisher.slug}/${content.slug}`;
}

async function publishDueContent() {
  const jobs = await database.publicationJob.findMany({
    where: {
      status: "queued",
      scheduledAt: { lte: new Date() },
      content: { status: "scheduled" },
    },
    include: { content: { include: { publisher: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });
  let published = 0;
  for (const job of jobs) {
    const claimed = await database.publicationJob.updateMany({
      where: { id: job.id, status: "queued" },
      data: {
        status: "processing",
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      continue;
    }
    try {
      await database.$transaction([
        database.content.update({
          where: { id: job.content.id },
          data: {
            status: "published",
            noindex: false,
            publishedAt: new Date(),
          },
        }),
        database.contentReviewEvent.create({
          data: {
            contentId: job.content.id,
            type: "published",
            note: "scheduled_cron",
          },
        }),
        database.publicationJob.update({
          where: { id: job.id },
          data: { status: "completed", completedAt: new Date() },
        }),
        ...(job.content.sendNewsletter &&
        job.content.publisher.newsletterEnabled
          ? [
              database.newsletterCampaign.upsert({
                where: { contentId: job.content.id },
                create: { contentId: job.content.id, status: "queued" },
                update: { status: "queued", lastError: null },
              }),
            ]
          : []),
      ]);
      published += 1;
    } catch (error) {
      await database.publicationJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return published;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: campaign claiming, per-recipient idempotency, and failure isolation stay together so retries remain auditable.
async function sendQueuedCampaigns() {
  if (!(resend && signingSecret)) {
    return { campaigns: 0, deliveries: 0, skipped: true };
  }
  const campaigns = await database.newsletterCampaign.findMany({
    where: { status: "queued", content: { status: "published" } },
    include: {
      content: { include: { publisher: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  let deliveries = 0;
  for (const campaign of campaigns) {
    const claimed = await database.newsletterCampaign.updateMany({
      where: { id: campaign.id, status: "queued" },
      data: { status: "processing", startedAt: new Date() },
    });
    if (claimed.count !== 1) {
      continue;
    }
    try {
      const subscriptions = await database.newsletterSubscription.findMany({
        where: {
          publisherId: campaign.content.publisherId,
          status: "active",
          OR: [
            { deliveries: { none: { campaignId: campaign.id } } },
            {
              deliveries: {
                some: {
                  campaignId: campaign.id,
                  status: "failed",
                  attempts: { lt: 3 },
                },
              },
            },
          ],
        },
        take: 500,
      });
      let failedDeliveries = 0;
      let retryableFailures = 0;
      for (const subscription of subscriptions) {
        const delivery = await database.newsletterDelivery.upsert({
          where: {
            campaignId_subscriptionId: {
              campaignId: campaign.id,
              subscriptionId: subscription.id,
            },
          },
          create: { campaignId: campaign.id, subscriptionId: subscription.id },
          update: {},
        });
        if (delivery.status === "sent") {
          continue;
        }
        const signature = createHmac("sha256", signingSecret)
          .update(subscription.id)
          .digest("hex");
        const unsubscribeUrl = `${webUrl}/api/newsletter/unsubscribe?token=${subscription.id}.${signature}`;
        try {
          const sent = await resend.emails.send({
            from:
              process.env.RESEND_FROM ?? "Findable <newsletter@findable.co.kr>",
            to: subscription.email,
            subject: campaign.content.title,
            react: NewsletterArticleEmail({
              articleUrl: articleUrl(campaign.content),
              excerpt: campaign.content.excerpt ?? "새 글을 발행했습니다.",
              publisherName: campaign.content.publisher.name,
              title: campaign.content.title,
              unsubscribeUrl,
            }),
          });
          await database.newsletterDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "sent",
              providerId: sent.data?.id,
              sentAt: new Date(),
              attempts: { increment: 1 },
            },
          });
          deliveries += 1;
        } catch (error) {
          failedDeliveries += 1;
          if (delivery.attempts + 1 < 3) {
            retryableFailures += 1;
          }
          await database.newsletterDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "failed",
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
      const campaignQueued =
        retryableFailures > 0 || subscriptions.length === 500;
      const campaignFailed = failedDeliveries > retryableFailures;
      let campaignStatus: "completed" | "failed" | "queued" = "completed";
      if (campaignFailed) {
        campaignStatus = "failed";
      } else if (campaignQueued) {
        campaignStatus = "queued";
      }
      await database.newsletterCampaign.update({
        where: { id: campaign.id },
        data: {
          status: campaignStatus,
          completedAt: campaignFailed || campaignQueued ? null : new Date(),
          lastError:
            failedDeliveries > 0
              ? `${failedDeliveries}개 전송 재시도 대기`
              : null,
        },
      });
    } catch (error) {
      await database.newsletterCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return { campaigns: campaigns.length, deliveries, skipped: false };
}

export async function GET(request: NextRequest) {
  const denied = await denyIfNotPublishingCron(request);
  if (denied) {
    return denied;
  }
  const published = await publishDueContent();
  const newsletter = await sendQueuedCampaigns();
  return Response.json({ ok: true, published, newsletter });
}
