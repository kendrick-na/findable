/**
 * @vitest-environment jsdom
 *
 * 🔴 이 도크블록이 없으면 **Vercel 빌드가 깨진다**(세션N-19가 실제로 깨뜨렸다).
 *   이 저장소는 vitest 설정 파일이 없어 환경 기본값이 `node` → `window is not defined`.
 *   ⚠️ 로컬 전체 실행은 다른 테스트가 만든 DOM 에 편승해 **통과해 버린다**
 *   → 새 렌더링 테스트는 `npx vitest run <파일>` **단독**으로 먼저 돌릴 것.
 *
 * S7-b 회귀 테스트 (2026-08-11).
 *
 * 🔴 **막는 사고**: `/history` 는 서버 컴포넌트라 한 번 그리고 끝이었다. 측정이 끝나도
 *   화면은 계속 「측정 중」으로 남아 고객이 **"고장났다"** 고 판단했다.
 *
 * 🔴 **동시에 막는 반대 사고**: 진행 중이 없는데도 폴링이 돌면 완료된 이력만 있는 화면을
 *   15초마다 다시 그리는 **순수 낭비**(서버 부하·요금)가 된다. 그래서 이 테스트는
 *   **양방향**이다 — ①진행 중이면 안내가 뜬다 ②진행 중이 아니면 **아무것도 렌더하지 않고
 *   타이머도 걸지 않는다**.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const refresh = vi.fn();
// ⚠️ **router 객체를 매 렌더 새로 만들면 안 된다.** `useRouter: () => ({ refresh })` 로
//   두면 렌더마다 다른 객체가 나와 effect 의 의존성이 매번 바뀌고, 그 결과 폴링
//   타이머가 계속 재구독돼 **상한이 영원히 안 온다**(60회 vs 40회로 이 테스트가 잡았다).
//   실제 Next.js 의 router 는 안정적이므로, 모의도 **같은 객체를 돌려줘야** 현실과 맞는다.
const router = { refresh };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const { HistoryAutoRefresh } = await import(
  "../app/(authenticated)/components/history-auto-refresh"
);

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HistoryAutoRefresh", () => {
  test("🔴 진행 중이 없으면 아무것도 렌더하지 않는다 (낭비 폴링 금지)", () => {
    const { container } = render(
      <HistoryAutoRefresh hasPending={false} pendingCount={0} />
    );
    expect(container.textContent).toBe("");

    // 15초 * 4 = 60초를 흘려도 refresh 가 한 번도 불리면 안 된다.
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("진행 중이면 건수와 소요시간을 알려준다 (침묵 금지)", () => {
    const { container } = render(
      <HistoryAutoRefresh hasPending={true} pendingCount={2} />
    );
    expect(container.textContent).toContain("2건 진행 중");
    expect(container.textContent).toContain("자동으로 갱신");
  });

  test("🔴 진행 중이면 주기적으로 서버 렌더를 다시 받는다", () => {
    render(<HistoryAutoRefresh hasPending={true} pendingCount={1} />);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("🔴 상한(10분)을 넘기면 폴링을 멈추고 수동 갱신으로 넘긴다", () => {
    const { container } = render(
      <HistoryAutoRefresh hasPending={true} pendingCount={1} />
    );
    // ⚠️ `act` 로 감싸야 타이머 콜백 안의 setState 가 **화면에 반영**된다.
    //   감싸지 않으면 폴링은 멈추는데 안내 문구만 옛것으로 남아 테스트가 실패한다
    //   (실제로 겪음 — 코드 버그가 아니라 테스트가 렌더를 못 따라간 것).
    act(() => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });
    const callsAtTimeout = refresh.mock.calls.length;

    // 멈춘 뒤로는 더 이상 늘지 않아야 한다(브라우저 켜둔 내내 도는 것 방지).
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(refresh.mock.calls.length).toBe(callsAtTimeout);
    expect(container.textContent).toContain("예상보다 오래");
  });

  test("수동 새로고침 버튼은 항상 있다 (자동이 실패해도 길이 남는다)", () => {
    const { container } = render(
      <HistoryAutoRefresh hasPending={true} pendingCount={1} />
    );
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("지금 새로고침");
  });
});
