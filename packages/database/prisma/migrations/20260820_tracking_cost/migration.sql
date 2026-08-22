-- 원가 계기 (세션N-47 · 2026-08-20)
--
-- 왜: 👤 "그라운딩을 켜면 비용이 얼마나 오르나" 에 답할 수 없었다.
--   cost.ts 는 있었으나 프로덕션 호출 0곳 + 토큰 수를 어디에도 안 남겼다.
--   측정 1건 원가를 모르면 요금제 설계의 분모가 비어 있는 것과 같다.
--
-- 전부 NULL 허용 = 기존 382행은 그대로 두고 앞으로 쌓이는 것만 채운다.
--   ⚠️ 집계할 때 NULL 을 0 으로 세지 말 것 — "못 잰 것"과 "0원"은 다르다.
ALTER TABLE "Tracking" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "Tracking" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "Tracking" ADD COLUMN "costKrw" DOUBLE PRECISION;
ALTER TABLE "Tracking" ADD COLUMN "costBasis" TEXT;
