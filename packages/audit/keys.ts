import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    server: {
      // 20번(runner→Tracking dual-write) 기능 플래그. 기본 off.
      //   "true"일 때만 audit 완료 후 Tracking 적재를 시도한다(설계문서 §2 보강4).
      //   ⚠️ off로 배포 → ensureOrg·트리거·seed 검증 후 on. 오프상태는 라이브 영향 0.
      //   문자열 env를 boolean으로: 값이 정확히 "true"일 때만 true(미설정·"false"·"0" 모두 off).
      // P2(2026-07-29): 러너가 @repo/audit로 이관되며 플래그 소유도 apps/web/env.ts에서
      //   이 패키지로 이동. apps/web/env.ts는 extends에 audit()로 이 검증을 계속 합성한다.
      AUDIT_DUAL_WRITE_ENABLED: z
        .string()
        .optional()
        .transform((v) => v === "true"),
      /**
       * 🔴 **네이버 AI 브리핑 본류 편입** 플래그(N-45 · #4-b B-4). **기본 off.**
       *
       * 왜 플래그인가: 이 스위치는 **Firecrawl 크레딧을 쓴다**(측정당 최대 3콜).
       *   켜기 전에 잔량을 확인해야 하고, 마르면 **끄는 것만으로 즉시 멈출 수 있어야** 한다.
       *   (코드를 되돌리는 것보다 env 한 줄이 빠르다 — 크레딧은 되돌릴 수 없다)
       *
       * ⚠️ 켤 때 확인: ① Firecrawl 잔량(👤 2026-08-19 기준 **1,429**)
       *   ② `MAX_TRIGGERS_PER_RUN` 이 그대로인지(하루 소비 상한 = 소진 예측의 전제)
       *   ③ 일일 다이제스트에 `briefing_blocked` 가 안 뜨는지(B-6)
       */
      AUDIT_BRIEFING_IN_MAIN_ENABLED: z
        .string()
        .optional()
        .transform((v) => v === "true"),
    },
    runtimeEnv: {
      AUDIT_BRIEFING_IN_MAIN_ENABLED:
        process.env.AUDIT_BRIEFING_IN_MAIN_ENABLED,
      AUDIT_DUAL_WRITE_ENABLED: process.env.AUDIT_DUAL_WRITE_ENABLED,
    },
  });
