/**
 * cron 엔드포인트 인증 — 단일 진실 (2026-08-11 세션N-18).
 *
 * 🔴 **왜 이 파일이 생겼나 (실측 사고 이력)**
 *   이전 가드는 이랬다:
 *     const authorized = cronSecret ? authHeader === `Bearer ${cronSecret}` : isVercelCron;
 *   즉 `CRON_SECRET` 이 **없으면** `x-vercel-cron: 1` 헤더만 보고 통과시켰다.
 *   그런데 프로덕션에 `CRON_SECRET` 이 실제로 **없었다**(env 실측).
 *   → `curl -H "x-vercel-cron: 1" https://www.findable.co.kr/api/cron/auto-refresh-tracking`
 *     **한 줄로 외부인이 실측을 실행시킬 수 있었다.** 세션N-18 이 우연히 이걸 밟아
 *     측정 5건(약 435원)이 실행되며 발견됐다. 반복 호출하면 원가가 무제한으로 나간다.
 *
 * 🔒 **`x-vercel-cron` 은 인증 수단이 아니다.** 그냥 요청 헤더라 누구나 붙일 수 있고,
 *   Vercel 공식문서도 인증 방법으로 `CRON_SECRET` **만** 안내한다(그 헤더는 정보용).
 *   ⚠️ 이 헤더를 "보조 통과 조건"으로 **되살리지 말 것** — 되살리는 순간 구멍이 그대로 복구된다.
 *
 * 🔒 **시크릿이 없으면 열지 않고 닫는다(fail closed).** 예전처럼 "없으면 헤더로 통과"
 *   시키면 env 를 깜빡한 배포가 조용히 무방비가 된다. 공식 예제도 `!cronSecret` 이면 401 이다.
 *
 * ⚠️ 이 함수는 **원가가 나가는 작업 이전**에 호출할 것(측정·메일 발송 전에 먼저 막는다).
 */

import { timingSafeEqual } from "node:crypto";

/**
 * 타이밍 공격 방지용 상수시간 비교.
 * ⚠️ `timingSafeEqual` 은 길이가 다르면 **던진다** → 길이를 먼저 본다(길이 노출은 무해).
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * cron 요청이 진짜 Vercel 스케줄러인지 판정.
 *
 * Vercel 은 `CRON_SECRET` 이 설정돼 있으면 그 값을 `Authorization: Bearer <값>` 으로
 * 자동 전송한다(공식). 우리는 그 값만 신뢰한다.
 *
 * @returns 통과면 null, 막으면 그대로 반환할 401 Response.
 */
export function denyIfNotCron(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!(cronSecret && authHeader)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!safeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
