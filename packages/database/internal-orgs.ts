/**
 * 내부 전용 조직(org) — 고객이 아닌, 우리 DB 에만 있는 조직. 2026-10-07 대표 결정.
 *
 * 「회사 찾기」 [측정]이 만드는 영업 대상 브랜드는 **영업 전용 내부 조직** 한 곳에만 생긴다.
 *   - Clerk 에는 만들지 않는다(Clerk 를 무겁게 하지 않기). Organization.id 는 우리 DB 문자열 id 라
 *     고정 id 하나로 find-or-create 한다(스키마·migration 변경 없음).
 *   - 🔴 이 조직은 **고객이 아니다** — 정기 자동 측정·결제/요금제 만료·안내 메일·고객 목록·통계에서 빠져야 한다.
 *     그런 곳은 모두 `notInternalOrg` / `brandNotInInternalOrg` 를 where 에 넣는다
 *     (목록과 테스트: apps/app/__tests__/internal-org-exclusion.test.ts).
 *
 * 이 파일은 순수 상수만 둔다(server-only·Prisma 클라이언트 import 없음) — 어느 패키지에서나 가볍게 import.
 */

/** 영업 전용 내부 조직 id(고정, UUID 형식). 절대 바꾸지 말 것 — 바꾸면 기존 영업 브랜드가 고아가 된다. */
export const SALES_INTERNAL_ORG_ID = "f1dab1e0-5a1e-4000-8000-00000000a001";

/** 화면·로그에 보이는 이름 */
export const SALES_INTERNAL_ORG_NAME = "Findable 영업(내부)";

/** 모든 내부 조직 id — 늘어나면 여기에만 추가한다. */
export const INTERNAL_ORG_IDS: readonly string[] = [SALES_INTERNAL_ORG_ID];

export function isInternalOrgId(id: string | null | undefined): boolean {
  return Boolean(id && INTERNAL_ORG_IDS.includes(id));
}

/** Organization where 조각 — 내부 조직 제외 */
export const notInternalOrg: { id: { notIn: string[] } } = {
  id: { notIn: [...INTERNAL_ORG_IDS] },
};

/**
 * AuditJob where 조각 — 내부 조직 측정 제외. ⚠️ 무료 진단은 organizationId 가 null 이라
 * `notIn` 만 쓰면 SQL NOT IN 이 null 행까지 빼 버린다 → null 을 명시적으로 살린다.
 * (OR 를 쓰므로 다른 OR 와 같은 where 에 펼치지 말고 AND 로 묶을 것.)
 */
export const auditJobNotInternal: {
  OR: [{ organizationId: null }, { organizationId: { notIn: string[] } }];
} = {
  OR: [
    { organizationId: null },
    { organizationId: { notIn: [...INTERNAL_ORG_IDS] } },
  ],
};

/**
 * 홈 **공개 카운터에서만** 빼는 우리 팀·테스트 조직(2026-10-15 대표 위임 점검).
 *
 * 🔴 왜: 공개 카운터 「진단 완료」 424건 중 **322건(76%)이 대표 본인·팀·QA 계정의 진단**이었다
 *   (영업 전용 내부 조직 `INTERNAL_ORG_IDS` 에 안 들어 있어 집계에 남았다). 외부(무료 진단 64 +
 *   타 조직 38)는 102건·33개 도메인. 외부 제출(투자·지원사업 심사)에서 "고객 이용 실적"으로 읽히면
 *   부풀린 숫자가 된다 — 이 저장소가 반복해 온 사고 유형.
 *
 * ⚠️ `INTERNAL_ORG_IDS` 에 **넣지 않는다**: 그 목록은 정기 자동 측정·결제 만료·안내 메일에서 조직을
 *   빼는 데 쓰이는데, 이 조직들(특히 Indigochild's Organization)은 실제로 Findable 자체 측정을 돌린다.
 *   카운터 표시만 빼는 별도 목록이다. 새 팀·테스트 조직을 만들면 여기에 추가한다.
 * ⚠️ 무료 진단(`organizationId` null)은 외부로 센다 — 팀원이 무료 진단을 돌렸다면 구분이 불가능하다.
 */
export const PUBLIC_COUNTER_EXCLUDED_ORG_IDS: readonly string[] = [
  "org_3H1hu6UtLJpiYCcPjFm5hgjU1qn", // Indigochild's Organization (대표, growth)
  "org_3IHag8VM4C4v3xBkAvqQHfb7pkP", // Indigochild's Organization (free)
  "org_3HOuTrT1HV6gBbe4phX7Y9RlNuy", // Indigochild 인디고차일드
  "org_3HgeLCQ6OcUCL8RNYjP3qTX0Nat", // My Organization (QA, growth)
  "org_3IHOMGUWcWAEXjexlO0OS6zuE8C", // My Organization (팀)
  "org_3I2ctt3yY1e1uPyEdxs8Erze5DM", // My Organization (팀)
  "org_3JgFruHNFiSl2PWuCKPhEdbiAPW", // My Organization (결제 테스트)
  "org_3IWYGGnsLLXV5yeI1yeZDeCA4sM", // Findable E2E QA
  "org_3IIiKCIthFgAbXCw7QsEFXnvLA2", // Findable Demo
];

/** AuditJob where 조각 — 공개 카운터용: 팀·테스트 조직 제외(무료 진단은 남김). `AND` 로 묶어 쓴다. */
export const auditJobNotTeam: {
  OR: [{ organizationId: null }, { organizationId: { notIn: string[] } }];
} = {
  OR: [
    { organizationId: null },
    { organizationId: { notIn: [...PUBLIC_COUNTER_EXCLUDED_ORG_IDS] } },
  ],
};

/** AuditJob where 조각 — 내부 조직(영업) 측정만 */
export const auditJobInternal: { organizationId: { in: string[] } } = {
  organizationId: { in: [...INTERNAL_ORG_IDS] },
};

/** Brand where 조각 — 내부 조직 브랜드 제외 */
export const brandNotInInternalOrg: {
  organizationId: { notIn: string[] };
} = {
  organizationId: { notIn: [...INTERNAL_ORG_IDS] },
};
