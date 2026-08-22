import "server-only";

import { auth } from "@repo/auth/server";
import { database } from "@repo/database";

/**
 * 「이 조직이 **설정을 마쳤나**」 — **온보딩 게이트의 단일 판정**.
 *
 * 🔴🔴 **N-44 정정 — 「측정했나」가 아니라 「설정을 마쳤나」다.**
 *   처음엔 `Tracking` **또는** `AuditJob` 으로 판정했는데, 실측 결과 **무료 이메일 진단만
 *   받고 가입한 사람**이 갇혔다:
 *     ① `AuditJob` 이 있어 게이트가 온보딩을 **막고**
 *     ② 무료 진단은 **`Brand` 를 만들지 않는다**(`assign.ts:15` 실측 — 러너는 AuditJob 만 write)
 *        → `/brand` 에 브랜드 카드가 없어 **별칭·경쟁사 편집기(1-c)도 안 보인다**
 *   결과: **어디서도 브랜드 설정을 할 수 없는 사용자**가 생긴다.
 *   → 판정 기준을 **`Tracking`(정식 측정)** 으로 좁힌다. `AuditJob`(무료 진단)만으로는
 *     "설정을 마쳤다"고 보지 않는다 — 그 사람에겐 `Brand` 도 별칭·경쟁사도 없기 때문이다.
 *
 * ⚠️ **`Brand` 존재로 판정하면 안 된다**(N-44 에서 실제로 그렇게 짰다가 되돌림):
 *   온보딩 1단계가 `Brand` 를 만들므로, 그 즉시 게이트가 참이 되어 **2~5단계에 영영
 *   도달하지 못한다**. 게이트는 *"이미 쓰고 있는 사람"* 만 걸러야 한다.
 *
 * 🔴 **왜 헬퍼로 뺐나**(N-44): 이 저장소에는 "측정이 있나"를 답하는 코드가 **이미 둘**이다.
 *   ① 대시보드 `hasData` = `Tracking` **또는** `AuditJob`
 *   ② 레이아웃 `scopedHeaderMetric()` = `Tracking` **만**
 *   두 답이 갈리는 사람이 실재한다 — **무료 이메일 진단만 받은 사용자**(AuditJob 은 있고
 *   Tracking 은 없다). 게이트를 ②로 만들면 **그 사람이 온보딩에 다시 갇힌다.**
 *   → 전자상거래법 「반복간섭」(v4 §7-D-4)에 걸리는 바로 그 상황이다.
 *
 *   ⚠️ 그래서 게이트는 **①과 같은 기준**을 쓴다. 다만 세 번째 복제본을 만들지 않도록
 *   여기 하나만 두고, 대시보드·`/welcome` 이 **같은 함수**를 부른다.
 *   📕 규율: 같은 수치를 두 벌로 세면 화면끼리 갈린다(N-43 「측정 34회」 사고).
 *
 * ⚠️ **비용**: 존재 여부만 본다(`findFirst` + `select: {id}`). 📕 N-39 실측 — 대시보드가
 *   `result`(Json)를 같이 읽어 **6,293ms**(서버 대기의 83%)를 태운 사고가 있었다.
 *   여기서 무거운 컬럼을 읽지 않는다.
 */
export async function hasCompletedSetup(): Promise<boolean> {
  const { orgId } = await auth();
  if (!orgId) {
    // org 가 없으면 측정도 있을 수 없다(Tracking 이 brand 경유로 org 에 매인다).
    return false;
  }

  // 완료 버튼을 누른 사실과 측정 성공 여부는 서로 다르다. 측정이 실패하거나 오늘 한도에
  // 걸려도 사용자가 설정을 끝냈다면 다음 로그인에서 다시 온보딩에 가두지 않는다.
  // 기존 고객은 새 컬럼이 null이어도 Tracking으로 그대로 통과한다.
  const [organization, tracking] = await Promise.all([
    database.organization.findUnique({
      select: { onboardingCompletedAt: true },
      where: { id: orgId },
    }),
    database.tracking.findFirst({
      select: { id: true },
      where: { brand: { organizationId: orgId } },
    }),
  ]);
  return Boolean(organization?.onboardingCompletedAt) || tracking !== null;
}
