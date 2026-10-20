"use server";

import { resend } from "@repo/email";
import { ContactTemplate } from "@repo/email/templates/contact";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { createRateLimiter, slidingWindow } from "@repo/rate-limit";
import {
  describeRateLimitError,
  limitOrAllow,
} from "@repo/rate-limit/limit-or-allow";
import { headers } from "next/headers";
import { env } from "@/env";

/**
 * 폼에 돌려주는 오류는 "코드"만 보낸다. 화면 문구는 폼이 로케일별로 고른다.
 * (2026-10-20: 예전엔 원시 오류 메시지를 그대로 돌려줘 화면에 노출될 수 있었다.)
 */
export type ContactErrorCode = "rate_limited" | "send_failed";

export const contact = async (
  name: string,
  email: string,
  message: string
): Promise<{
  error?: ContactErrorCode;
}> => {
  try {
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      const rateLimiter = createRateLimiter({
        limiter: slidingWindow(1, "1d"),
      });
      const head = await headers();
      const ip = head.get("x-forwarded-for");

      // 제한 초과만 막는다. 레이트 리밋 저장소 장애(보관·인증·네트워크)는 문의 접수를 막지 않는다.
      const decision = await limitOrAllow(
        rateLimiter,
        `contact_form_${ip}`,
        (error) =>
          log.warn("[rate-limit] unavailable, fail-open", {
            scope: "contact-form",
            ...describeRateLimitError(error),
          })
      );

      if (!decision.allowed) {
        return { error: "rate_limited" };
      }
    }

    if (!(resend && env.RESEND_FROM)) {
      throw new Error("Email is not configured.");
    }

    await resend.emails.send({
      from: env.RESEND_FROM,
      to: env.RESEND_FROM,
      subject: "Contact form submission",
      replyTo: email,
      react: <ContactTemplate email={email} message={message} name={name} />,
    });

    return {};
  } catch (error) {
    // 상세 원인은 서버 로그·Sentry 로만 남기고, 화면에는 코드만 돌려준다.
    parseError(error);

    return { error: "send_failed" };
  }
};
