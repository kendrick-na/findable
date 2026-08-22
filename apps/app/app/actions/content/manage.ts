"use server";

import { generateContentDraft } from "@repo/ai";
import { actionTargetKey } from "@repo/audit/actions";
import { checkContentQuality } from "@repo/audit/content-quality";
import { isAdmin, requireAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database, type Prisma } from "@repo/database";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { latestContentBrief } from "@/lib/content/latest-brief";
import { contentSlug, contentSlugAfterDraftEdit } from "@/lib/content/slug";
import { scopedBrandById } from "@/lib/db/scoped";

export interface ContentActionResult {
  contentId?: string;
  error?: string;
  published?: boolean;
  status?: string;
}

const editSchema = z.object({
  contentId: z.string().uuid(),
  title: z.string().trim().min(8).max(120),
  excerpt: z.string().trim().max(300),
  bodyMarkdown: z.string().trim().min(300).max(50_000),
  contentType: z.enum(["research", "guide", "case_study", "analysis"]),
  series: z.string().trim().max(80),
  tags: z.array(z.string().trim().min(1).max(30)).max(8),
  coverImageUrl: z.union([z.literal(""), z.string().url().max(500)]),
  coverImageAlt: z.string().trim().max(160),
  seoTitle: z.string().trim().max(70),
  seoDescription: z.string().trim().max(180),
  scheduledAt: z.union([z.literal(""), z.string().datetime()]),
  sendNewsletter: z.boolean(),
});

