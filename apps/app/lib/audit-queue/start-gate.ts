import { isStabilityFlagOn } from "@repo/audit/stability-flags";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { overManualCap } from "./daily-cap";

export interface StartGate {
  /** 입장 관리 플래그가 켜져 있는가 — 켜져 있으면 job 을 만든 뒤 `admitJob`(슬롯 예약)으로 시작 여부를 정한다. */
  admissionOn: boolean;
  /** 수동 측정 일·월 상한에 걸렸는가. */
  overCap: boolean;
  /** 입장 판정에 쓸 플랜(플래그 켜짐일 때만 조회). */
  plan?: string;
}

/**
 * start-tracking 의 안정성 관문(U2). 두 플래그가 모두 꺼져 있으면 **DB 호출도 플랜 조회도 없이**
 * 예전과 같은 결과(상한 아님·입장 관리 꺼짐)를 돌려준다.
 * 🔒 N6: 아래 조회는 전부 직렬 — DB 연결 풀이 1개라 병렬로 쏘면 연결 대기 오류가 난다.
 * 시작 여부(상한 안인가)는 여기서 정하지 않는다 — 판정과 자리 확보가 쪼개지면 같은 순간 몰린 요청이 상한을 넘으므로
 * job 을 만든 뒤 `admitJob`(slot-reservation.ts)이 한 트랜잭션에서 정한다.
 */
export async function startGate(orgId: string): Promise<StartGate> {
  const capOn = isStabilityFlagOn("STABILITY_ORG_DAILY_CAP_ENABLED");
  const admissionOn = isStabilityFlagOn("STABILITY_ADMISSION_ENABLED");
  if (!(capOn || admissionOn)) {
    return { admissionOn: false, overCap: false };
  }
  const plan = await getCurrentPlan();
  if (capOn && (await overManualCap(orgId, plan))) {
    return { admissionOn, overCap: true, plan };
  }
  return { admissionOn, overCap: false, plan };
}
