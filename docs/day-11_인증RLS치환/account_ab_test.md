# A-11-O2 — 조직 A/B 교차 검증 (org 격리 증거)

> Findable · Day11 단계5 · 2026-07-19 · Track A
> 교재 A팀/B팀 계정 → Findable **org-A/org-B**. RLS 없음 → 앱레벨 `where:{organizationId}` 스코핑이 유일 방어.
> ⚠️ **상태**: 앱레벨 스코핑 헬퍼(`requireOrg`·`scopedTracking`)는 **설계 확정, 실코드 미반영**(BL-Day11). 아래는 **기대 결과 + 미실행** 표기. 실행 시 "실제 결과·증거" 채움. (교재 규칙: 추측으로 막힘/뚫림 채우지 않음.)
> 🔒 검증은 반드시 **로그인한 앱 화면**에서. Neon 콘솔·Prisma Studio는 관리자 권한이라 전부 보임(교재의 "SQL Editor는 다 보인다"와 동일) — 그걸로 판정하지 않음.

## 검증 표 (A-04-O2 §6 계획 → Day11 실행)

| # | 시도 | 기대 결과 | 실제 결과 | 증거 |
|---|---|---|---|---|
| 1 | org-A 계정으로 만든 Brand를 org-B 계정으로 목록 조회 | org-A 브랜드가 org-B 목록에 **0건**(`where:{organizationId:B}`가 필터) | 미실행 | — |
| 2 | org-B 계정이 org-A의 Tracking을 `trackingId`로 직접 조회 | **차단** — `scopedTracking`이 `brand.organizationId=B` 조건으로 null 반환 (★org 키 없는 모델의 핵심 방어) | 미실행 | — |
| 3 | org-B 계정이 Brand INSERT 시 `organizationId`를 org-A로 위조 | **차단** — create의 organizationId를 클라 값 무시하고 **서버 `orgId` 강제 주입**(교재 WITH CHECK 등가) | 미실행 | — |
| 4 | 비로그인 상태로 `/`(대시보드) 접근 | Clerk 미들웨어가 `/sign-in`으로 redirect (교재 `/dashboard`→`/login`) | 미실행 | — ⚠️ 미들웨어 [확인필요](BL-Day11-01) |
| 5 | 로그아웃 후 새로고침 → 보호 페이지 접근 | 세션 없음 → `/sign-in` | 미실행 | — |
| 6 | anon으로 `/audit` 동일 IP 연속 요청(무료진단) | ipAddress rate limit 차단 | 미실행 | — ⚠️ rate limit 실재 [확인필요](Day18) |
| 7 | 서버(service) Prisma로 전체 조회 | 전체 보임 — **service는 스코핑 우회, 클라 노출 절대 금지 재확인** | (설계상 당연) | Clerk secret·DATABASE_URL 서버전용 ✅ |

## org 격리가 성립하는 설계 근거 (교재 RLS 디버깅 점검표 → Findable 등가)

교재 점검표 5항목을 Findable로 치환하면 "어디서 격리가 뚫리나"의 체크리스트가 된다:

| 교재 RLS 점검 | Findable 등가 점검 |
|---|---|
| ① RLS Enable ON? | 쿼리에 `where:{organizationId}` 있나? (없으면 = RLS OFF와 동일) |
| ② 정책에 `TO authenticated`? | 라우트가 `requireOrg()` 관문을 통과했나? |
| ③ `auth.uid()` null 아닌가(세션)? | `auth()`의 `orgId`가 null 아닌가(활성 org 선택됨)? |
| ④ INSERT에 WITH CHECK? | create가 org를 **서버 주입**하나(클라 값 신뢰 금지)? |
| ⑤ service_role 실수 사용? | Prisma를 서버에서 org 필터 없이 부르지 않나? |

> **핵심 차이**: 교재는 ①~⑤ 중 하나만 맞으면 DB가 막아준다. Findable은 **①(where 스코핑)을 코드가 매번 직접** 해야 하고, 빠뜨리면 DB가 안 막아준다. → 그래서 `scoped.ts` 헬퍼 경유 강제 + Prisma Extension 자동주입(BL-Day11-03)이 중요.

## 실행 전제 (검증 실행 시)

1. Clerk 테스트 조직 2개(org-A·org-B) 생성 + 각 계정 로그인.
2. `apps/app/lib/db/scoped.ts` 반영 + Brand 조회/생성이 헬퍼 경유.
3. `pnpm dev`(app 워크스페이스) → 위 7케이스 앱 화면에서 실행 → 표의 "실제 결과·증거" 채움.
