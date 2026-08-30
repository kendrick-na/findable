-- 고객 승인 기반 Search Console·GA4 연결과 일별 실측 데이터.
-- 토큰은 애플리케이션 키로 AES-256-GCM 암호화된 값만 저장한다.

CREATE TABLE "SearchPerformanceConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "propertyId" TEXT,
  "propertyName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_property',
  "encryptedRefreshToken" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdBy" TEXT NOT NULL,
  "tokenUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchPerformanceConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchPerformanceDaily" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "clicks" INTEGER,
  "impressions" INTEGER,
  "ctr" DOUBLE PRECISION,
  "averagePosition" DOUBLE PRECISION,
  "sessions" INTEGER,
  "engagedSessions" INTEGER,
  "keyEvents" DOUBLE PRECISION,
  "totalRevenue" DOUBLE PRECISION,
  "dataFinal" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchPerformanceDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchPerformanceConnection_brandId_provider_key"
  ON "SearchPerformanceConnection"("brandId", "provider");
CREATE INDEX "SearchPerformanceConnection_organizationId_updatedAt_idx"
  ON "SearchPerformanceConnection"("organizationId", "updatedAt");
CREATE INDEX "SearchPerformanceConnection_status_idx"
  ON "SearchPerformanceConnection"("status");
CREATE UNIQUE INDEX "SearchPerformanceDaily_connectionId_date_key"
  ON "SearchPerformanceDaily"("connectionId", "date");
CREATE INDEX "SearchPerformanceDaily_connectionId_date_idx"
  ON "SearchPerformanceDaily"("connectionId", "date");
