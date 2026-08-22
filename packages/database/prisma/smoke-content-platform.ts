import { PrismaNeon } from "@prisma/adapter-neon";
import {
  ContentQualityStatus,
  ContentReviewEventType,
  ContentStatus,
  PrismaClient,
  PublicationJobStatus,
  PublisherKind,
} from "../generated/client";

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required");
}

const database = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

const marker = `smoke-${Date.now()}`;
let publisherId: string | undefined;
let contentId: string | undefined;

try {
  const publisher = await database.publisher.create({
    data: {
      kind: PublisherKind.findable,
      slug: marker,
      name: "Content Platform Smoke Test",
      verifiedAt: new Date(),
    },
  });
  publisherId = publisher.id;

  const content = await database.content.create({
    data: {
      publisherId,
      locale: "ko",
      slug: marker,
      title: "SEO/GEO publishing smoke test",
      bodyMarkdown:
        "# Verified answer\n\nThis temporary article validates the publishing lifecycle.\n\n## Evidence\n\n- Source: Findable diagnostic snapshot\n- Measured value: 42\n",
      excerpt: "Temporary lifecycle verification article.",
      sourceActionKind: "content_fix",
      sourceActionTarget: marker,
      sourceMeasuredAt: new Date(),
      status: ContentStatus.draft,
      noindex: true,
    },
  });
  contentId = content.id;

  await database.contentRevision.create({
    data: {
      contentId,
      version: 1,
      title: content.title,
      bodyMarkdown: content.bodyMarkdown,
      excerpt: content.excerpt,
      sourceEvidence: { source: "smoke-test", verified: true },
      sourceMetrics: { score: 42 },
      generationPrompt: "Temporary smoke-test prompt",
      model: "deterministic-smoke",
      createdBy: "system:smoke-test",
    },
  });

  await database.content.update({
    where: { id: contentId },
    data: { status: ContentStatus.publisher_review },
  });
  await database.contentReviewEvent.createMany({
    data: [
      {
        contentId,
        type: ContentReviewEventType.generated,
        actorId: "system:smoke-test",
      },
      {
        contentId,
        type: ContentReviewEventType.submitted,
        actorId: "system:smoke-test",
      },
    ],
  });

  await database.content.update({
    where: { id: contentId },
    data: { status: ContentStatus.quality_check },
  });
  await database.contentQualityCheck.create({
    data: {
      contentId,
      status: ContentQualityStatus.passed,
      checks: { evidence: true, structure: true, source: true },
      summary: "Smoke-test quality gate passed.",
    },
  });
  await database.contentReviewEvent.create({
    data: {
      contentId,
      type: ContentReviewEventType.approved,
      actorId: "system:smoke-test",
    },
  });

  await database.content.update({
    where: { id: contentId },
    data: { status: ContentStatus.moderation_review },
  });
  await database.contentReviewEvent.create({
    data: {
      contentId,
      type: ContentReviewEventType.moderation_approved,
      actorId: "system:smoke-test",
    },
  });

  const publicationJob = await database.publicationJob.create({
    data: {
      contentId,
      status: PublicationJobStatus.processing,
      attempts: 1,
      startedAt: new Date(),
    },
  });
  const publishedAt = new Date();
  await database.$transaction([
    database.content.update({
      where: { id: contentId },
      data: {
        status: ContentStatus.published,
        noindex: false,
        publishedAt,
      },
    }),
    database.publicationJob.update({
      where: { id: publicationJob.id },
      data: {
        status: PublicationJobStatus.completed,
        completedAt: publishedAt,
      },
    }),
    database.contentReviewEvent.create({
      data: {
        contentId,
        type: ContentReviewEventType.published,
        actorId: "system:smoke-test",
      },
    }),
  ]);

  const publicContent = await database.content.findFirstOrThrow({
    where: {
      id: contentId,
      status: ContentStatus.published,
      noindex: false,
      publisher: { suspendedAt: null },
    },
    include: {
      publisher: true,
      revisions: true,
      reviewEvents: true,
      qualityChecks: true,
      publicationJobs: true,
    },
  });

  if (
    publicContent.revisions.length !== 1 ||
    publicContent.qualityChecks.length !== 1 ||
    publicContent.publicationJobs[0]?.status !==
      PublicationJobStatus.completed ||
    !publicContent.reviewEvents.some(
      (event) => event.type === ContentReviewEventType.published
    )
  ) {
    throw new Error("Content lifecycle relations did not persist as expected");
  }

  console.log(
    JSON.stringify({
      result: "passed",
      lifecycle: [
        "draft",
        "publisher_review",
        "quality_check",
        "moderation_review",
        "published",
      ],
      publicReadable: true,
      revisionCount: publicContent.revisions.length,
      reviewEventCount: publicContent.reviewEvents.length,
      qualityCheckCount: publicContent.qualityChecks.length,
      publicationJobStatus: publicContent.publicationJobs[0]?.status,
    })
  );
} finally {
  if (contentId) {
    await database.$transaction([
      database.publicationJob.deleteMany({ where: { contentId } }),
      database.contentQualityCheck.deleteMany({ where: { contentId } }),
      database.contentReviewEvent.deleteMany({ where: { contentId } }),
      database.contentRevision.deleteMany({ where: { contentId } }),
      database.content.deleteMany({ where: { id: contentId } }),
    ]);
  }
  if (publisherId) {
    await database.publisher.deleteMany({ where: { id: publisherId } });
  }
  await database.$disconnect();
}
