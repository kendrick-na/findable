// 운영자 장애 알림 — 2026-08-12 세션N-24 (BL-Day17-02)
//
// 배경: cron·배치가 이상을 감지하면 `log.warn` 만 남겼고 **아무도 그 로그를 보지 않았다**.
//   진단(D17-5)이 이걸 *"알림을 로그로 대신하는"* 혼용 함정이라고 불렀다.
//   로그는 **사후 조사용**이고, 알림은 **사람을 부르는 것**이다. 둘은 다른 일을 한다.
//
// 왜 Sentry 인가: 이미 연결돼 있어 **추가 의존이 0** 이다(`error.ts` 가 같은 SDK 사용).
//   새 채널(Slack 웹훅 등)을 붙이면 시크릿·전송실패 처리·재시도가 따라온다.
//
// 🔴 이 함수는 **절대 던지지 않는다**. 알림 전송 실패가 본 작업(cron 정리)을 깨뜨리면
//   "알림을 붙였더니 기능이 죽었다"가 된다. `parseError` 의 try/catch 선례를 따른다.

// biome-ignore lint/performance/noNamespaceImport: Sentry SDK convention
import * as Sentry from "@sentry/nextjs";
import { log } from "./log";

/**
 * 운영자가 봐야 하는 이상 상황을 알린다(Sentry warning + 로그).
 *
 * ⚠️ **임계값을 받지 않는다.** 호출부가 "이건 이상하다"를 이미 판정해서 부르는 자리다.
 *   근거 없는 경계선을 이 안에서 발명하지 않는다.
 *
 * @param message 사람이 읽을 한 줄. 무엇이 일어났는지 (원인 추측 아님)
 * @param context 판단에 필요한 숫자·식별자. 개인정보(이메일·IP)를 넣지 말 것
 */
export const captureOpsAlert = (
  message: string,
  context?: Record<string, number | string | boolean | null>
): void => {
  try {
    Sentry.captureMessage(message, {
      level: "warning",
      // `extra` 로 넣는다 — tag 는 카디널리티 제한이 있어 숫자를 넣으면 안 된다.
      extra: context,
    });
  } catch (alertError) {
    // 알림 경로가 죽어도 본 작업은 계속돼야 한다. 다만 조용히 삼키지는 않는다.
    log.error("ops-alert 전송 실패", {
      original: message,
      reason: alertError instanceof Error ? alertError.message : "unknown",
    });
  }
};
