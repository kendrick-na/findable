"use server";

import { hasPlan } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { auth } from "@repo/auth/server";
import { scopedBrandById } from "@/lib/db/scoped";
import {
  createSiteReadinessRun,
  executeSiteReadinessRun,
} from "@/lib/site-readiness/runs";
import type { SiteReadinessActionState } from "@/lib/site-readiness/types";

export async function runSiteReadiness(
  _previous: SiteReadinessActionState,
  formData: FormData
): Promise<SiteReadinessActionState> {
  const { userId, orgId } = await auth();
  if (!(userId && orgId)) {
    return { status: "error", error: "AUTH_REQUIRED" };
  }
  const plan = await getCurrentPlan();
  if (!hasPlan(plan, "growth")) {
    return { status: "error", error: "PLAN_REQUIRED" };
  }

  const url = String(formData.get("url") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  try {
    const brand = await scopedBrandById(brandId);
    if (!brand) {
      return { status: "error", error: "BRAND_REQUIRED" };
    }
    const run = await createSiteReadinessRun({
      brandId: brand.id,
      organizationId: orgId,
      targetUrl: url,
      trigger: "manual",
    });
    if (run.reused) {
      return { status: "error", error: "RUNNING" };
    }
    const report = await executeSiteReadinessRun(run.id);
    if (!report) {
      return { status: "error", error: "UNKNOWN" };
    }
    return { status: "ok", report };
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    return {
      status: "error",
      error: code === "BRAND_FORBIDDEN" ? "BRAND_REQUIRED" : code,
    };
  }
}
