/** Disposable local DB fixture: product generator -> persisted JSON -> public UI. */
import { PrismaPg } from "@prisma/adapter-pg";
import {
  hasCompleteNaverSearchBaseline,
  summarizeVerdicts,
} from "../../audit/action-rules";
import { buildGeoActions } from "../../audit/actions";
import {
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "../../audit/normalize-stored-metrics";
import { PrismaClient } from "../generated/client";

const jobId = "00000000-0000-4000-8000-000000000042";
const brandName = "W1 Route Fixture";
const domain = "example.invalid";
const connectionString = process.env.DATABASE_URL;
if (
  !connectionString ||
  process.env.FINDABLE_W1_E2E_SEED_CONFIRM !== "local-disposable"
) {
  throw new Error(
    "Explicit disposable W1 seed confirmation and DATABASE_URL required"
  );
}
const target = new URL(connectionString);
if (
  !(
    ["localhost", "127.0.0.1", "::1"].includes(target.hostname) &&
    target.pathname.slice(1).startsWith("findable_w1_")
  )
) {
  throw new Error("W1 seed refuses non-loopback or non-disposable database");
}

const aiRows = Array.from({ length: 10 }, (_, promptIndex) => ({
  engineId: "chatgpt",
  promptIndex,
  promptKind: "brand",
  promptText: `What is ${brandName} ${promptIndex + 1}?`,
  brandMentioned: promptIndex < 2,
  mentionQuality: promptIndex < 2 ? "confirmed" : "absent",
  mentionPosition: promptIndex < 2 ? 1 : null,
  sentiment: "neutral",
  shareOfVoice: promptIndex < 2 ? 1 : 0,
  durationMs: 10,
  isStub: false,
  errorMessage: null,
  excerpt: promptIndex < 2 ? `${brandName} is a brand.` : "Brand not found.",
}));
const searchRows = aiRows.map((row) => ({
  ...row,
  engineId: "naver",
  naverSource: "search_results",
  promptText: `W1 Route Fixture 소개 ${row.promptIndex + 1}`,
  brandMentioned: false,
  mentionQuality: "absent",
  mentionPosition: null,
  shareOfVoice: 0,
  excerpt: "No matching Naver search result.",
}));
const verdicts = summarizeVerdicts(aiRows, { brandName, brandDomain: domain });
const actions = buildGeoActions({
  averageMentionPosition: null,
  brandDomain: domain,
  brandName,
  enginesMeasured: 1,
  enginesMentioned: 1,
  marketScope: "korea",
  naverSearchMeasured: hasCompleteNaverSearchBaseline(
    searchRows,
    aiRows.length
  ),
  verdicts,
});
if (!actions.some((action) => action.kind === "naver_blog")) {
  throw new Error("Fixture must generate a Naver card from low AI awareness");
}
const result = withRecomputedAuditMetrics({
  brandName,
  domain,
  mentionVerdictVersion: 2,
  promptsCount: 10,
  engineResponses: [...aiRows, ...searchRows],
  geoActions: actions,
  topRecommendations: [],
  metrics: { sov: 20, verifiedCount: 20, unverifiedCount: 0 },
});
if (!isPublishableAuditResult(result)) {
  throw new Error("Fixture must satisfy current free publication gate");
}

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
try {
  const savedResult = JSON.parse(JSON.stringify(result));
  await client.auditJob.upsert({
    where: { id: jobId },
    create: {
      id: jobId,
      email: "w1-generated-fixture@example.invalid",
      domain,
      status: "completed",
      result: savedResult,
      completedAt: new Date(),
    },
    update: {
      status: "completed",
      result: savedResult,
      completedAt: new Date(),
    },
  });
  process.stdout.write(
    `Seeded generated W1 action fixture ${jobId}; actions=${actions.map((action) => action.kind).join(",")}\n`
  );
} finally {
  await client.$disconnect();
}
