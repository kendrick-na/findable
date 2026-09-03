-- 운영자 고객사 컨설팅 기록. 고객사 데이터와 메모의 소유 경계는 organizationId로 고정한다.
CREATE TABLE "ConsultationNote" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "nextCheckAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultationNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultationNote_organizationId_createdAt_idx"
  ON "ConsultationNote"("organizationId", "createdAt");
