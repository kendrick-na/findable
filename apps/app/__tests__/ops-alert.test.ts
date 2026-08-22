/**
 * 운영자 장애 알림 회귀 테스트 (BL-Day17-02 · 2026-08-12 세션N-24).
 *
 * 🔴 **막는 사고**: 알림 경로가 본 작업을 깨뜨리는 것.
 *   `captureOpsAlert` 는 cron 정리 **뒤에** 불리는데, 여기서 예외가 새어나가면
 *   "stuck 을 정리하고도 라우트가 500" 이 된다 = 알림을 붙였더니 기능이 죽는다.
 *   → **절대 던지지 않는다**를 테스트로 못박는다.
 *
 * ⚠️ 왜 `apps/app` 에 있나: `apps/web` 에는 **테스트 러너가 없다**(vitest 설정 부재).
 *   대상 코드는 `packages/observability` 라 어느 앱에서든 임포트된다.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const captureMessage = vi.fn();
const logError = vi.fn();

/*
 * ⚠️ 이 mock 이 물리려면 `vitest.config.mts` 의 `@sentry/nextjs` **alias 가 필요**하다.
 *   pnpm 은 peer 조합마다 물리 경로를 따로 만들어서, `apps/app` 과
 *   `packages/observability` 가 **서로 다른 복사본**을 볼 수 있다. 그러면 이름으로 건
 *   `vi.mock` 이 대상 모듈이 실제로 로드하는 복사본을 안 가로챈다(스파이 0회 호출).
 *   실제로 `@playwright/test` 를 설치한 것만으로 이 테스트 4개가 깨졌다(2026-08-16).
 */
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

vi.mock("@repo/observability/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args) },
}));

const { captureOpsAlert } = await import("@repo/observability/ops-alert");

beforeEach(() => {
  captureMessage.mockReset();
  logError.mockReset();
});

describe("captureOpsAlert", () => {
  test("warning 레벨로 올린다 — error 로 올리면 진짜 장애와 섞인다", () => {
    captureOpsAlert("stuck 정리됨", { crew: 1, fast: 2 });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0] as [
      string,
      { level: string; extra: Record<string, unknown> },
    ];
    expect(message).toBe("stuck 정리됨");
    expect(options.level).toBe("warning");
  });

  test("맥락 숫자는 extra 로 넘긴다 (tag 는 카디널리티 제한이 있다)", () => {
    captureOpsAlert("stuck 정리됨", { crew: 1, fast: 2 });

    const [, options] = captureMessage.mock.calls[0] as [
      string,
      { extra: Record<string, unknown> },
    ];
    expect(options.extra).toEqual({ crew: 1, fast: 2 });
  });

  test("🔴 Sentry 가 던져도 호출부로 전파되지 않는다", () => {
    captureMessage.mockImplementation(() => {
      throw new Error("sentry down");
    });

    // 이게 던지면 cron 라우트가 500 이 된다.
    expect(() => captureOpsAlert("stuck 정리됨", { crew: 1 })).not.toThrow();
  });

  test("🔴 전송이 실패하면 조용히 삼키지 않고 로그로 남긴다", () => {
    captureMessage.mockImplementation(() => {
      throw new Error("sentry down");
    });

    captureOpsAlert("stuck 정리됨", { crew: 1 });

    expect(logError).toHaveBeenCalledTimes(1);
    const [, detail] = logError.mock.calls[0] as [
      string,
      { original: string; reason: string },
    ];
    expect(detail.original).toBe("stuck 정리됨");
    expect(detail.reason).toBe("sentry down");
  });

  test("맥락 없이도 동작한다 (context 는 선택)", () => {
    expect(() => captureOpsAlert("맥락 없는 알림")).not.toThrow();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
