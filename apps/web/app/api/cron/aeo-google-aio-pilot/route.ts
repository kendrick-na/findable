// AEO 시범 cron — 구글 AI 개요 측정(2026-10-07 대표 승인 · Bright Data 무료 범위)
//
// 매일 1번 깨어나지만 브랜드당 주 1회만 잰다(러너가 마지막 측정 시각을 본다).
// AEO_GOOGLE_AIO_PILOT=true + AEO_PILOT_BRANDS 가 없으면 DB 도 외부 API 도 건드리지 않고 끝난다.
// 결과는 AuditJob.result.aeoPilotRuns[] 에만 — GEO 점수·추세·Tracking 무관.
// 세부 계약: packages/audit/aeo-google-aio-pilot.ts
//
// 인증: `denyIfNotCron` 단일 진실(`CRON_SECRET` Bearer · Preview 는 무조건 거절).

import {
  aeoPilotAllowlist,
  isAeoPilotEnabled,
  runAeoGoogleAioPilot,
} from "@repo/audit/aeo-google-aio-pilot";
import { denyIfNotCron } from "@repo/security/cron";
import { type NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

/** 새 브랜드를 시작하지 않는 시점(20문항 × 동시 4 × 응답 ≈ 15초 ≈ 75초 + 저장 여유). */
const START_BUDGET_MS = 180_000;

export const GET = async (request: NextRequest) => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }
  if (!isAeoPilotEnabled() || aeoPilotAllowlist().length === 0) {
    return NextResponse.json({ ok: true, enabled: false });
  }
  const summary = await runAeoGoogleAioPilot({
    deadlineMs: Date.now() + START_BUDGET_MS,
  });
  return NextResponse.json({ ok: true, ...summary });
};
