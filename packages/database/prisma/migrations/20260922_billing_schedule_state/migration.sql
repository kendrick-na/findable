-- 카카오페이 라이브 정기결제: 현재 회차와 다음 예약 회차를 분리해 기록한다.
-- 이 상태가 있어야 PortOne 웹훅 재전송에도 다음 달 청구가 중복 예약되지 않는다.
ALTER TABLE "Organization"
  ADD COLUMN "billingLastPaymentId" TEXT,
  ADD COLUMN "billingNextPaymentId" TEXT,
  ADD COLUMN "billingNextPaymentAt" TIMESTAMP(3);
