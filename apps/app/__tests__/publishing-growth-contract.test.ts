import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("SEO/GEO publishing growth loop", () => {
  it("stores scheduling, newsletters, and custom-domain state", () => {
    const schema = read("packages/database/prisma/schema.prisma");
    expect(schema).toContain("scheduledAt");
    expect(schema).toContain("sendNewsletter");
    expect(schema).toContain("customDomain");
    expect(schema).toContain("model NewsletterSubscription");
    expect(schema).toContain("model NewsletterCampaign");
    expect(schema).toContain("model NewsletterDelivery");
    expect(schema).toContain("scheduled");
  });

  it("runs due publications and queued newsletter campaigns from a secured cron", () => {
    const cron = read("apps/web/app/api/cron/content-publishing/route.ts");
    const vercel = read("apps/web/vercel.json");
    expect(cron).toContain("denyIfNotCron");
    expect(cron).toContain("QSTASH_CURRENT_SIGNING_KEY");
    expect(cron).toContain("upstash-signature");
    expect(cron).toContain("receiver.verify");
    expect(cron).toContain('status: "scheduled"');
    expect(cron).toContain("NewsletterArticleEmail");
    expect(vercel).toContain("/api/cron/content-publishing");
  });

  it("provides subscription confirmation and safe unsubscribe endpoints", () => {
    const subscribe = read("apps/web/app/api/newsletter/subscribe/route.ts");
    const confirm = read("apps/web/app/api/newsletter/confirm/route.ts");
    const unsubscribe = read(
      "apps/web/app/api/newsletter/unsubscribe/route.ts"
    );
    expect(subscribe).toContain("confirmationTokenHash");
    expect(confirm).toContain('status: "active"');
    expect(unsubscribe).toContain('status: "unsubscribed"');
  });

  it("shows measured before-after performance without claiming search indexing", () => {
    const performance = read("apps/app/lib/content/performance.ts");
    const dashboard = read("apps/app/app/(authenticated)/insights/page.tsx");
    expect(performance).toContain("baselineScore");
    expect(performance).toContain("currentScore");
    expect(performance).toContain("citationDetected");
    expect(dashboard).toContain("contentPerformance");
    expect(dashboard).toContain("indexEligibility");
  });

  it("routes verified customer hosts to publisher-owned pages", () => {
    const proxy = read("apps/web/proxy.ts");
    const customPublisher = read(
      "apps/web/app/[locale]/site/[customDomain]/page.tsx"
    );
    const customArticle = read(
      "apps/web/app/[locale]/site/[customDomain]/[postSlug]/page.tsx"
    );
    expect(proxy).toContain("customDomainRewrite");
    expect(customPublisher).toContain("getPublicPublisherByDomain");
    expect(customArticle).toContain("getPublishedContentByDomain");
  });
});
