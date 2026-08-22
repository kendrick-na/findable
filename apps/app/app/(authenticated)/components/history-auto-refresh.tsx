"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 진행 중인 측정이 있을 때만 이력 화면을 자동 갱신한다.
 *
 * 🔴 S7-b(2026-08-11) — **막는 사고**: `/history` 는 서버 컴포넌트로 한 번 그리고 끝이라
 *   측정이 끝나도 화면은 계속 「측정 중」으로 남았다. 새로고침해야 한다는 걸 아무도
 *   알려주지 않아 고객은 **"멈췄다·고장났다"** 로 읽는다. 측정을 막 돌린 직후가
 *   가장 기대가 큰 순간인데 거기서 제품이 죽은 것처럼 보였다(NN/g 1 시스템 상태 가시성).
 *
 * ⚠️ **진행 중이 없으면 폴링하지 않는다.** 완료된 이력만 있는 화면을 15초마다 다시
 *   그리는 것은 순수 낭비다(서버 부하·요금). 그래서 `hasPending` 을 서버에서 받는다.
 * ⚠️ **상한을 둔다** — 측정이 끼어서 영영 안 끝나는 경우 브라우저를 켜 둔 내내
 *   폴링이 도는 것을 막는다. 상한에 닿으면 수동 새로고침 버튼으로 넘긴다.
 *
 * 왜 `router.refresh()` 인가: 이 목록은 서버에서 스코프(이메일 ∪ org)를 계산해 오므로
 * 클라이언트가 직접 조회하면 **권한 로직이 두 벌**이 된다. 서버 렌더를 다시 받는 게 맞다.
 */

const POLL_INTERVAL_MS = 15_000;
// 측정 약속이 "1~3분"이라 10분이면 사실상 실패다. 그 뒤로는 수동 갱신에 맡긴다.
// 🔴 **벽시계(`Date.now()`)가 아니라 틱 수로 센다.** 시간으로 재면 상한 판정이
//   `Date.now()` 에 묶여 테스트에서 검증할 수 없고(가짜 타이머는 시계를 안 돌린다),
//   무엇보다 상한이 "몇 번 갱신했는가"와 어긋날 수 있다. 틱은 정확히 셀 수 있다.
const MAX_POLLS = (10 * 60 * 1000) / POLL_INTERVAL_MS; // 10분 = 40회

export const HistoryAutoRefresh = ({
  hasPending,
  pendingCount,
}: {
  hasPending: boolean;
  pendingCount: number;
}) => {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  // 수동 새로고침으로 폴링을 되살릴 때 effect 를 다시 태우는 스위치.
  const [pollCycle, setPollCycle] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollCycle은 폴링 재시작 트리거
  useEffect(() => {
    if (!hasPending) {
      return;
    }
    let polls = 0;

    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
    // ⚠️ `timedOut` 을 여기 넣지 말 것 — 상한에 닿아 `setTimedOut(true)` 이 불리면
    //   effect 가 재실행돼 **타이머를 다시 걸고 폴링이 되살아난다**(내가 실제로 그렇게
    //   짰고 테스트가 60회 vs 40회로 잡아냈다). 되살리는 길은 버튼(`pollCycle`)뿐이다.
  }, [hasPending, router, pollCycle]);

  if (!hasPending) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-3 py-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
      {timedOut ? (
        <span>
          측정이 예상보다 오래 걸리고 있어요. 아래 버튼으로 다시 확인해 주세요.
        </span>
      ) : (
        <span>
          측정 {pendingCount}건 진행 중 — 끝나면 자동으로 갱신돼요. 1~3분
          걸려요.
        </span>
      )}
      <button
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[color:var(--findable-hairline,#23252a)] px-2.5 py-1 text-[color:var(--findable-ink-muted,#d0d6e0)] text-xs transition-colors hover:border-[color:var(--findable-ink-subtle,#8a8f98)] hover:text-[color:var(--findable-ink,#f7f8f8)]"
        onClick={() => {
          setTimedOut(false);
          // effect 를 다시 태워 폴링을 되살린다(상한도 지금부터 다시 잰다).
          setPollCycle((c) => c + 1);
          router.refresh();
        }}
        type="button"
      >
        <RefreshCwIcon className="size-3" />
        지금 새로고침
      </button>
    </div>
  );
};
