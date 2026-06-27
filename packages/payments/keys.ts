import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    server: {
      STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
      STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
      PORTONE_API_SECRET: z.string().optional(),
      PORTONE_WEBHOOK_SECRET: z.string().optional(),
    },
    client: {
      NEXT_PUBLIC_PORTONE_STORE_ID: z.string().optional(),
      NEXT_PUBLIC_PORTONE_CHANNEL_KEY: z.string().optional(),
    },
    runtimeEnv: {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      PORTONE_API_SECRET: process.env.PORTONE_API_SECRET,
      PORTONE_WEBHOOK_SECRET: process.env.PORTONE_WEBHOOK_SECRET,
      NEXT_PUBLIC_PORTONE_STORE_ID: process.env.NEXT_PUBLIC_PORTONE_STORE_ID,
      NEXT_PUBLIC_PORTONE_CHANNEL_KEY:
        process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY,
    },
  });
