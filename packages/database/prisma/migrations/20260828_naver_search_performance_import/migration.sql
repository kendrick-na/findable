-- Naver Search Advisor has no public performance API. CSV imports therefore
-- share the evidence tables without pretending to have an OAuth token.
ALTER TABLE "SearchPerformanceConnection"
  ALTER COLUMN "encryptedRefreshToken" DROP NOT NULL;
