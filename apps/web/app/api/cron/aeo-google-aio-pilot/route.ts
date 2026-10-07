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

/**
 * 실측(2026-10-07) 응답 18~36초 · 요청 상한 60초 · 동시 5 → 20문항 브랜드 1곳 최악 ≈ 240초.
 * 그래서 새 브랜드는 처음 30초 안에만 시작하고(사실상 실행당 1곳 — 남은 브랜드는 다음 날),
 * 270초에 남은 요청을 끊어 저장할 시간을 남긴다.
 */
const START_BUDGET_MS = 30_000;
const ABORT_AFTER_MS = 270_000;

export const GET = async (request: NextRequest) => {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }
  if (!isAeoPilotEnabled() || aeoPilotAllowlist().length === 0) {
    return NextResponse.json({ ok: true, enabled: false });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABORT_AFTER_MS);
  try {
    const summary = await runAeoGoogleAioPilot({
      deadlineMs: Date.now() + START_BUDGET_MS,
      signal: controller.signal,
    });
    return NextResponse.json({ ok: true, ...summary });
  } finally {
    clearTimeout(timer);
  }
};
