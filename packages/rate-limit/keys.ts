import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/** Vercel's Upstash integration uses KV-prefixed names on this project. */
export function resolveRedisEnv(
  env: Record<string, string | undefined>
): { url: string | undefined; token: string | undefined } {
  return {
    url: env.UPSTASH_REDIS_REST_URL ?? env.UPSTASH_REDIS_REST_KV_REST_API_URL,
    token:
      env.UPSTASH_REDIS_REST_TOKEN ?? env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN,
  };
}

export const keys = () =>
  createEnv({
    server: {
      UPSTASH_REDIS_REST_URL: z.url().optional(),
      UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    },
    runtimeEnv: {
      UPSTASH_REDIS_REST_URL: resolveRedisEnv(process.env).url,
      UPSTASH_REDIS_REST_TOKEN: resolveRedisEnv(process.env).token,
    },
  });

export const isRateLimitConfigured = () => {
  const { url, token } = resolveRedisEnv(process.env);
  return Boolean(url && token);
};
