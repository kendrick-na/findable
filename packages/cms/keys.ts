import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// Preview는 공개 브랜치의 UI 검증용이다. CMS 스키마·콘텐츠 동기화는
// Production에서만 수행하며, Preview에서 오래된/권한이 다른 토큰을 사용해
// 빌드 전체가 실패하지 않도록 BaseHub 클라이언트를 비활성화한다.
const basehubToken =
  process.env.VERCEL_ENV === "preview" ? undefined : process.env.BASEHUB_TOKEN;

export const keys = () =>
  createEnv({
    server: {
      BASEHUB_TOKEN: z.string().startsWith("bshb_pk_").optional(),
    },
    runtimeEnv: {
      BASEHUB_TOKEN: basehubToken,
    },
  });
