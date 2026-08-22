import { env } from "@/env";
import { getAppDictionary } from "@/lib/i18n";
import { sampleReportUrl } from "@/lib/sample-report";
import { DashboardEmptyStateView, type Props } from "./dashboard-empty-state";

/**
 * 가입 직후 첫 화면 — **서버 껍데기**. 사전과 env 만 읽어 순수 뷰에 넘긴다.
 *
 * 🔴 **왜 파일을 나눴는가**(N-43 · 스크린샷으로 발견):
 *   뷰와 같은 파일에 두면 스토리가 이 파일을 통째로 로드하면서
 *   ① `env` 검증 throw(`Invalid environment variables`)
 *   ② `server-only` throw
 *   를 **차례로** 맞고 **화면이 빈 채로 스크린샷만 찍힌다**(가드가 8건 잡았다).
 *   tsc 0 · 테스트 584/584 통과였는데 **화면만 안 나왔다.**
 *   ⚠️ 두 번 헛짚었다 — `async` 를 의심했는데 원인은 `env` 와 `server-only` 였다.
 *     📕 규율: 추측으로 고치지 말고 **콘솔 에러를 읽는다**.
 *   → 📕 N-37·N-41 주입 패턴: 서버 전용 의존은 껍데기가 먹고, 화면은 순수 뷰가 그린다.
 *
 * 🔒 표본 회차·공유뷰 규칙은 `@/lib/sample-report` 하나에 있다(N-44 · 측정 대기 화면과 공유).
 */

export const DashboardEmptyState = async ({ signedInEmail }: Props = {}) => {
  const t = (await getAppDictionary()).emptyState;
  return (
    <DashboardEmptyStateView
      sampleUrl={sampleReportUrl(env.NEXT_PUBLIC_WEB_URL)}
      signedInEmail={signedInEmail}
      t={t}
    />
  );
};
