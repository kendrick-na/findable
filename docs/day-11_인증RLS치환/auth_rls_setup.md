# A-11-O1 — 인증(Clerk) + 접근 경계(앱레벨 org 스코핑) 설정

> Findable · Day11 · 2026-07-19 · **Track A (라이브 서비스 www.findable.co.kr)**
> ⚠️ **대전제 치환**: 오늘 커리큘럼은 통째로 **Supabase Auth + Postgres RLS**. Findable은 **Clerk 인증 + Neon+Prisma(`relationMode="prisma"` → DB-level RLS 없음)**. 그래서 "RLS를 새로 켜는 실습"이 아니라, **이미 있는 Clerk 인증을 재검증 + Day04 초안(A-04-O2)의 앱레벨 스코핑을 실제 강제 코드로 확정**하는 날.
> 근거: 2026-07-19 `packages/`·`schema.prisma` 실측. [확인사실]/[확인필요] 표기.

---

## 0. 교재(TaskFlow) ↔ Findable 6단계 치환 맵

| 단계 | 교재 (Supabase) | Findable (Clerk+Neon+Prisma) | 오늘 할 일 |
|---|---|---|---|
| ① Auth 설정 | Email Provider + `@supabase/ssr` server/client/middleware | **Clerk 이미 적용** (`packages/auth`) | 재검증(무엇이 있나) |
| ② 로그인 화면 | login/signup/logout/callback 직접 구현 | **Clerk `<SignIn>`·`<UserButton>` 이미 제공** | 재검증 + 보호 라우트 확인 |
| ③ RLS 정책 SQL | `ALTER TABLE ENABLE RLS` + `CREATE POLICY` | ❌ RLS 없음 → **`where:{organizationId}` 앱레벨 강제** | ★핵심: 스코핑 헬퍼 확정 |
| ④ profiles 트리거 | `SECURITY DEFINER` 가입 트리거 | **Clerk 웹훅 → User/Org 동기화** | 재검증 |
| ⑤ 계정 A/B 검증 | A팀/B팀 계정 교차 | **org-A/org-B 교차** (A-04-O2 §6 계획) | A-11-O2 |
| ⑥ Day12 노트 | 검색 결과 사용자별 분리 | Neon+pgvector 임베딩 **org 스코핑** | A-11-O3 |

> **왜 그대로 실행 못 하나**: Findable에 Supabase 프로젝트가 없다. `auth.uid()`·SQL Editor·`CREATE POLICY`를 실행할 대상이 없음. 교재 SQL은 **설계 사고 미러**(A-04-O2 §3에 이미 작성)로 두고, 실제 방어는 앱 코드가 한다.

---

## 1. 단계①② — Clerk 인증 재검증 (이미 있는 것)

### [확인사실] `packages/auth` 실측 (2026-07-19)

```
packages/auth/
  client.ts      ← 브라우저용 (교재 client.ts 등가)
  server.ts      ← 서버용 auth()/currentUser (교재 server.ts 등가)
  proxy.ts       ← 미들웨어 로직 (교재 middleware.ts 등가, next-forge는 proxy로 명명)
  provider.tsx   ← <ClerkProvider> 앱 래핑
  components/    ← SignIn/SignUp/UserButton 래퍼
  keys.ts        ← 환경변수 검증(t3-env)
```

교재가 오늘 3개 파일(server/client/middleware)을 **처음 만드는** 실습인데, Findable은 **6개 파일이 이미 완성·배포됨**. → 오늘 이 단계는 "새로 만들기"가 아니라 **"이미 경계가 있나 확인"**.

