import { hasPartnerAccess, type Plan } from "@repo/auth/plan";
import { getMyPartnerStatus } from "@/app/actions/partner/query";
import { PartnerCtaClient } from "./partner-cta-client";

/**
 * 파트너 신청 CTA (서버). DB 에서 신청 상태를 읽어 상태별 UI 를 클라이언트에 위임.
 * 이미 파트너 접근권(Growth 이상) 보유면 아무것도 렌더하지 않음.
 */
export const PartnerCTA = async ({ plan }: { plan: Plan }) => {
  // 이미 파트너 접근권이 있으면 신청 CTA 불필요.
  if (hasPartnerAccess(plan)) {
    return null;
  }

  const { status, note } = await getMyPartnerStatus();

  // approved 인데 캐시(plan)가 아직 안 붙은 과도기 → CTA 숨김(곧 반영).
  if (status === "approved") {
    return null;
  }

  return <PartnerCtaClient note={note} status={status} />;
};
