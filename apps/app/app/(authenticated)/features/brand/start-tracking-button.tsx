"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startOrgTracking } from "@/app/actions/brand/start-tracking";
import { getTrackingStatus } from "@/app/actions/brand/tracking-status";

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

const PHASE_LABEL: Record<Phase, string> = {
  idle: "측정 시작",
  starting: "시작 중…",
  measuring: "측정 중…",
};

export const StartTrackingButton = ({
  domain,
  brandName,
}: {
  domain: string;
  brandName: string;
}) => {
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
    timerRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stopPolling();
        setPhase("idle");
        toast.info(
          `${brandName} 측정이 아직 진행 중이에요. 잠시 후 대시보드에서 확인해 주세요.`
        );
        return;
      }
      try {
        const status = await getTrackingStatus(jobId);
        if (status === "completed") {
          stopPolling();
          setPhase("idle");
          toast.success(
            `${brandName} 측정 완료! 대시보드와 측정 이력에 반영됐어요.`
          );
          router.refresh();
        } else if (status === "failed") {
          stopPolling();
          setPhase("idle");
          toast.error(
            `${brandName} 측정에 실패했어요. 잠시 후 다시 시도해 주세요.`
          );
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
          toast.error("세션 인증에 실패했어요. 다시 로그인 후 시도해 주세요.");
          return;
        }
        if (result.upgrade) {
          // 플랜 업그레이드로 풀리는 제한 → 이유 + 해결 경로를 함께 안내.
          toast.error(result.error, {
            action: {
              label: "요금제 보기",
              onClick: () => router.push("/billing"),
            },
          });
          return;
        }
        toast.error(result.error);
        return;
      }
      setPhase("measuring");
      toast.success(`${brandName} 측정을 시작했어요. 보통 1~3분 정도 걸려요.`);
      router.refresh();
      watchJob(result.jobId);
    } catch {
      setPhase("idle");
      toast.error("측정을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <Button
      className="findable-btn-secondary"
      disabled={phase !== "idle"}
      onClick={start}
      size="sm"
      type="button"
      variant="outline"
    >
      {PHASE_LABEL[phase]}
    </Button>
  );
};