| 교재 산출물 | Findable 대응 | 상태 |
|---|---|---|
| Email Provider Enabled | Clerk (Google/Kakao OAuth) | ✅ 배포됨 |
| server.ts (getUser) | `packages/auth/server.ts` → `auth()`, `currentUser()` | ✅ |
| client.ts | `packages/auth/client.ts` | ✅ |
| middleware.ts 보호 라우트 | `packages/auth/proxy.ts` | ⚠️ **[확인필요]** — apps/app에 `middleware.ts` 파일이 실측에서 안 잡힘. proxy.ts를 apps/app 미들웨어가 실제 import하는지 확인 필요 |
| login/signup 페이지 | Clerk `<SignIn>` 컴포넌트 | ✅ |
| auth/callback (오픈리다이렉트 방지) | Clerk이 내부 처리 + `afterSignInUrl` | ✅ (Clerk이 검증) |

> **[확인필요] 액션**: `apps/app`에 미들웨어가 걸려 로그인 안 한 사용자가 대시보드에서 `/sign-in`으로 튕기는지 실제 확인. next-forge는 루트 `middleware.ts`에서 `authMiddleware`(proxy)를 export하는 게 표준인데 실측 grep에 안 나옴 → **실행백로그 BL-Day11-01** 등록.

### 교재 개념 → Findable 대응 (세션·토큰)

- 교재: Supabase가 access token(JWT ~1h) + refresh token(~60d) 쿠키 발급, middleware `getUser()`가 갱신.
- Findable: **Clerk이 동일 역할** — Clerk 세션 JWT + `__session` 쿠키, `auth()`가 서버에서 `userId`·`orgId` 반환. 토큰 갱신·검증은 Clerk이 관리(자체 세션 로직 새로 만들지 않음 — CLAUDE.md §2).
- 교재의 `auth.uid()`(RLS에서 사용자 판별) = Findable의 **`const { userId, orgId } = await auth()`** (앱 코드에서 판별).

---

## 2. 단계③ — ★오늘의 핵심: RLS → 앱레벨 org 스코핑 강제

### [확인사실] 스키마 실측 — org 키를 가진 모델은 9개 중 3개뿐

```
organizationId 직접 보유: Brand · Report · User          (격리 컬럼 O)
org 키 없음(경유 필요):   Tracking · Prompt · AuditJob · Lead · Engine · Organization
```

**가장 위험한 지점 (Day04 §5-1이 예측 → 실측 확인됨):**

```prisma
model Tracking {
  id       String @id
  brandId  String              // ← organizationId 없음! brand를 통해서만 org 확인 가능
  brand    Brand  @relation(...)
  ...
  @@index([brandId])
}
```

→ **`prisma.tracking.findUnique({ where:{ id } })`를 org 확인 없이 부르면 조직 간 유출.** Postgres RLS가 없으니 이걸 막는 건 오직 앱 코드. 교재의 tasks 테이블처럼 "정책 하나 켜면 끝"이 아니라, **모든 tracking 접근 경로에 brand 경유 org 확인을 강제**해야 한다.

### 해결 = 스코핑 헬퍼 (교재의 CREATE POLICY 등가물)

교재가 SQL 정책으로 하는 일을, Findable은 **재사용 강제 함수**로 한다. `lib/db/scoped.ts` (신규, [확인사실] 아직 없음):

```ts
// apps/app/lib/db/scoped.ts — RLS 없는 Findable의 유일 격리선
import { auth } from '@repo/auth/server'
import { database } from '@repo/database'

/** org 컨텍스트를 강제로 꺼내는 관문. userId·orgId 없으면 거부(=교재 getUser() null → redirect). */
export async function requireOrg() {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) throw new UnauthorizedError('AUTH-401')
  return { userId, orgId }
}

/** Brand — org 직접 보유. 교재의 SELECT USING(team_id IN ...) 등가. */
export async function scopedBrands(orgId: string) {
  return database.brand.findMany({ where: { organizationId: orgId } }) // ★ where 강제
}

/** ⚠️ Tracking — org 키 없음 → brand 경유. 교재엔 없는 Findable 고유 방어. */
export async function scopedTracking(orgId: string, trackingId: string) {
  return database.tracking.findFirst({
    where: { id: trackingId, brand: { organizationId: orgId } }, // ★ brand.organizationId로 격리
  })
}
```

