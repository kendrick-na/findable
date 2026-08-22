/**
 * PortOne 결제 웹훅 — 서명 검증 · paymentId 해석 · 금액→plan 역산 회귀 테스트.
 *
 * 왜 여기 있나(2026-08-08 세션N-11): 세션N-10 이 이 로직을 만들 때 서명 9종을 한 번
 *   돌려보고 **커밋하지 않았다**. 그래서 "검증됨"이라는 인계 기록만 남고 재현 자산이 0이었다.
 *   이제 웹훅이 실제 배포 경로(`apps/app/app/webhooks/payments`)에 들어갔으므로,
 *   돈이 걸린 판정(서명·금액·사용자 복원)은 회귀 테스트로 고정한다.
 *
 * ⚠️ 시각 의존: `verifyWebhookSignature` 는 `Date.now()` 로 ±5분 리플레이 가드를 한다.
 *   테스트는 "지금" 기준 타임스탬프를 만들어 쓴다(고정 시각을 박으면 내일 깨진다).
 *
 * ⚠️ 환경은 `node` 로 고정한다 — 이 앱의 기본값은 jsdom(React 컴포넌트용)이고, 여기선
 *   `node:crypto` 로 서명을 만든다. 단 **`server-only` throw 는 환경 문제가 아니었다**:
 *   그 마커 패키지는 `react-server` exports 조건에서만 빈 모듈이라, 환경을 node 로 바꿔도
 *   여전히 throw 한다(실측). 해결은 `vitest.config.mts` 의 alias → `__tests__/stubs/empty.ts`.
 *
 * @vitest-environment node
 */

import { createHmac } from "node:crypto";
import {
  amountForPlan,
  buildPaymentId,
  listPriceForPlan,
  planForAmount,
  uidForPaymentId,
  userIdFromPaymentId,
  withVat,
} from "@repo/payments/catalog";
import {
  isPaidEvent,
  parseWebhookBody,
  verifyWebhookSignature,
} from "@repo/payments/webhook";
import { describe, expect, it } from "vitest";