async function ownedContent(contentId: string) {
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const owned = await database.content.findFirst({
    where: {
      id: contentId,
      publisher: { brand: { organizationId: orgId } },
    },
    include: {
      publisher: { include: { brand: true } },
      revisions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (owned || !(await isAdmin())) {
    return owned;
  }
  return database.content.findUnique({
    where: { id: contentId },
    include: {
      publisher: { include: { brand: true } },
      revisions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
}

function refreshContentPaths(content?: {
  locale: string;
  publisher: { slug: string };
  slug: string;
}) {
  revalidatePath("/insights");
  if (content) {
    revalidatePath(`/${content.locale}/insights`);
    revalidatePath(`/${content.locale}/p/${content.publisher.slug}`);
    revalidatePath(
      `/${content.locale}/p/${content.publisher.slug}/${content.slug}`
    );
  }
}

export async function generateDraftFromLatestAction(input: {
  brandId: string;
  locale: "ko" | "en";
}): Promise<ContentActionResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인이 필요합니다." };
  }
  const brand = await scopedBrandById(input.brandId);
  if (!brand) {
    return { error: "브랜드를 찾을 수 없습니다." };
  }
  const brief = await latestContentBrief(brand.id);
  if (!brief) {
    return { error: "먼저 브랜드 측정을 실행해야 초안을 만들 수 있습니다." };
  }
  const draft = await generateContentDraft({
    action: brief.action,
    brand: { name: brand.name, domain: brand.domain },
    locale: input.locale,
    measurement: {
      ...brief.measurement,
      measuredAt: brief.measurement.measuredAt.toISOString(),
    },
  });
  const publisherSlug = `${contentSlug(brand.name || brand.domain)}-${brand.id.slice(0, 8)}`;
  const slug = `${contentSlug(draft.title)}-${Date.now().toString(36)}`;
  const sourceActionTarget = actionTargetKey(brief.action);
  const evidence = {
    title: brief.action.title,
    evidence: brief.action.evidence,
    how: brief.action.how,
    source: brief.action.source ?? null,
  } satisfies Prisma.InputJsonValue;
  const metrics = {
    ...brief.measurement,
    measuredAt: brief.measurement.measuredAt.toISOString(),
  } satisfies Prisma.InputJsonValue;

  const publisher = await database.publisher.upsert({
    where: { brandId: brand.id },
    create: {
      kind: "brand",
      brandId: brand.id,
      slug: publisherSlug,
      name: brand.name || brand.domain,
      websiteUrl: `https://${brand.domain}`,
    },
    update: {
      name: brand.name || brand.domain,
      websiteUrl: `https://${brand.domain}`,
    },
  });
  const content = await database.content.create({
    data: {
      publisherId: publisher.id,
      sourceActionKind: brief.action.kind,
      sourceActionTarget,
      sourceMeasuredAt: brief.measurement.measuredAt,
      locale: input.locale,
      slug,
      title: draft.title,
      bodyMarkdown: draft.bodyMarkdown,
      excerpt: draft.excerpt,
      contentType: "guide",
      status: "publisher_review",
      noindex: true,
      revisions: {
        create: {
          version: 1,
          title: draft.title,
          bodyMarkdown: draft.bodyMarkdown,
          excerpt: draft.excerpt,
          sourceEvidence: evidence,
          sourceMetrics: metrics,
          generationPrompt: draft.generationPrompt,
          model: draft.model,
          createdBy: userId,
        },
      },
      reviewEvents: {
        create: {
          type: "generated",
          actorId: userId,
          note: draft.usedFallback
            ? "AI 공급자 실패로 근거 기반 안전 템플릿을 사용했습니다."
            : "최근 측정의 content_fix 액션에서 초안을 생성했습니다.",
        },
      },
    },
  });
  refreshContentPaths();
  return { contentId: content.id, status: content.status };
}

export async function createPublisherDraft(input: {
  brandId: string;
  locale: "ko" | "en";
}): Promise<ContentActionResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인이 필요합니다." };
  }
  const brand = await scopedBrandById(input.brandId);
  if (!brand) {
    return { error: "브랜드를 찾을 수 없습니다." };
  }
  const ko = input.locale === "ko";
  const title = ko ? "새 블로그 글 초안" : "New blog post draft";
  const excerpt = ko
    ? "독자가 이 글에서 얻게 될 답을 한두 문장으로 적어주세요."
    : "Summarize the answer readers will get from this article.";
  const bodyMarkdown = ko
    ? "독자가 검색하거나 AI에게 물을 질문에 첫 문단에서 직접 답하세요. 이 안내 문장을 실제 답변으로 바꿔주세요.\n\n## 핵심 답변\n\n누가, 언제, 어떤 조건에서 적용할 수 있는지 구체적으로 적어주세요.\n\n## 확인 가능한 근거\n\n주장마다 원출처 링크, 측정일, 표본과 조건을 붙이세요. 확인하지 못한 수치나 가상의 사례는 쓰지 마세요.\n\n## 실행 방법\n\n독자가 그대로 따라 할 수 있도록 순서와 판단 기준을 적어주세요.\n\n## 한계와 다음 단계\n\n이 글이 다루지 않은 범위와 다음에 확인할 항목을 밝혀주세요."
    : "Answer the reader's search or AI question directly in the first paragraph. Replace this guidance with the actual answer.\n\n## Direct answer\n\nState who can use this, when, and under which conditions.\n\n## Verifiable evidence\n\nAttach original-source links, dates, samples, and conditions to each claim. Never invent figures or examples.\n\n## How to apply it\n\nGive readers an ordered method and decision criteria they can follow.\n\n## Limits and next step\n\nState what this article does not cover and what should be checked next.";
  const publisherSlug = `${contentSlug(brand.name || brand.domain)}-${brand.id.slice(0, 8)}`;
  const publisher = await database.publisher.upsert({
    where: { brandId: brand.id },
    create: {
      kind: "brand",
      brandId: brand.id,
      slug: publisherSlug,
      name: brand.name || brand.domain,
      websiteUrl: `https://${brand.domain}`,
    },
    update: {
      name: brand.name || brand.domain,
      websiteUrl: `https://${brand.domain}`,
    },
  });
  const content = await database.content.create({
    data: {
      publisherId: publisher.id,
      locale: input.locale,
      slug: `${contentSlug(title)}-${Date.now().toString(36)}`,
      title,
      excerpt,
      bodyMarkdown,
      contentType: "guide",
      status: "publisher_review",
      noindex: true,
      revisions: {
        create: {
          version: 1,
          title,
          excerpt,
          bodyMarkdown,
          model: "customer-editorial-template-v1",
          sourceEvidence: {
            kind: "publisher_editorial",
            note: "발행 전 본문에 원출처와 근거 범위를 추가한다.",
          },
          createdBy: userId,
        },
      },
      reviewEvents: {
        create: {
          type: "generated",
          actorId: userId,
          note: "고객 퍼블리셔가 빈 편집 템플릿에서 시작했습니다.",
        },
      },
    },
  });
  refreshContentPaths();
  return { contentId: content.id, status: content.status };
}

export async function createFindableDraft(
  locale: "ko" | "en"
): Promise<ContentActionResult> {
  const actorId = await requireAdmin();
  const ko = locale === "ko";
  const publisher = await database.publisher.upsert({
    where: { slug: "findable" },
    create: {
      kind: "findable",
      slug: "findable",
      name: "Findable",
      description: ko
        ? "SEO·GEO 실측 데이터와 실행 방법을 공개합니다."
        : "Publishing measured SEO/GEO evidence and practical methods.",
      websiteUrl: "https://www.findable.co.kr",
      verifiedAt: new Date(),
    },
    update: { verifiedAt: new Date(), suspendedAt: null },
  });
  const title = ko ? "새 Findable 리서치 초안" : "New Findable research draft";
  const excerpt = ko
    ? "이 글에서 답할 질문과 독자가 얻게 될 결론을 한두 문장으로 적어주세요."
    : "Summarize the reader question and the conclusion this article will deliver.";
  const bodyMarkdown = ko
    ? "독자가 검색하거나 AI에게 물을 질문에 먼저 답하세요. 이 문단을 실제 결론으로 바꿔주세요.\n\n## 측정 근거\n\n측정일, 표본, 사용한 질문, 엔진, 수치를 적고 시장 전체로 일반화하지 마세요. 원자료 링크가 있다면 함께 적어주세요.\n\n## 무엇을 발견했나\n\n관찰한 패턴과 예외를 구분해 설명하세요. 확인하지 못한 것은 확인하지 못했다고 밝히세요.\n\n## 실행 방법\n\n독자가 바로 적용할 수 있는 순서와 판단 기준을 적어주세요.\n\n## 다음 측정\n\n발행 후 무엇을 언제 같은 조건으로 다시 측정할지 적어주세요."
    : "Answer the question a reader would search or ask an AI. Replace this paragraph with the actual conclusion.\n\n## Measurement basis\n\nState the date, sample, prompts, engines, and figures without generalizing to the whole market. Link the original data when available.\n\n## What we found\n\nSeparate observed patterns from exceptions. Say explicitly what was not measured.\n\n## How to act\n\nGive the reader an ordered method and concrete decision criteria.\n\n## Next measurement\n\nState what will be measured again, under the same conditions, and when.";
  const content = await database.content.create({
    data: {
      publisherId: publisher.id,
      locale,
      slug: `${contentSlug(title)}-${Date.now().toString(36)}`,
      title,
      excerpt,
      bodyMarkdown,
      contentType: "research",
      series: ko ? "Findable Research" : "Findable Research",
      tags: ko ? ["SEO", "GEO", "AI 검색"] : ["SEO", "GEO", "AI search"],
      status: "publisher_review",
      noindex: true,
      revisions: {
        create: {
          version: 1,
          title,
          excerpt,
          bodyMarkdown,
          model: "human-editorial-template-v1",
          sourceEvidence: {
            kind: "findable_editorial",
            note: "발행 전 측정일·표본·원출처를 본문에서 확인한다.",
          },
          createdBy: actorId,
        },
      },
      reviewEvents: {
        create: {
          type: "generated",
          actorId,
          note: "Findable 공식 리서치 편집 템플릿에서 생성했습니다.",
        },
      },
    },
  });
  refreshContentPaths();
  return { contentId: content.id, status: content.status };
}

export async function saveContentDraft(
  raw: z.input<typeof editSchema>
): Promise<ContentActionResult> {
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "제목과 본문을 확인해 주세요." };
  }
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인이 필요합니다." };
  }
  const content = await ownedContent(parsed.data.contentId);
  if (!content || ["published", "archived"].includes(content.status)) {
    return { error: "수정할 수 있는 콘텐츠를 찾지 못했습니다." };
  }
  const version = (content.revisions[0]?.version ?? 0) + 1;
  const slug = contentSlugAfterDraftEdit({
    currentSlug: content.slug,
    publisherKind: content.publisher.kind,
    title: parsed.data.title,
  });
  await database.$transaction([
    database.content.update({
      where: { id: content.id },
      data: {
        title: parsed.data.title,
        excerpt: parsed.data.excerpt || null,
        bodyMarkdown: parsed.data.bodyMarkdown,
        contentType: parsed.data.contentType,
        series: parsed.data.series || null,
        tags: parsed.data.tags,
        coverImageUrl: parsed.data.coverImageUrl || null,
        coverImageAlt: parsed.data.coverImageAlt || null,
        seoTitle: parsed.data.seoTitle || null,
        seoDescription: parsed.data.seoDescription || null,
        scheduledAt: parsed.data.scheduledAt
          ? new Date(parsed.data.scheduledAt)
          : null,
        sendNewsletter: parsed.data.sendNewsletter,
        slug,
        status: "publisher_review",
      },
    }),
    database.contentRevision.create({
      data: {
        contentId: content.id,
        version,
        title: parsed.data.title,
        excerpt: parsed.data.excerpt || null,
        bodyMarkdown: parsed.data.bodyMarkdown,
        sourceEvidence: content.revisions[0]?.sourceEvidence ?? undefined,
        sourceMetrics: content.revisions[0]?.sourceMetrics ?? undefined,
        createdBy: userId,
      },
    }),
    database.contentReviewEvent.create({
      data: { contentId: content.id, type: "edited", actorId: userId },
    }),
  ]);
  refreshContentPaths({ ...content, slug });
  return { contentId: content.id, status: "publisher_review" };
}

