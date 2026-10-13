-- Prompt archive (2026-10-14, 질문 보관): one nullable column. Additive only; no existing data changes.
-- Old code keeps working with the column present (it never reads it).
-- The app reads/writes this column with raw SQL only (packages/audit/prompt-archive.ts), so the Prisma schema
-- is intentionally NOT changed: if this SQL is not applied yet, the app treats "no archived prompts" and
-- archive/restore return a friendly error instead of breaking every Prompt query.
-- NOT applied to any database yet. Apply to production, then to the Neon preview copy.
ALTER TABLE "Prompt" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
