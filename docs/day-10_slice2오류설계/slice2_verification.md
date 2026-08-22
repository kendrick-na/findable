# A-10-O3 — Slice 2 검증 기록

> Findable · Day10 단계4 · 2026-07-17 · Track A
> 대상: `assignBrandOwner`(브랜드 담당자 배정). RLS 등가 = 앱레벨 `where:{organizationId}` 스코핑.
> ⚠️ **오늘 상태**: 오류 가이드(A-10-O2)·구현 명세(A-10-O1)까지 확정. 실코드는 라이브 Neon DB 컬럼 이슈로 **반영 보류**(§7.4) → 아래는 **기대 결과 + 미실행 표기**. 실행 시 "실제 결과·증거"를 채운다. (교재 규칙: 추측으로 통과/실패 채우지 않음.)

## 검증 케이스 표

| 케이스 | 해 본 것 | 기대 결과 | 실제 결과 | 증거 |
|---|---|---|---|---|
| **정상** | 로그인 → 내 org 브랜드에 본인 담당자 배정 | "담당자를 배정했습니다" + 목록에 담당자("나") 표시 | 미실행 | — |
| **비로그인** | 로그아웃 후 배정 시도 | `AUTH-401` 한국어 메시지, 재로그인 유도, 흰 화면 없음 | 미실행 | — |
| **비즈니스 규칙** | `status=archived` 브랜드에 배정 | `RULE-409` "보관된 브랜드는 담당자를 바꿀 수 없습니다." | 미실행 | — |
| **대상 없음** | 없는/타 org brandId로 직접 요청 | `BRAND-404` "해당 브랜드를 찾을 수 없습니다." | 미실행 | — |
| **입력** | 형식 위반 assigneeUserId | `INPUT-422` "다시 선택해 주세요." | 미실행 | — |
| **org 인가 (RLS 등가 A/B)** | orgA 브랜드를 orgB 계정으로 로그인해 조회·배정 시도 | orgA 브랜드가 orgB에 **0건**(목록에 안 보임) / 배정 시 `BRAND-404`(스코핑상 null) | 미실행 | — |
| **역할 권한** | member 계정으로 배정 시도 | (Day11 범위 — 역할 모델 없음) | **미실행(Day11)** | — |
| **캡처 안전** | 화면·로그 검토 | 화면/로그에 API 키·SQL·실고객 데이터 없음 | 미실행 | — |

## RLS(=org 스코핑) A/B 격리 — 설계상 보장 근거

Findable은 Postgres RLS가 **없다**. 유일 방어선 = 모든 Prisma 쿼리의 `where:{organizationId: orgId}` (BL-007·BL-011).

- **조회**: `findFirst({ where:{ id, organizationId: orgId } })` → orgB가 orgA 브랜드 id를 넣어도 `organizationId` 불일치로 **null** → `BRAND-404`. (교재의 "RLS가 막으면 SELECT 0건" + maybeSingle null → 404 처리와 등가.)
- **수정**: `updateMany({ where:{ id, organizationId: orgId } })` → `count===0`이면 거짓 성공 방지로 `BRAND-404`. org 필터가 where에 이중으로 들어가 **타 org 행은 애초에 대상에서 제외**.
- **실행 검증 방법**(반영 시): Clerk 테스트 조직 2개(orgA·orgB) 생성 → 각각 로그인 → orgA에서 만든 브랜드 id를 orgB 세션에서 배정 시도 → `BRAND-404` 및 orgB 목록에 orgA 브랜드 0건 확인.

## 실행 전제 (코드 반영 시)

1. `Brand.assigneeUserId` 컬럼 존재 확인 → 없으면 Prisma migration(실 Neon DB, 신중).
2. `apps/app/features/brand/actions.ts`에 `assignBrandOwner` 추가 + `AssignOwnerForm.tsx` + `queries.ts` assignee select.
3. `pnpm dev` (또는 turbo dev, app 워크스페이스) → 위 8케이스 실행 → 이 표의 "실제 결과·증거" 채움.