export async function withdrawContentReview(
  contentId: string
): Promise<ContentActionResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인이 필요합니다." };
  }
  const content = await ownedContent(contentId);
  if (!content || content.status !== "moderation_review") {
    return { error: "철회할 검수 요청을 찾지 못했습니다." };
  }
  await database.$transaction([
    database.content.update({
      where: { id: content.id },
      data: { status: "publisher_review", noindex: true },
    }),
    database.contentReviewEvent.create({
      data: {
        contentId: content.id,
        type: "edited",
        actorId: userId,
        note: "운영 검수 요청 철회",
      },
    }),
  ]);
  refreshContentPaths(content);
  return { contentId, status: "publisher_review" };
}

async function publishContent(
  content: NonNullable<Awaited<ReturnType<typeof ownedContent>>>,
  actorId: string
) {
  const startedAt = new Date();
  const sourceMetrics = content.revisions[0]?.sourceMetrics as {
    enginesMeasured?: number;
    enginesMentioned?: number;
    shareOfVoice?: number | null;
  } | null;
  const recognitionAtCompletion =
    sourceMetrics?.enginesMeasured &&
    typeof sourceMetrics.enginesMentioned === "number"
      ? sourceMetrics.enginesMentioned / sourceMetrics.enginesMeasured
      : null;
  const sovAtCompletion =
    typeof sourceMetrics?.shareOfVoice === "number"
      ? sourceMetrics.shareOfVoice
      : null;
  const job = await database.publicationJob.create({
    data: {
      contentId: content.id,
      status: "processing",
      attempts: 1,
      startedAt,
    },
  });
  try {
    await database.$transaction([
      database.content.update({
        where: { id: content.id },
        data: { status: "published", noindex: false, publishedAt: new Date() },
      }),
      database.contentReviewEvent.create({
        data: { contentId: content.id, type: "published", actorId },
      }),
      database.publicationJob.update({
        where: { id: job.id },
        data: { status: "completed", completedAt: new Date() },
      }),
      ...(content.sendNewsletter && content.publisher.newsletterEnabled
        ? [
            database.newsletterCampaign.upsert({
              where: { contentId: content.id },
              create: { contentId: content.id, status: "queued" },
              update: { status: "queued", lastError: null },
            }),
          ]
        : []),
      ...(content.publisher.brandId && content.sourceActionKind
        ? [
            database.actionCompletion.upsert({
              where: {
                brandId_kind_target: {
                  brandId: content.publisher.brandId,
                  kind: content.sourceActionKind,
                  target: content.sourceActionTarget ?? "",
                },
              },
              create: {
                brandId: content.publisher.brandId,
                kind: content.sourceActionKind,
                target: content.sourceActionTarget ?? "",
                completedBy: actorId,
                sovAtCompletion,
                recognitionAtCompletion,
              },
              update: {
                completedAt: new Date(),
                completedBy: actorId,
                sovAtCompletion,
                recognitionAtCompletion,
              },
            }),
            database.annotation.create({
              data: {
                brandId: content.publisher.brandId,
                occurredAt: new Date(),
                label: `콘텐츠 발행: ${content.title.slice(0, 120)}`,
                createdBy: actorId,
              },
            }),
          ]
        : []),
    ]);
  } catch (error) {
    await database.publicationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

async function scheduleOrPublishContent(
  content: NonNullable<Awaited<ReturnType<typeof ownedContent>>>,
  actorId: string
) {
  if (content.scheduledAt && content.scheduledAt.getTime() > Date.now()) {
    await database.$transaction([
      database.content.update({
        where: { id: content.id },
        data: { status: "scheduled", noindex: true },
      }),
      database.publicationJob.create({
        data: {
          contentId: content.id,
          status: "queued",
          scheduledAt: content.scheduledAt,
        },
      }),
      database.contentReviewEvent.create({
        data: {
          contentId: content.id,
          type: "scheduled",
          actorId,
          note: content.scheduledAt.toISOString(),
        },
      }),
    ]);
    return "scheduled" as const;
  }
  await publishContent(content, actorId);
  return "published" as const;
}

export async function approveContent(
  contentId: string
): Promise<ContentActionResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인이 필요합니다." };
  }
  const content = await ownedContent(contentId);
  if (!content || content.status !== "publisher_review") {
    return { error: "승인 대기 중인 콘텐츠를 찾지 못했습니다." };
  }
  const latestRevision = content.revisions[0];
  const quality = checkContentQuality({
    title: content.title,
    bodyMarkdown: content.bodyMarkdown,
    sourceEvidence: latestRevision?.sourceEvidence,
  });
  await database.$transaction([
    database.content.update({
      where: { id: content.id },
      data: { status: "quality_check" },
    }),
    database.contentReviewEvent.create({
      data: { contentId: content.id, type: "approved", actorId: userId },
    }),
    database.contentQualityCheck.create({
      data: {
        contentId: content.id,
        status: quality.status,
        checks: quality.checks,
        summary: quality.summary,
      },
    }),
  ]);

  if (quality.status === "failed") {
    await database.content.update({
      where: { id: content.id },
      data: { status: "publisher_review" },
    });
    refreshContentPaths(content);
    return { error: quality.summary, contentId, status: "publisher_review" };
  }
  if (!content.publisher.verifiedAt || quality.status === "warning") {
    await database.content.update({
      where: { id: content.id },
      data: { status: "moderation_review", noindex: true },
    });
    refreshContentPaths(content);
    return { contentId, status: "moderation_review" };
  }
  try {
    const status = await scheduleOrPublishContent(content, userId);
    refreshContentPaths(content);
    return {
      contentId,
      status,
      published: status === "published",
    };
  } catch {
    await database.content.update({
      where: { id: content.id },
      data: { status: "publisher_review", noindex: true },
    });
    refreshContentPaths(content);
    return {
      contentId,
      error: "발행 작업이 실패했습니다. 원문은 보존됐어요. 다시 승인해 주세요.",
      status: "publisher_review",
    };
  }
}

