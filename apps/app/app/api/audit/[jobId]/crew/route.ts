import { runCrewForAuditJob } from "@repo/audit/crew-runner";
import { kstDayStart } from "@repo/audit/kst-day";
import {
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";
import { auth, currentUser } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { after, NextResponse } from "next/server";
import { auditJobScope } from "@/app/(authenticated)/lib/audit-job-scope";
import { getPrimaryEmail } from "@/app/(authenticated)/lib/user";
import { getAppDictionary } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 300;

const STALE_AFTER_MS = 15 * 60 * 1000;
const DAILY_CREW_CAP = Math.max(
  1,
  Number(process.env.FINDABLE_DAILY_CREW_CAP ?? 200)
);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const t = (await getAppDictionary()).crewErrors;
  const user = await currentUser();
  const email = user ? getPrimaryEmail(user) : null;
  const { orgId } = await auth();
  const scope = auditJobScope(email, orgId);
  if (!scope) {
    return NextResponse.json({ error: t.signIn }, { status: 401 });
  }

  const job = await database.auditJob.findFirst({
    where: { id: jobId, ...scope },
    select: {
      id: true,
      status: true,
      result: true,
      crewStatus: true,
      crewStartedAt: true,
    },
  });
  if (!job) {
    return NextResponse.json({ error: t.notFound }, { status: 404 });
  }
  if (job.status !== "completed" || !job.result) {
    return NextResponse.json({ error: t.notCompleted }, { status: 400 });
  }
  if (!isPublishableAuditResult(withRecomputedAuditMetrics(job.result))) {
    return NextResponse.json({ error: t.notVerified }, { status: 409 });
  }
  if (job.crewStatus === "completed") {
    return NextResponse.json(
      { error: t.alreadyDone, crewStatus: "completed" },
      { status: 409 }
    );
  }
  const isStale =
    job.crewStartedAt &&
    Date.now() - job.crewStartedAt.getTime() > STALE_AFTER_MS;
  if (
    (job.crewStatus === "queued" || job.crewStatus === "processing") &&
    !isStale
  ) {
    return NextResponse.json(
      { error: t.alreadyRunning, crewStatus: job.crewStatus },
      { status: 409 }
    );
  }

  const startedToday = await database.auditJob.count({
    where: { crewStartedAt: { gte: kstDayStart(new Date()) } },
  });
  if (startedToday >= DAILY_CREW_CAP) {
    return NextResponse.json(
      {
        error: t.dailyLimit,
      },
      { status: 429 }
    );
  }

  await database.auditJob.update({
    where: { id: job.id },
    data: { crewStatus: "queued", crewStartedAt: new Date() },
  });
  after(async () => {
    try {
      await runCrewForAuditJob({ jobId: job.id });
    } catch (error) {
      log.error("dashboard.crew.unhandled", { jobId: job.id, error });
    }
  });
  return NextResponse.json({ jobId: job.id, crewStatus: "queued" });
}