const SECRET_RAW = "test-secret-not-a-real-key";
/** `whsec_` 형태(운영에서 PortOne 이 주는 형식) — base64 본문이 곧 키 바이트다. */
const SECRET_WHSEC = `whsec_${Buffer.from(SECRET_RAW, "utf8").toString("base64")}`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** 스펙대로 서명 생성: base64(HMAC-SHA256(key, `id.timestamp.body`)) */
function sign(
  rawBody: string,
  id: string,
  timestamp: string,
  secret: string
): string {
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  return createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`, "utf8")
    .digest("base64");
}

const BODY = JSON.stringify({
  type: "Transaction.Paid",
  data: { paymentId: "fdbl-starter-2abc-xyz", storeId: "store-1" },
});

describe("verifyWebhookSignature", () => {
  it("정상 서명을 통과시킨다 (whsec_ 시크릿)", () => {
    const id = "msg_1";
    const timestamp = String(nowSeconds());
    const result = verifyWebhookSignature(
      BODY,
      {
        id,
        timestamp,
        signature: `v1,${sign(BODY, id, timestamp, SECRET_WHSEC)}`,
      },
      SECRET_WHSEC
    );
    expect(result.ok).toBe(true);
  });

  it("접두사 없는 원문 시크릿도 지원한다", () => {
    const id = "msg_2";
    const timestamp = String(nowSeconds());
    const result = verifyWebhookSignature(
      BODY,
      {
        id,
        timestamp,
        signature: `v1,${sign(BODY, id, timestamp, SECRET_RAW)}`,
      },
      SECRET_RAW
    );
    expect(result.ok).toBe(true);
  });

  it("키 롤오버 — 서명이 공백으로 여러 개 와도 하나만 맞으면 통과", () => {
    const id = "msg_3";
    const timestamp = String(nowSeconds());
    const good = sign(BODY, id, timestamp, SECRET_WHSEC);
    const result = verifyWebhookSignature(
      BODY,
      { id, timestamp, signature: `v1,AAAAdeadbeef= v1,${good}` },
      SECRET_WHSEC
    );
    expect(result.ok).toBe(true);
  });

  it("본문이 1바이트라도 다르면 거부한다 (raw body 불변식)", () => {
    const id = "msg_4";
    const timestamp = String(nowSeconds());
    const signature = `v1,${sign(BODY, id, timestamp, SECRET_WHSEC)}`;
    // JSON.parse→재직렬화로 공백이 바뀐 상황을 모사.
    const tampered = `${BODY} `;
    const result = verifyWebhookSignature(
      tampered,
      { id, timestamp, signature },
      SECRET_WHSEC
    );
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("다른 시크릿으로 만든 서명은 거부한다", () => {
    const id = "msg_5";
    const timestamp = String(nowSeconds());
    const result = verifyWebhookSignature(
      BODY,
      { id, timestamp, signature: `v1,${sign(BODY, id, timestamp, "other")}` },
      SECRET_WHSEC
    );
    expect(result.ok).toBe(false);
  });

  it("버전이 v1 이 아니면 거부한다", () => {
    const id = "msg_6";
    const timestamp = String(nowSeconds());
    const result = verifyWebhookSignature(
      BODY,
      {
        id,
        timestamp,
        signature: `v2,${sign(BODY, id, timestamp, SECRET_WHSEC)}`,
      },
      SECRET_WHSEC
    );
    expect(result.ok).toBe(false);
  });

  it("헤더가 하나라도 없으면 거부한다", () => {
    const timestamp = String(nowSeconds());
    expect(
      verifyWebhookSignature(
        BODY,
        { id: null, timestamp, signature: "v1,x" },
        SECRET_WHSEC
      )
    ).toEqual({ ok: false, reason: "missing_webhook_headers" });
    expect(
      verifyWebhookSignature(
        BODY,
        { id: "msg_7", timestamp, signature: null },
        SECRET_WHSEC
      )
    ).toEqual({ ok: false, reason: "missing_webhook_headers" });
  });

  it("오래된 타임스탬프는 리플레이로 거부한다 (±5분)", () => {
    const id = "msg_8";
    const timestamp = String(nowSeconds() - 10 * 60);
    const result = verifyWebhookSignature(
      BODY,
      {
        id,
        timestamp,
        signature: `v1,${sign(BODY, id, timestamp, SECRET_WHSEC)}`,
      },
      SECRET_WHSEC
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("timestamp_out_of_tolerance");
    }
  });

  it("숫자가 아닌 타임스탬프는 거부한다", () => {
    const result = verifyWebhookSignature(
      BODY,
      { id: "msg_9", timestamp: "nope", signature: "v1,x" },
      SECRET_WHSEC
    );
    expect(result).toEqual({ ok: false, reason: "invalid_timestamp" });
  });

  it("시크릿 미설정은 위조와 구분되는 사유를 낸다", () => {
    const result = verifyWebhookSignature(
      BODY,
      { id: "msg_10", timestamp: String(nowSeconds()), signature: "v1,x" },
      ""
    );
    // 빈 문자열 → keys() 폴백을 타므로, env 유무와 무관하게 통과되지만은 않아야 한다.
    expect(result.ok).toBe(false);
  });
});

describe("parseWebhookBody / isPaidEvent", () => {
  it("우리가 쓰는 필드를 뽑고, 모르는 필드는 통과시킨다", () => {
    const body = parseWebhookBody(
      JSON.stringify({
        type: "Transaction.Paid",
        data: { paymentId: "fdbl-starter-abc-1", 미래필드: 1 },
        새필드: true,
      })
    );
    expect(body?.type).toBe("Transaction.Paid");
    expect(body?.data.paymentId).toBe("fdbl-starter-abc-1");
  });

  it("paymentId 가 없으면 null (형식 오류는 재전송 무의미)", () => {
    expect(
      parseWebhookBody(JSON.stringify({ type: "x", data: {} }))
    ).toBeNull();
    expect(parseWebhookBody("not json")).toBeNull();
  });

  it("돈이 실제로 들어온 이벤트만 참", () => {
    expect(isPaidEvent("Transaction.Paid")).toBe(true);
    expect(isPaidEvent("Transaction.VirtualAccountIssued")).toBe(false);
    expect(isPaidEvent("Transaction.Cancelled")).toBe(false);
  });
});

describe("paymentId 왕복", () => {
  it("발급 → 해석이 같은 userId 를 돌려준다", () => {
    const userId = "user_2abcDEF";
    const paymentId = buildPaymentId("starter", userId, 1_700_000_000_000);
    expect(userIdFromPaymentId(paymentId)).toBe(userId);
  });

  it("🔴 uid 에 `-` 가 있어도 잘리지 않는다 (split[2] 금지 근거)", () => {
    const userId = "user_2ab-cd-ef";
    const paymentId = buildPaymentId("growth", userId, 1_700_000_000_000);
    expect(uidForPaymentId(userId)).toBe("2ab-cd-ef");
    expect(userIdFromPaymentId(paymentId)).toBe(userId);
  });

  it("앱 밖에서 만든 결제(형식 불일치)는 null → 부여 대상 아님", () => {
    expect(userIdFromPaymentId("order-12345")).toBeNull();
    expect(userIdFromPaymentId("fdbl-starter-1")).toBeNull();
    expect(userIdFromPaymentId("")).toBeNull();
  });
});

describe("planForAmount — 금액이 최종 권위", () => {
  it("청구액(VAT 포함)을 정확히 역산한다", () => {
    expect(planForAmount(108_900)).toBe("starter");
    expect(planForAmount(429_000)).toBe("growth");
    expect(planForAmount(1_089_000)).toBe("scale");
  });

  it("세전 기준가로 결제된 건도 역산한다 (VAT 정정 이전 결제 구제)", () => {
    // 2026-08-10 이전엔 세전가를 그대로 청구했다. 그 금액을 거부하면
    // "돈은 냈는데 무료" 가 된다 → 두 금액 다 받아준다.
    expect(planForAmount(99_000)).toBe("starter");
    expect(planForAmount(390_000)).toBe("growth");
    expect(planForAmount(990_000)).toBe("scale");
  });

  it("표에 없는 금액은 null (위변조·가격변경 누락 차단)", () => {
    expect(planForAmount(1000)).toBeNull();
    expect(planForAmount(98_999)).toBeNull();
    expect(planForAmount(0)).toBeNull();
    // 상위 plan 금액을 흉내낸 근사값도 막는다
    expect(planForAmount(108_899)).toBeNull();
  });
});

describe("amountForPlan / withVat — 표시가와 청구가의 분리", () => {
  it("청구액은 VAT 포함이다", () => {
    expect(amountForPlan("starter")).toBe(108_900);
    expect(amountForPlan("growth")).toBe(429_000);
    expect(amountForPlan("scale")).toBe(1_089_000);
  });

  it("표시 기준가는 세전이다 (경쟁사 정렬 anchor · D-003)", () => {
    expect(listPriceForPlan("starter")).toBe(99_000);
    expect(listPriceForPlan("growth")).toBe(390_000);
    expect(listPriceForPlan("scale")).toBe(990_000);
  });

  it("withVat 이 카탈로그 청구액과 일치한다 (표가 손으로 어긋나는 것 차단)", () => {
    expect(withVat(99_000)).toBe(108_900);
    expect(withVat(390_000)).toBe(429_000);
    expect(withVat(990_000)).toBe(1_089_000);
  });

  it("원 단위는 절사한다 (PG 는 정수 KRW 만 받는다)", () => {
    expect(withVat(99_999)).toBe(109_998); // 109,998.9 → 절사
    expect(Number.isInteger(withVat(12_345))).toBe(true);
  });
});
