import { keys as analytics } from "@repo/analytics/keys";
import { keys as auth } from "@repo/auth/keys";
import { keys as collaboration } from "@repo/collaboration/keys";
import { keys as database } from "@repo/database/keys";
import { keys as email } from "@repo/email/keys";
import { keys as flags } from "@repo/feature-flags/keys";
import { keys as core } from "@repo/next-config/keys";
import { keys as notifications } from "@repo/notifications/keys";
import { keys as observability } from "@repo/observability/keys";
import { keys as payments } from "@repo/payments/keys";
import { keys as security } from "@repo/security/keys";
import { keys as webhooks } from "@repo/webhooks/keys";
import { createEnv } from "@t3-oss/env-nextjs";

export const env = createEnv({
  extends: [
    auth(),
    analytics(),
    collaboration(),
    core(),
    database(),
    email(),
    flags(),
    notifications(),
    observability(),
    payments(),
    security(),
    webhooks(),
  ],
  server: {},
  client: {},
  runtimeEnv: {},
});

// 🔒 P6 배포 assertion (2026-07-30): web 과 동일 — NEXT_PUBLIC_APP_URL 에 `app.` 이 빠지면
//   세션쿠키·리다이렉트가 어긋난다(과거 로그인 404 근본원인 계열). 프로덕션 빌드에서만 강제.
if (
  process.env.VERCEL_ENV === "production" &&
  !env.NEXT_PUBLIC_APP_URL.startsWith("https://app.")
) {
  throw new Error(
    `[env assertion] NEXT_PUBLIC_APP_URL="${env.NEXT_PUBLIC_APP_URL}" — 프로덕션은 https://app.findable.co.kr 이어야 합니다. Vercel env 를 고치고 재배포하세요.`
  );
}
