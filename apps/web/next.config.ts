import { withCMS } from "@repo/cms/next-config";
import { withToolbar } from "@repo/feature-flags/lib/toolbar";
import { config, withAnalyzer } from "@repo/next-config";
import { withLogging, withSentry } from "@repo/observability/next-config";
import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";
import { env } from "@/env";

let nextConfig: NextConfig = withToolbar(withLogging(config));

// PDF 리포트 복구(2026-08-10) — 🔴 3개월(5/3~) 100% 실패의 진짜 원인.
// `@sparticuz/chromium` 은 브라우저 바이너리를 `../bin/chromium.br` 처럼
// **런타임에 문자열로** 조립해 찾는다. Next 의 추적기(@vercel/nft)는 import·require·fs 를
// **정적 분석**하므로 이 경로를 볼 수 없고, 그래서 66MB 바이너리가 배포본에서 통째로 빠진다.
// 🔬실측(빌드 산출물 nft 전수): web 37개·app 27개 함수 중 `chromium.br` 포함 = **0개**.
// → 함수는 뜨지만 실행 파일이 없어 launch 가 실패하고, runner 의 try/catch 가 조용히 삼켰다.
// ⚠️ `serverExternalPackages` 로는 해결되지 않는다 — chromium·puppeteer-core 는 Next 가
//    이미 자동 opt-out 목록에 넣어둔 패키지라 추가해도 no-op 이다(문서 확인). 빠진 것은
//    "번들 제외"가 아니라 **파일 동봉**이므로 `outputFileTracingIncludes` 가 정답이다.
// ⚠️ 버전 고정 글롭(`@sparticuz+chromium@148.0.0`)을 쓰지 않는다 — 업그레이드 때
//    조용히 다시 깨진다. pnpm 해시 폴더를 와일드카드로 받는다.
// 대상 = 러너를 실제로 실행하는 라우트만(전 라우트에 넣으면 배포본이 불필요하게 커진다).
const CHROMIUM_BIN =
  "../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/*";

// ⚠️ 이 저장소에는 chromium 바이너리가 **2벌** 있다(실측: inode 가 달라 하드링크 아님) —
//    루트 pnpm 스토어와 `apps/web/node_modules/.pnpm/` 중첩 스토어. nft 가 중첩본도
//    **스스로 추적**하므로 include 글롭을 좁혀도 131MB(64MB×2)가 동봉된다.
//    exclude 로 빼려 했으나 **불가**: exclude 값은 프로젝트 루트(`apps/web`) 기준으로
//    picomatch 매칭돼 `../` 로 루트 밖(모노레포 스토어)을 가리키는 패턴은 매칭되지 않는다.
// 🟢 그래도 **문제가 아니다**: 함수 총량 실측 **148MB / 한도 250MB**(여유 100MB).
//    🔴 참고로 `pdf-generator.ts` 주석과 기존 투두의 *"50MB 한도"* 는 **틀린 수치다**
//    (공식 문서 실측: 비압축 **250MB**). 즉 *"66MB > 50MB 라서 실패"* 가설은 애초에
//    성립하지 않았고, 진짜 원인은 위의 **추적 누락(0개)** 이다.
nextConfig.outputFileTracingIncludes = {
  ...nextConfig.outputFileTracingIncludes,
  "/api/audit": [CHROMIUM_BIN],
  "/api/cron/auto-refresh-tracking": [CHROMIUM_BIN],
};

nextConfig.images?.remotePatterns?.push({
  protocol: "https",
  hostname: "assets.basehub.com",
});

if (process.env.NODE_ENV === "production") {
  const redirects: NextConfig["redirects"] = async () => [
    {
      source: "/legal",
      destination: "/legal/privacy",
      statusCode: 301,
    },
  ];

  nextConfig.redirects = redirects;
}

if (env.VERCEL) {
  nextConfig = withSentry(nextConfig);
}

if (env.ANALYZE === "true") {
  nextConfig = withAnalyzer(nextConfig);
}

// BotID(2026-08-02) — 무료 진단 어뷰징 방어 4층 중 1층(자동화 차단).
// withBotId 는 챌린지 스크립트용 프록시 rewrite 를 주입한다(광고차단기 회피 목적).
// ⚠️ 반드시 최종 config 를 감싸야 rewrite 가 살아남는다.
export default withBotId(withCMS(nextConfig));
