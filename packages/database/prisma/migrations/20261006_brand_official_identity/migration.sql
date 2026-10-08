-- Customer-entered official company identity for brand mention verification (2026-10-06).
-- Additive and nullable: existing rows are untouched.
ALTER TABLE "Brand" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Brand" ADD COLUMN "businessNumber" TEXT;
