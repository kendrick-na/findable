import { inferMarketScope } from "@repo/audit/market-scope";
import { updateBrandProfile } from "@/app/actions/brand/update-profile";
import { getAppDictionary } from "@/lib/i18n";
import { WelcomeFlow } from "./welcome-flow";

/**
 * 온보딩 2~5단계 **서버 껍데기** — 서버 의존을 먹고 순수 뷰에 넘긴다.
 *
 * 🔴 **왜 파일을 나눴는가**(N-44 · Storybook 이 실제로 죽고서 고침):
 *   뷰가 `@/app/actions/...` 를 직접 import 하면 Prisma·`server-only` 가 브라우저
 *   번들에 딸려와 **`node:fs`·`node:crypto` UnhandledSchemeError** 로 Storybook 이
 *   통째로 죽는다(스토리 하나가 아니라 **전부**).
 *   📕 N-37·N-41 주입 패턴 · `dashboard-empty-state-server.tsx` 와 같은 구조.
 *
 * ⚠️ **추정은 여기서 한다** — `inferMarketScope` 는 순수 함수지만, 뷰가 직접 부르면
 *   `@repo/audit` 전체가 스토리 번들에 딸려온다. 값만 내려보낸다.
 */
export const WelcomeFlowServer = async ({
  brandDomain,
  brandIndustry,
  ...props
}: {
  brandDomain: string;
  brandId: string;
  brandIndustry?: string | null;
  brandName: string;
  measurement?: "failed" | "rate_limited" | "started";
  suggestedCompetitors?: string[];
}) => {
  // 🔴 사전은 **서버에서만** 읽는다(`server-only`) — 뷰에 문자열만 내려보낸다.
  //   📕 `CLAUDE.md §2`: 다국어 문자열은 dictionary 경유(하드코딩 금지).
  const t = (await getAppDictionary()).onboarding;
  const detected = inferMarketScope({
    domain: brandDomain,
    industry: brandIndustry ?? null,
  });
  return (
    <WelcomeFlow
      {...props}
      detected={{
        confidence: detected.confidence,
        reason: detected.reason,
        scope: detected.scope,
      }}
      onSave={updateBrandProfile}
      t={t}
    />
  );
};
