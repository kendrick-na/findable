/**
 * PortOne V2 웹훅 서명 검증 — Standard Webhooks 스펙 구현.
 *
 * 왜 직접 구현했나: PortOne 공식 SDK(`@portone/server-sdk`)가 있으나 의존성을 늘리지 않고
 *   Node 내장 `crypto` 만으로 충분하다(알고리즘이 공개 스펙으로 완전히 규정돼 있음).
 *   ⚠️ 스펙이 바뀌면 여기를 고쳐야 한다 → 근거 링크를 남긴다.
 *   · PortOne 웹훅: https://developers.portone.io/opi/ko/integration/webhook/readme-v2
 *   · Standard Webhooks: https://github.com/standard-webhooks/standard-webhooks
 *
 * 검증 규칙(스펙 확인 2026-08-07):
 *   서명 대상 = `{webhook-id}.{webhook-timestamp}.{raw body}`
 *   서명      = base64(HMAC-SHA256(secret, 위 문자열)), 헤더값은 `v1,<sig>` 형태(공백 구분 다중 가능)
 *   시크릿    = `whsec_` 접두사면 그 뒤를 base64 디코드한 **바이트**가 키다(접두사 없으면 원문 바이트)
 *
 * 🔒 불변식:
 *   - **raw body 문자열**을 그대로 넘길 것. `JSON.parse` 후 재직렬화하면 바이트가 달라져 100% 실패한다.
 *   - 비교는 **타이밍 안전**(`timingSafeEqual`) — 문자열 `===` 는 타이밍 누출.
 *   - 타임스탬프 허용 오차 ±5분(스펙 권장) — 리플레이 차단.
 */

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { keys } from "./keys";

/** 스펙 권장 허용 오차(초). 이보다 오래된/미래의 요청은 리플레이로 본다. */
const TOLERANCE_SECONDS = 5 * 60;

const SECRET_PREFIX = "whsec_";
const SIGNATURE_VERSION = "v1";

export interface WebhookHeaders {
  id: string | null;
  signature: string | null;
  timestamp: string | null;
}

export type WebhookVerifyResult = { ok: true } | { ok: false; reason: string };

/** `whsec_` 접두사면 base64 디코드한 바이트가 키. 아니면 원문 바이트. */
function secretToKey(secret: string): Buffer {
  return secret.startsWith(SECRET_PREFIX)
    ? Buffer.from(secret.slice(SECRET_PREFIX.length), "base64")
    : Buffer.from(secret, "utf8");
}

/** 길이가 달라도 예외 없이 false 를 내는 타이밍 안전 비교. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * 웹훅 서명 검증. 실패 사유를 문자열로 돌려준다(로그용 — 응답 본문에 넣지 말 것).
 *
 * @param rawBody `await request.text()` 결과 **그대로**.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret?: string
): WebhookVerifyResult {
  const webhookSecret = secret ?? keys().PORTONE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { ok: false, reason: "webhook_secret_not_configured" };
  }
  const { id, timestamp, signature } = headers;
  if (!(id && timestamp && signature)) {
    return { ok: false, reason: "missing_webhook_headers" };
  }

  // 리플레이 가드 — 오래된 요청 거부.
  const sentAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - sentAt);
  if (skew > TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp_out_of_tolerance(${skew}s)` };
  }

  const expected = createHmac("sha256", secretToKey(webhookSecret))
    .update(`${id}.${timestamp}.${rawBody}`, "utf8")
    .digest("base64");

  // 헤더엔 `v1,<sig>` 가 공백으로 여러 개 올 수 있다(키 롤오버). 하나라도 맞으면 통과.
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version === SIGNATURE_VERSION && value && safeEqual(value, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature_mismatch" };
}

/**
 * 웹훅 본문 스키마 — 우리가 쓰는 필드만. 알 수 없는 필드는 통과시킨다
 * (PortOne 이 필드를 추가해도 깨지지 않게).
 */
const WebhookBodySchema = z.object({
  type: z.string(),
  timestamp: z.string().optional(),
  data: z.object({
    paymentId: z.string(),
    storeId: z.string().optional(),
    transactionId: z.string().optional(),
    cancellationId: z.string().optional(),
  }),
});

export type PortOneWebhookBody = z.infer<typeof WebhookBodySchema>;

export function parseWebhookBody(rawBody: string): PortOneWebhookBody | null {
  try {
    return WebhookBodySchema.parse(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

/**
 * 결제 완료를 뜻하는 이벤트인지. PortOne V2 는 `Transaction.Paid` 를 쓴다.
 * ⚠️ 가상계좌 발급(`Transaction.VirtualAccountIssued`)·취소는 여기 해당하지 않는다
 *   (돈이 실제로 들어온 시점만 plan 을 올린다).
 */
export function isPaidEvent(type: string): boolean {
  return type === "Transaction.Paid";
}
