/**
 * 정기결제 갱신 사전 안내 메일 — 2026-10-05.
 *
 * 무엇: 활성 정기결제 조직의 다음 결제(`billingNextPaymentAt`)가 **지금부터 3일 안**에 들면,
 *   결제자에게 "언제·얼마·어떤 수단으로 결제되고, 어떻게 해지하는지"를 한 번 알린다.
 *
 * 🔒 불변식:
 *   - 스위치 `FINDABLE_RENEWAL_NOTICE_ENABLED` 가 **정확히 "true"** 일 때만 동작한다(기본 꺼짐).
 *     꺼져 있으면 DB 조회조차 하지 않는다. 켜는 것은 컨트롤타워 결정이다(코드 배포 ≠ 발송 시작).
 *   - Preview 에서는 보내지 않는다 — `createResendClient` 가 Preview 에서 클라이언트를 만들지 않고,
 *     호출부는 그 값을 그대로 넘긴다(클라이언트 없음 = 발송 없음).
 *   - **예약 결제 1건(billingNextPaymentId)당 1통.** 발송 전에 RenewalNotice 행(paymentId unique)을
 *     선점하고, 이미 있으면 건너뛴다. Resend 에도 같은 멱등 키를 준다(재시도 중복 방지).
 *     발송이 실패하면 선점을 지워 다음 실행(30분 뒤)에서 다시 시도한다.
 *   - 발송 기록 테이블이 없으면(migration 전 배포) 아무것도 보내지 않는다 — 1회 보장이 없으면
 *     30분마다 같은 메일이 나갈 수 있다(fail closed).
 *   - 실행당 상한(MAX_RENEWAL_NOTICES_PER_RUN). 측정 cron 의 시간 예산을 잠식하지 않게 한다.
 *   - 금액은 예약 결제 ID 의 plan → 서버 카탈로그(VAT 포함)에서만 온다. plan 을 못 읽으면 보내지 않는다.
 *   - 이 단계의 실패는 던지지 않는다(호출부 cron 의 만료·측정 단계를 막지 않는다).
 */

import { database } from "@repo/database";
import { RenewalNoticeEmail } from "@repo/email/templates/renewal-notice";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  amountForPlan,
  type PayablePlan,
  parsePaymentId,
} from "@repo/payments/catalog";
import type { ReactElement } from "react";
import { isMissingTableErrorFor } from "@/lib/db/missing-table";

export const RENEWAL_NOTICE_FLAG = "FINDABLE_RENEWAL_NOTICE_ENABLED";
export const RENEWAL_NOTICE_LEAD_DAYS = 3;
export const MAX_RENEWAL_NOTICES_PER_RUN = 20;
/** 상한보다 넉넉히 읽어 이미 보낸 조직을 걸러낸 뒤에도 상한을 채울 수 있게 한다. */
const CANDIDATE_SCAN_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 결제수단 표시. 정기결제는 간편결제 빌링키(`billingKeyMethod: "EASY_PAY"`)로만 등록된다. */
const PAYMENT_METHOD_LABEL = "정기결제에 등록하신 간편결제 수단";

const PLAN_NAME: Record<PayablePlan, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

/** 메일 발송에 필요한 최소 모양(Resend 클라이언트와 테스트 대역이 함께 맞춘다). */
export interface RenewalNoticeMailer {
  emails: {
    send: (
      payload: {
        from: string;
        react: ReactElement;
        subject: string;
        to: string;
      },
      options?: { idempotencyKey?: string }
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}

export interface RenewalNoticeRunInput {
  appUrl: string;
  /** Preview·토큰 없음이면 undefined → 발송하지 않는다. */
  client: RenewalNoticeMailer | undefined;
  env?: Record<string, string | undefined>;
  from: string | undefined;
  now: Date;
  termsUrl: string;
}

export interface RenewalNoticeRunResult {
  candidates: number;
  failed: number;
  sent: number;
  status: "disabled" | "not_configured" | "ledger_missing" | "ran";
}

export const isRenewalNoticeEnabled = (
  env: Record<string, string | undefined> = process.env
): boolean => env[RENEWAL_NOTICE_FLAG] === "true";

const formatPaymentDate = (at: Date): string =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "Asia/Seoul",
  }).format(at);

const errorCode = (error: unknown): string | null =>
  error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : null;

const result = (
  status: RenewalNoticeRunResult["status"],
  counts: Partial<Omit<RenewalNoticeRunResult, "status">> = {}
): RenewalNoticeRunResult => ({
  status,
  candidates: counts.candidates ?? 0,
  sent: counts.sent ?? 0,
  failed: counts.failed ?? 0,
});

interface Candidate {
  amountKrw: number;
  organizationId: string;
  paymentId: string;
  plan: PayablePlan;
  scheduledAt: Date;
  userId: string;
}

