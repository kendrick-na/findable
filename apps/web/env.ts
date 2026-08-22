import { keys as audit } from "@repo/audit/keys";
import { keys as cms } from "@repo/cms/keys";
import { keys as email } from "@repo/email/keys";
import { keys as flags } from "@repo/feature-flags/keys";
import { keys as core } from "@repo/next-config/keys";
import { keys as observability } from "@repo/observability/keys";
import { keys as rateLimit } from "@repo/rate-limit/keys";
import { keys as security } from "@repo/security/keys";
import { createEnv } from "@t3-oss/env-nextjs";

export const env = createEnv({
  extends: [
    audit(),
    cms(),
    core(),
    email(),
    observability(),
    flags(),
    security(),
    rateLimit(),
  ],
  server: {},
  client: {},
  runtimeEnv: {},
});

// 🔒 P6 배포 assertion (2026-07-30, 로그인 404 재발 원천봉쇄):
//   NEXT_PUBLIC_APP_URL 에 `app.` 이 빠지면(과거 실사고: https://findable.co.kr 로 저장)
//   로그인/가입/파트너메일 링크가 www 로 오배선 → /ko/sign-in 404. NEXT_PUBLIC 은
//   빌드타임 인라인이라 tsc·런타임 검증에 안 잡힌다 → **프로덕션 빌드를 죽여서** 막는다.
//   dev·preview(localhost 등)는 건드리지 않음.
if (
  process.env.VERCEL_ENV === "production" &&
  !env.NEXT_PUBLIC_APP_URL.startsWith("https://app.")
) {
  throw new Error(
    `[env assertion] NEXT_PUBLIC_APP_URL="${env.NEXT_PUBLIC_APP_URL}" — 프로덕션은 https://app.findable.co.kr 이어야 합니다(로그인 링크 오배선 방지). Vercel env 를 고치고 재배포하세요.`
  );
}
