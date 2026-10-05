"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startOrgTracking } from "@/app/actions/brand/start-tracking";
import { getTrackingStatus } from "@/app/actions/brand/tracking-status";
import type { AppDictionary } from "@/lib/i18n";

/**
 * "측정 시작" 버튼 — 로그인 org 사용자가 특정 브랜드의 AI 인용 audit을 트리거 (20번).
 *
 * P2 전환(2026-07-29): 예전엔 www의 /api/audit/org를 브라우저 직결 fetch(credentials:"include")로
 *   크로스오리진 호출했다(→ CORS·크로스쿠키·satellite 설정 의존의 원천). 이제 러너가 @repo/audit로
 *   빠져서, app 서버 액션 startOrgTracking을 호출하고 그 안에서 runAuditJob을 직접 실행한다.
 *   - orgId/brandId를 넘기지 않는다 → 서버 액션이 auth()로 orgId 재도출·brandId 서버도출(위조 불가).
 *
 * UX 개선(2026-07-30): 용어 "추적 시작"→"측정 시작" 통일 + 진행상태 가시화.
 *   시작 성공 후 getTrackingStatus를 폴링해 완료/실패를 토스트로 알리고 화면을 새로고침한다
 *   (예전엔 시작 토스트만 뜨고 결과가 어디에 언제 나오는지 알 수 없었다).
 *   rate-limit(무료 24시간 1회)은 "요금제 보기" 액션과 함께 이유를 안내한다.
 */

const POLL_INTERVAL_MS = 8000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

type Phase = "idle" | "starting" | "measuring";

export const StartTrackingButton = ({
  domain,
  brandName,
  // 대시보드의 추세 카드처럼 프로필 전체를 읽지 않는 표면은 서버 가드를 최종
  // 방어선으로 사용한다. 브랜드·측정 화면은 명시값을 넘겨 CTA부터 막는다.
  identityReady = true,
  t,
}: {
  domain: string;
  brandName: string;
  identityReady?: boolean;
  /** 사전 `app.trackButton` (client 라 서버가 넘긴다). */
  t: AppDictionary["trackButton"];
}) => {
  const phaseLabel: Record<Phase, string> = {
    idle: t.idle,
    starting: t.starting,
    measuring: t.measuring,
  };
  const withBrand = (template: string) =>
    template.replace("{brand}", brandName);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // 언마운트 시 폴링 정리(페이지 이동 후 유령 토스트 방지). ref만 만져 의존성 없음.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    },
    []
  );

  const watchJob = (jobId: string) => {
    const startedAt = Date.now();
    let delayNotified = false;
    timerRef.current = setInterval(async () => {
      if (!delayNotified && Date.now() - startedAt > POLL_TIMEOUT_MS) {
        delayNotified = true;
        toast.info(withBrand(t.slow));
      }
      try {
        const status = await getTrackingStatus(jobId);
        if (status === "completed") {
          stopPolling();
          setPhase("idle");
          toast.success(withBrand(t.done));
          router.refresh();
        } else if (status === "failed") {
          stopPolling();
          setPhase("idle");
          toast.error(withBrand(t.failed));
          router.refresh();
        }
        // queued/processing → 다음 폴링까지 대기.
      } catch {
        // 일시적 네트워크 오류는 다음 폴링에서 재시도.
      }
    }, POLL_INTERVAL_MS);
  };

  const start = async () => {
    setPhase("starting");
    try {
      const result = await startOrgTracking({ domain, brandName });
      if ("error" in result) {
        setPhase("idle");
        if (result.code === "unauthorized") {
          toast.error(t.authFailed);
          return;
        }
        if (result.upgrade) {
          // 플랜 업그레이드로 풀리는 제한 → 이유 + 해결 경로를 함께 안내.
          toast.error(result.error, {
            action: {
              label: t.viewPlans,
              onClick: () => router.push("/billing"),
            },
          });
          return;
        }
        toast.error(result.error);
        return;
      }
      setPhase("measuring");
      toast.success(withBrand(t.started));
      router.refresh();
      watchJob(result.jobId);
    } catch {
      setPhase("idle");
      toast.error(t.startFailed);
    }
  };

  return (
    <Button
      className="findable-btn-secondary"
      disabled={phase !== "idle" || !identityReady}
      onClick={start}
      size="sm"
      type="button"
      variant="outline"
    >
      {identityReady ? phaseLabel[phase] : t.identityNeeded}
    </Button>
  );
};
