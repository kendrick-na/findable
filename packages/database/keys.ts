import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    server: {
      DATABASE_URL: z.url(),
    },
    runtimeEnv: {
      // The public Vercel project still has an integration-managed Neon URL.
      // Prefer the explicitly configured production DB without disconnecting
      // that integration or silently moving customer reports to the old DB.
      DATABASE_URL: process.env.FINDABLE_DATABASE_URL ?? process.env.DATABASE_URL,
    },
  });