async function loadCandidates(now: Date): Promise<Candidate[]> {
  const until = new Date(now.getTime() + RENEWAL_NOTICE_LEAD_DAYS * DAY_MS);
  const orgs = await database.organization.findMany({
    where: {
      billingStatus: "active",
      billingProvider: "portone",
      billingCustomerId: { not: null },
      billingNextPaymentId: { not: null },
      billingNextPaymentAt: { gt: now, lte: until },
    },
    orderBy: { billingNextPaymentAt: "asc" },
    take: CANDIDATE_SCAN_LIMIT,
    select: {
      id: true,
      billingNextPaymentId: true,
      billingNextPaymentAt: true,
    },
  });
  const candidates: Candidate[] = [];
  for (const org of orgs) {
    if (!(org.billingNextPaymentId && org.billingNextPaymentAt)) {
      continue;
    }
    const parsed = parsePaymentId(org.billingNextPaymentId);
    const amountKrw = parsed ? amountForPlan(parsed.plan) : null;
    if (!(parsed && amountKrw)) {
      log.warn("billing.renewal_notice.unreadable_payment_id", {
        organizationId: org.id,
      });
      continue;
    }
    candidates.push({
      organizationId: org.id,
      paymentId: org.billingNextPaymentId,
      scheduledAt: org.billingNextPaymentAt,
      plan: parsed.plan,
      userId: parsed.userId,
      amountKrw,
    });
  }
  return candidates;
}

/** 선점 성공 = true. 이미 보냈으면(unique 충돌) false. 그 밖의 오류는 던진다. */
async function claim(candidate: Candidate): Promise<boolean> {
  try {
    await database.renewalNotice.create({
      data: {
        paymentId: candidate.paymentId,
        organizationId: candidate.organizationId,
        userId: candidate.userId,
        scheduledAt: candidate.scheduledAt,
      },
      select: { id: true },
    });
    return true;
  } catch (error) {
    if (errorCode(error) === "P2002") {
      return false;
    }
    throw error;
  }
}

async function release(paymentId: string): Promise<void> {
  try {
    await database.renewalNotice.deleteMany({ where: { paymentId } });
  } catch (error) {
    // 선점이 남으면 이번 회차 안내가 빠질 뿐 중복 발송은 없다(안전한 쪽).
    log.error("billing.renewal_notice.release_failed", {
      paymentId,
      error: parseError(error),
    });
  }
}

async function sendOne(
  candidate: Candidate,
  input: RenewalNoticeRunInput & {
    client: RenewalNoticeMailer;
    from: string;
  }
): Promise<"sent" | "skipped" | "failed"> {
  const user = await database.user.findUnique({
    where: { id: candidate.userId },
    select: { email: true },
  });
  if (!user?.email) {
    log.warn("billing.renewal_notice.no_recipient", {
      organizationId: candidate.organizationId,
    });
    return "skipped";
  }
  if (!(await claim(candidate))) {
    return "skipped";
  }
  const paymentDateLabel = formatPaymentDate(candidate.scheduledAt);
  try {
    const response = await input.client.emails.send(
      {
        from: input.from,
        to: user.email,
        subject: `[Findable] 정기결제 예정 안내 (${paymentDateLabel})`,
        react: RenewalNoticeEmail({
          amountKrw: candidate.amountKrw,
          billingUrl: `${input.appUrl}/billing`,
          paymentDateLabel,
          paymentMethodLabel: PAYMENT_METHOD_LABEL,
          planName: PLAN_NAME[candidate.plan],
          termsUrl: input.termsUrl,
        }),
      },
      { idempotencyKey: `renewal-notice/${candidate.paymentId}` }
    );
    if (response.error) {
      throw new Error(parseError(response.error));
    }
    log.info("billing.renewal_notice.sent", {
      organizationId: candidate.organizationId,
      paymentId: candidate.paymentId,
    });
    return "sent";
  } catch (error) {
    await release(candidate.paymentId);
    log.error("billing.renewal_notice.send_failed", {
      organizationId: candidate.organizationId,
      paymentId: candidate.paymentId,
      error: parseError(error),
    });
    return "failed";
  }
}

export async function sendRenewalNotices(
  input: RenewalNoticeRunInput
): Promise<RenewalNoticeRunResult> {
  if (!isRenewalNoticeEnabled(input.env)) {
    return result("disabled");
  }
  const { client, from } = input;
  if (!(client && from)) {
    log.warn("billing.renewal_notice.email_not_configured", {});
    return result("not_configured");
  }

  let due: Candidate[];
  try {
    const candidates = await loadCandidates(input.now);
    const already =
      candidates.length === 0
        ? []
        : await database.renewalNotice.findMany({
            where: { paymentId: { in: candidates.map((c) => c.paymentId) } },
            select: { paymentId: true },
          });
    const notified = new Set(already.map((n) => n.paymentId));
    due = candidates
      .filter((c) => !notified.has(c.paymentId))
      .slice(0, MAX_RENEWAL_NOTICES_PER_RUN);
  } catch (error) {
    if (isMissingTableErrorFor(error, "RenewalNotice")) {
      log.warn("billing.renewal_notice.ledger_missing", {});
      return result("ledger_missing");
    }
    log.error("billing.renewal_notice.scan_failed", {
      error: parseError(error),
    });
    return result("ran", { failed: 1 });
  }

  let sent = 0;
  let failed = 0;
  for (const candidate of due) {
    try {
      const outcome = await sendOne(candidate, { ...input, client, from });
      if (outcome === "sent") {
        sent += 1;
      } else if (outcome === "failed") {
        failed += 1;
      }
    } catch (error) {
      if (isMissingTableErrorFor(error, "RenewalNotice")) {
        log.warn("billing.renewal_notice.ledger_missing", {});
        return result("ledger_missing", {
          candidates: due.length,
          sent,
          failed,
        });
      }
      failed += 1;
      log.error("billing.renewal_notice.candidate_failed", {
        organizationId: candidate.organizationId,
        error: parseError(error),
      });
    }
  }
  return result("ran", { candidates: due.length, sent, failed });
}
