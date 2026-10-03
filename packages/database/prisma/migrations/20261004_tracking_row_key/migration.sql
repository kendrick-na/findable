-- Additive, release-gated migration for audit Tracking idempotency.
-- Existing rows remain NULL; no backfill or delete is performed.
ALTER TABLE "Tracking"
  ADD COLUMN "trackingRowKey" TEXT;

CREATE UNIQUE INDEX "Tracking_trackingRowKey_key"
  ON "Tracking" ("trackingRowKey");