export async function moderateContent(input: {
  approve: boolean;
  contentId: string;
  note?: string;
  reviewConfirmed: boolean;
}): Promise<ContentActionResult> {
  const actorId = await requireAdmin();
  const content = await database.content.findUnique({
    where: { id: input.contentId },
    include: {
      publisher: { include: { brand: true } },
      revisions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!content || content.status !== "moderation_review") {
    return { error: "운영 검수 대기 콘텐츠를 찾지 못했습니다." };
  }
  if (input.approve && !input.reviewConfirmed) {
    return { error: "원문과 출처를 확인한 뒤 승인해 주세요." };
  }
  if (!(input.approve || input.note?.trim())) {
    return { error: "수정 요청 사유를 적어 주세요." };
  }
  if (!input.approve) {
    await database.$transaction([
      database.content.update({
        where: { id: content.id },
        data: { status: "publisher_review", noindex: true },
      }),
      database.contentReviewEvent.create({
        data: {
          contentId: content.id,
          type: "moderation_rejected",
          actorId,
          note: input.note,
        },
      }),
    ]);
    refreshContentPaths(content);
    return { contentId: content.id, status: "publisher_review" };
  }
  const quality = checkContentQuality({
    title: content.title,
    bodyMarkdown: content.bodyMarkdown,
    sourceEvidence: content.revisions[0]?.sourceEvidence,
  });
  if (quality.status === "failed") {
    await database.$transaction([
      database.content.update({
        where: { id: content.id },
        data: { status: "publisher_review", noindex: true },
      }),
      database.contentQualityCheck.create({
        data: {
          contentId: content.id,
          status: quality.status,
          checks: quality.checks,
          summary: quality.summary,
        },
      }),
      database.contentReviewEvent.create({
        data: {
          contentId: content.id,
          type: "moderation_rejected",
          actorId,
          note: `최신 품질 검사 실패: ${quality.summary}`,
        },
      }),
    ]);
    refreshContentPaths(content);
    return {
      contentId: content.id,
      error: `최신 품질 검사 실패: ${quality.summary}`,
      status: "publisher_review",
    };
  }
  await database.contentQualityCheck.create({
    data: {
      contentId: content.id,
      status: quality.status,
      checks: quality.checks,
      summary: quality.summary,
    },
  });
  await database.contentReviewEvent.create({
    data: {
      contentId: content.id,
      type: "moderation_approved",
      actorId,
      note: input.note,
    },
  });
  try {
    const status = await scheduleOrPublishContent(content, actorId);
    refreshContentPaths(content);
    return {
      contentId: content.id,
      status,
      published: status === "published",
    };
  } catch {
    refreshContentPaths(content);
    return {
      contentId: content.id,
      error:
        "발행 작업이 실패했습니다. 검수 대기 상태에서 다시 시도할 수 있습니다.",
      status: "moderation_review",
    };
  }
}

export async function cancelScheduledContent(
  contentId: string
): Promise<ContentActionResult> {
  const { userId } = await auth();
  if (!userId) {
    return { error: "로그인이 필요합니다." };
  }
  const content = await ownedContent(contentId);
  if (!content || content.status !== "scheduled") {
    return { error: "예약 발행 중인 콘텐츠를 찾지 못했습니다." };
  }
  await database.$transaction([
    database.content.update({
      where: { id: content.id },
      data: { status: "publisher_review", noindex: true },
    }),
    database.publicationJob.updateMany({
      where: { contentId, status: "queued" },
      data: { status: "cancelled" },
    }),
    database.contentReviewEvent.create({
      data: {
        contentId,
        type: "edited",
        actorId: userId,
        note: "예약 발행 철회",
      },
    }),
  ]);
  refreshContentPaths(content);
  return { contentId, status: "publisher_review" };
}
