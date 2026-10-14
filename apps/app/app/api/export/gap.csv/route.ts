// /api/export/gap.csv — 경쟁사 빈틈 분석 CSV(2026-10-15). 유료 전용, 브랜드는 세션 org 소유만.
import { parseKnownCompetitors } from "@repo/audit/competitor-extract";
import { isPaid } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { currentUser } from "@repo/auth/server";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { scopedBrandById, scopedLatestCompletedAudit } from "@/lib/db/scoped";
import { loadAnswerBrands } from "@/lib/gap/answer-brand-store";
import { answerRowsOf, buildGapAnalysis } from "@/lib/gap/gap-analysis";
import { gapCsv } from "@/lib/gap/gap-csv";
import { getAppDictionary } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UTF8_BOM = "﻿";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!isPaid(await getCurrentPlan())) {
      return new Response("Upgrade required", { status: 402 });
    }
    const brandId = new URL(request.url).searchParams.get("brand");
    const brand = brandId ? await scopedBrandById(brandId) : null;
    if (!brand) {
      return new Response("Not found", { status: 404 });
    }
    const latest = await scopedLatestCompletedAudit(brand.id);
    const cached = latest ? await loadAnswerBrands(latest.id) : null;
    if (!(latest && cached)) {
      return new Response("Not analyzed", { status: 404 });
    }
    const data = buildGapAnalysis({
      rows: answerRowsOf(latest.result),
      brandsByKey: cached,
      competitors: parseKnownCompetitors(brand.competitors),
      own: {
        name: brand.name,
        domain: brand.domain,
        variants: Array.isArray(brand.entityVariants)
          ? brand.entityVariants.filter(
              (v): v is string => typeof v === "string"
            )
          : [],
      },
    });
    const t = (await getAppDictionary()).gapPanel;
    const stamp = new Date().toISOString().slice(0, 10);
    log.info("export.gap_csv", { brandId: brand.id, userId: user.id });
    return new Response(UTF8_BOM + gapCsv(data, t), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="findable-gap-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("export.gap_csv_failed", { error: parseError(error) });
    return new Response("Export failed", { status: 500 });
  }
}