### 교재 4정책(SELECT/INSERT/UPDATE/DELETE) → 앱레벨 등가

| 교재 RLS | 판단 | Findable 앱레벨 강제 |
|---|---|---|
| `SELECT USING (team_id IN ...)` | 읽을 자격 | 모든 `findMany/findFirst`에 `where:{organizationId: orgId}` |
| `INSERT WITH CHECK (team_id IN ...)` | 쓸 자격 | `create({ data:{ ...input, organizationId: orgId } })` — org **서버 주입**(클라 값 신뢰 금지) |
| `UPDATE USING+WITH CHECK` | 읽기+결과 유효 | `updateMany({ where:{ id, organizationId: orgId } })` + `count` 확인 (Day10 방식) |
| `DELETE USING (assignee=uid)` | 삭제 자격 | `deleteMany({ where:{ id, organizationId: orgId } })` |

> 교재의 **USING = 읽기 where 스코핑**, **WITH CHECK = 쓰기 시 org 서버 주입/검증**. (A-04-O2 §4와 동일 결론.)

### 🔍 [Day11 재검토 제안 — 실행백로그 등록] Prisma Client Extension 자동 주입

앱레벨 스코핑의 치명적 약점: **개발자가 `where`를 한 번만 빼먹어도 유출.** 교재 RLS는 DB가 강제해서 못 빼먹지만, 앱레벨은 사람이 실수 가능. → **Prisma Client Extension(`$extends`)으로 org 모델 쿼리에 `where:{organizationId}`를 자동 주입**하면 RLS에 준하는 강제력. Day04 §5 각주 → 오늘 정식 제안. 고위험(전체 쿼리 경로 영향)이라 **설계 확정 후 신중 반영**(BL-Day11-03).

---

## 3. 단계④ — 프로필 자동 생성 (Clerk 웹훅 치환)

교재: `auth.users` INSERT → `SECURITY DEFINER` 트리거로 `profiles` 행 1개 자동 생성.
Findable: **Clerk 웹훅**(`user.created`·`organization.created`) → Neon `User`·`Organization` 행 동기화.

| 교재 | Findable |
|---|---|
| DB 트리거 `handle_new_user()` | Clerk 웹훅 핸들러 `app/api/webhooks/clerk/route.ts` [확인필요 존재여부] |
| `SECURITY DEFINER`(강한 권한, 행 1개만) | 웹훅은 **행 동기화만**(고객 데이터 조회·관리자 작업 금지 — 동일 원칙) |
| `role` 컬럼 두되 변경 UI 없음(권한 상승 방지) | Clerk org role(admin/member) — **role 변경은 Clerk이 관리, 앱 자체 UI 안 만듦** |
| profiles RLS(본인만 조회/수정) | User 조회도 `where:{organizationId}` 스코핑 |

> **[확인필요]**: Clerk 웹훅 핸들러 실존 여부 → 실행백로그 BL-Day11-02. next-forge 기본 포함 여부 확인.

---

## 4. 오늘 산출 요약 (A-11-O1)

- **재검증**: Clerk 인증 6파일 이미 완비. 교재의 "Auth 새로 붙이기"는 Findable에선 **재확인**으로 대체.
- **핵심 확정**: RLS 부재 → 앱레벨 org 스코핑이 유일 격리선. `requireOrg`·`scopedBrands`·**`scopedTracking`(brand 경유)** 헬퍼 설계 확정.
- **실측 발견**: org 키 보유 3/9 모델. Tracking·Prompt·AuditJob·Lead는 경유·email·서버전용으로 격리 → Day04 §5 예측 그대로 확인.
- **미확정→백로그**: 미들웨어 실동작 확인(BL-Day11-01), Clerk 웹훅 존재 확인(BL-Day11-02), Prisma Extension 자동주입(BL-Day11-03, 🟡고위험).
- **service key**: Clerk secret·DATABASE_URL은 서버 전용. 클라 노출 절대 금지(교재 service_role 금지와 동일). ✅ `.env.local` git 제외.
