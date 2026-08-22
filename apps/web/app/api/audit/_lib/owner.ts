/*
 * 요청자가 이 진단의 소유자인가 — **audit 라우트 공용** (2026-08-13 세션N-26).
 *
 * ⚠️ 왜 `packages/audit` 이 아니라 여기인가: 판정 **규칙**은 이미 순수함수로
 *   `@repo/audit/ownership` 에 있다. 이 파일은 그 위에 **Clerk 세션 읽기**만 얹는다.
 *   `@repo/audit` 은 데이터·러너 패키지라 Clerk 의존을 끌어들이면 안 된다
 *   (그 패키지는 cron·러너에서도 import 된다).
 *
 * ⚠️ 왜 파일로 뺐나: `[jobId]/route.ts`(이메일 노출 판정)와
 *   `[jobId]/crew/route.ts`(심층분석 자격)가 **같은 판정**을 쓴다.
 *   복사하면 한쪽만 고쳐지는 상태가 된다 — 이 프로젝트가 반복해서 데인 지점
 *   (`maskEmail`·`scoreOf` 를 패키지로 올린 것과 같은 이유).
 *
 * ⚠️ `_lib` 접두사 = App Router 가 라우트로 취급하지 않는다.
 */

import { isAuditOwner } from "@repo/audit/ownership";
import { auth, currentUser } from "@repo/auth/server";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";

/*
 * 로그인 세션을 읽어 소유 여부를 판정한다 — **판정 실패 시 비소유(false)**.
 *
 * 🔴 기본값이 `false` 인 이유: audit 라우트는 **비로그인 접근이 정상**이다(무료 진단은
 *   로그인 없이 결과를 본다). 그래서 세션이 없는 것은 오류가 아니라 **평상시**이고,
 *   판별을 못 하는 상황에서 열어주는 쪽으로 기울면 검사를 넣은 의미가 사라진다.
 * ⚠️ 판별이 터져도 **호출한 라우트를 깨뜨리지 않는다** — 여기서 throw 하면
 *   고객이 결과를 통째로 못 본다(과잉 방어). 대신 로그를 남기고 비소유로 답한다.
 */
export async function resolveIsOwner(job: {
  email: string;
  organizationId: string | null;
}): Promise<boolean> {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return false;
    }
    const user = await currentUser();
    const viewerEmail = user?.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    )?.emailAddress;
    return isAuditOwner(job, { email: viewerEmail, orgId });
  } catch (error) {
    log.warn("audit.owner_check_failed", { error: parseError(error) });
    return false;
  }
}
