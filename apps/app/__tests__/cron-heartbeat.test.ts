/**
 * @vitest-environment node
 *
 * `packages/observability` 에는 테스트 러너가 없어 `ops-alert.test.ts` 처럼 apps/app 에 둔다.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureCheckIn = vi.fn();
const logError = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: (...args: unknown[]) => captureCheckIn(...args),
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: (...args: unknown[]) => logError(...args) },
}));

const { withCronHeartbeat } = await import(
  "@repo/observability/cron-heartbeat"
);

const ON = { STABILITY_OPS_ALERTS_ENABLED: "1" };

beforeEach(() => {
  captureCheckIn.mockReset();
  logError.mockReset();
  captureCheckIn.mockReturnValue("check-in-1");
});

describe("withCronHeartbeat — 꺼짐 동일성", () => {
  it("꺼짐이면 fn 만 실행하고 Sentry 를 부르지 않는다", async () => {
    const fn = vi.fn().mockResolvedValue("값");
    await expect(
      withCronHeartbeat("slug", "*/30 * * * *", fn, { env: {} })
    ).resolves.toBe("값");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(captureCheckIn).not.toHaveBeenCalled();
  });
  it("꺼짐에서 fn 이 던지면 같은 예외가 그대로 나간다", async () => {
    const boom = new Error("boom");
    await expect(
      withCronHeartbeat("slug", "* * * * *", () => Promise.reject(boom), {
        env: {},
      })
    ).rejects.toBe(boom);
    expect(captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("withCronHeartbeat — 켜짐", () => {
  it("시작(in_progress) → 정상(ok) 체크인, 같은 id 로 이어진다", async () => {
    const result = await withCronHeartbeat(
      "auto-refresh-tracking",
      "*/30 * * * *",
      () => 42,
      {
        env: ON,
      }
    );
    expect(result).toBe(42);
    expect(captureCheckIn).toHaveBeenCalledTimes(2);
    const [start, config] = captureCheckIn.mock.calls[0];
    expect(start).toEqual({
      monitorSlug: "auto-refresh-tracking",
      status: "in_progress",
    });
    expect(config.schedule).toEqual({ type: "crontab", value: "*/30 * * * *" });
    const [finish] = captureCheckIn.mock.calls[1];
    expect(finish).toMatchObject({
      checkInId: "check-in-1",
      monitorSlug: "auto-refresh-tracking",
      status: "ok",
    });
    expect(typeof finish.duration).toBe("number");
  });
  it("fn 이 던지면 error 체크인을 보내고 예외를 삼키지 않는다", async () => {
    const boom = new Error("boom");
    await expect(
      withCronHeartbeat("slug", "* * * * *", () => Promise.reject(boom), {
        env: ON,
      })
    ).rejects.toBe(boom);
    expect(captureCheckIn.mock.calls[1][0]).toMatchObject({ status: "error" });
  });
  it("체크인 전송이 던져도 본 작업은 정상 완료된다(시작·종료 모두)", async () => {
    captureCheckIn.mockImplementation(() => {
      throw new Error("sentry down");
    });
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      withCronHeartbeat("slug", "* * * * *", fn, { env: ON })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();
  });
  it("체크인 전송이 던지는 중에 fn 이 던지면 fn 의 예외가 나간다(전송 오류가 덮지 않는다)", async () => {
    captureCheckIn.mockImplementation(() => {
      throw new Error("sentry down");
    });
    const boom = new Error("job failed");
    await expect(
      withCronHeartbeat("slug", "* * * * *", () => Promise.reject(boom), {
        env: ON,
      })
    ).rejects.toBe(boom);
  });
  it("동기 fn 도 받는다", async () => {
    await expect(
      withCronHeartbeat("slug", "* * * * *", () => "sync", { env: ON })
    ).resolves.toBe("sync");
  });
});
