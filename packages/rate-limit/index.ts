import { Ratelimit, type RatelimitConfig } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { keys } from "./keys";

export const redis = new Redis({
  url: keys().UPSTASH_REDIS_REST_URL,
  token: keys().UPSTASH_REDIS_REST_TOKEN,
});

export const RATE_LIMIT_TIMEOUT_MS = 1000;

export const createRateLimiter = (props: Omit<RatelimitConfig, "redis">) =>
  new Ratelimit({
    redis,
    limiter: props.limiter ?? Ratelimit.slidingWindow(10, "10 s"),
    prefix: props.prefix ?? "next-forge",
    // 기본 5초는 문의 폼·구독 응답을 너무 오래 붙잡는다(2026-10-20).
    // 시간이 넘으면 라이브러리가 success:true, reason:"timeout" 을 돌려주고
    // limitOrAllow 가 이를 "판정 불가"로 분류해 로그 1건을 남긴다.
    timeout: props.timeout ?? RATE_LIMIT_TIMEOUT_MS,
  });

export const { slidingWindow } = Ratelimit;
export {
  describeRateLimitError,
  limitOrAllow,
  type RateLimitDecision,
  type RateLimitErrorSummary,
  type RateLimiterLike,
  RateLimitTimeoutError,
} from "./limit-or-allow";
