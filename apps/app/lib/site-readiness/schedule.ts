import "server-only";

import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { after } from "next/server";
import { createSiteReadinessRun, executeSiteReadinessRun } from "./runs";
import type { SiteReadinessTrigger } from "./types";

/**
 * 요청 응답을 막지 않고 사이트 준비도 측정을 예약한다.
 * 동일 브랜드의 최근 실행이 진행 중이면 새 실행을 만들지 않는다.
 */
export async function scheduleSiteReadinessRun(input: {
  brandId: string;
  organizationId: string;
  targetUrl: string;
  trigger: SiteReadinessTrigger;
}): Promise<string | null> {
  try {
    const run = await createSiteReadinessRun(input);
    if (!run.reused) {
      after(async () => {
        try {
          await executeSiteReadinessRun(run.id);
        } catch (error) {
          log.error("site_readiness.background_uncaught", {
            runId: run.id,
            error: parseError(error),
          });
        }
      });
    }
    return run.id;
  } catch (error) {
    // 기술 진단 예약 실패가 가입·브랜드 저장 자체를 막아서는 안 된다.
    log.error("site_readiness.schedule_failed", {
      brandId: input.brandId,
      organizationId: input.organizationId,
      trigger: input.trigger,
      error: parseError(error),
    });
    return null;
  }
}
