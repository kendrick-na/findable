import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * 앱이 실제로 접속하는 DB 주소를 고르는 **단일 규칙**: FINDABLE_DATABASE_URL 우선, 없으면 DATABASE_URL.
 * 운영 빌드 게이트(`scripts/privacy-build-gate.ts`)도 이 함수를 써서 런타임과 같은 DB 를 검사한다.
 */
export const resolveDatabaseUrl = (
  env: Record<string, string | undefined>
): string | undefined => env.FINDABLE_DATABASE_URL ?? env.DATABASE_URL;

export const keys = () =>
  createEnv({
    server: {
      DATABASE_URL: z.url(),
    },
    runtimeEnv: {
      // The public Vercel project still has an integration-managed Neon URL.
      // Prefer the explicitly configured production DB without disconnecting
      // that integration or silently moving customer reports to the old DB.
      DATABASE_URL: resolveDatabaseUrl(process.env),
    },
  });
