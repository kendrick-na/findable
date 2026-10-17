import { isStabilityFlagOn } from "@repo/audit/stability-flags";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { type AdmissionDecision, decideAdmission } from "./admission";
import { overManualCap } from "./daily-cap";

export interface StartGate {
  admission: AdmissionDecision;
  /** 수동 측정 일·월 상한에 걸렸는가. */
  overCap: boolean;
}

/**
 * start-tracking 의 안정성 관문(U2). 두 플래그가 모두 꺼져 있으면 **DB 호출도 플랜 조회도 없이**
 * 예전과 같은 결과(`start`, 상한 아님)를 돌려준다.
 * 🔒 N6: 아래 조회는 전부 직렬 — DB 연결 풀이 1개라 병렬로 쏘면 연결 대기 오류가 난다.
 */
export async function startGate(orgId: string): Promise<StartGate> {
  const capOn = isStabilityFlagOn("STABILITY_ORG_DAILY_CAP_ENABLED");
  const admissionOn = isStabilityFlagOn("STABILITY_ADMISSION_ENABLED");
  if (!(capOn || admissionOn)) {
    return { admission: "start", overCap: false };
  }
  const plan = await getCurrentPlan();
  if (capOn && (await overManualCap(orgId, plan))) {
    return { admission: "start", overCap: true };
  }
  // 여유가 있으면 "start" = 기존과 똑같이 즉시 시작. 상한이면 "wait", DB 오류 연속이면 "hold" → 대기 줄.
  return {
    admission: admissionOn ? await decideAdmission(orgId, plan) : "start",
    overCap: false,
  };
}
