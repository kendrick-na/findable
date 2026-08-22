# A-10-O1 · A-10-O2 — Slice 2 구현 노트 + 오류 메시지 가이드

> Findable · Day10 · 2026-07-17 · **Track A (기존 코드 있음 — www.findable.co.kr 라이브)**
> 커리큘럼 TaskFlow(담당자 배정, Supabase) → Findable(브랜드 담당자 배정, Clerk+Neon+Prisma) 치환.
> ⚠️ 스택 치환 규칙(Day03·04 확립): `auth.uid()` → Clerk `auth().userId/orgId` · Supabase RLS → **앱레벨 `where:{organizationId}` 스코핑**(Findable은 Postgres RLS 없음, 앱레벨이 유일 방어).

---

## 1. Slice 2 선택

### 후보 3개 · 5기준 채점 (1~5점)

Slice 1 = **Brand 등록**(A-07-O1, BL-003)이었다. Slice 2는 그 위에 얹는 "가장 작은 DB 변경 1번"으로 고른다. Slice 1이 "제품이 살아 있는지"를 보였다면, Slice 2는 "왜 필요한지(조직 협업·격리)"를 보인다.

| 후보 | 백로그 근거 | ①제품가치(차별점) | ②산출물연결 | ③오늘구현 | ④오류설계가치 | ⑤Day11연결 | 합계 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **① 브랜드 담당자(멤버) 배정** | BL-003 확장·BL-007(org격리) | 3 | 4 | **5** | **5** | **5** | **22** ✅ |
| ② 브랜드 프롬프트 등록 | BL-004 선행 | 4 | 3 | 3 | 3 | 3 | 16 |
| ③ 7엔진 SoV 1회 측정 | BL-004 | 5 | 3 | 2 | 3 | 4 | 17 |

- **①이 왜 가장 작은가**: 기존 `Brand` 행에 담당자 필드를 **UPDATE 1번** 하는 것. 새 엔티티·외부 API·AI 호출 없음. 교재 TaskFlow "담당자 배정"과 구조 100% 동일 → 오류 6유형·A/B 격리 검증 재료를 그대로 대입 가능.
- **②는** 새 `Prompt` 엔티티 흐름이라 오늘 범위엔 큼. **③은** 외부 AI(HyperCLOVA/렛서) 인증·응답 의존이라 "가장 작게 오늘 동작"에 부적합(더미로만 가능).

### 선택 결정 — ① 브랜드 담당자 배정

| 항목 | 내용 |
|---|---|
| **Slice 2 이름 (사용자 행동)** | "로그인한 사용자가 내 조직의 브랜드에 담당자(멤버 id)를 배정하면, 브랜드 목록에 담당자가 표시된다" |
| **선택 이유 (한 문장)** | org 격리(BL-007) 하나만 있으면 되는 **UPDATE 1번짜리 Must 기능**이라 오늘 안에 오류 6유형·계정 A/B 격리 검증까지 마칠 수 있고, Day11(멤버/역할 모델)로 그대로 이어진다. |
| **연결 항목 (2개 이상)** | ① **PRD Must** #4 SoV 대시보드(브랜드 운영의 기본 속성) · ② **백로그 BL-007**(같은 org 멤버만 조회·격리) + **BL-003**(브랜드 등록의 후속) · ③ **A-09-O2 MCP** org-scoping-checker(이 배정이 org 스코핑을 안 뚫는지 검증 대상) |
| **정상 흐름 (1줄)** | 로그인 → 내 org 브랜드 선택 → 담당자(본인 userId) 선택·제출 → `Brand.assigneeUserId` UPDATE → 목록에 담당자 표시 |

> ⚠️ **오늘은 단순 모델**: 팀·역할(leader만 배정·team_id 격리)은 Findable에 `Member`/`role` 모델이 아직 없으므로 **Day11 범위**. 오늘은 org 스코핑 + 상태 규칙만으로 오류 처리 골격을 잡는다. 배정 대상 목록은 "검증 가능한 현재 사용자(본인)"만 옵션으로 넘긴다(없는 멤버 테이블 지어내지 않음).

---

## 2. 오류 메시지 가이드 (A-10-O2) — 코드보다 먼저

> 이 표가 곧 구현 명세다. 화면 메시지엔 stack trace·SQL·키 **절대 금지**(무슨 일 + 어떻게 + 안내만). 개발자 로그엔 `XXX-숫자` 오류 코드 **필수**. 두 채널 분리(그림 2).

**대상 기능: `assignBrandOwner` Server Action** (브랜드 담당자 배정, 단순 모델)

| 오류 유형 | 상황 | 사용자 메시지(한국어) | 개발자 로그 | 재시도 |
|---|---|---|---|---|
| **인증** | 비로그인/미활성 org로 배정 시도 | 로그인이 필요합니다. 다시 로그인해 주세요. | `AUTH-401 op=assignBrandOwner userId=null` | 재로그인 후 1회 |
| **org 인가** | 다른 조직의 브랜드 id로 배정 시도 (앱레벨 스코핑이 유일 방어) | 이 브랜드에 접근할 권한이 없습니다. | `AUTH-403 op=assignBrandOwner orgId=... brandOrg=...` | 없음(차단) |
| **대상 없음** | 삭제됐거나 내 org에 없는 brandId | 해당 브랜드를 찾을 수 없습니다. 목록을 새로고침해 주세요. | `BRAND-404 brandId=...` | 목록 새로고침 |
| **비즈니스 규칙** | 보관(archived) 상태 브랜드에 배정 시도 | 보관된 브랜드는 담당자를 바꿀 수 없습니다. | `RULE-409 status=archived brandId=...` | 보관 해제 후 |
| **입력** | 존재하지 않는/형식 위반 assigneeUserId | 선택한 담당자를 찾을 수 없습니다. 다시 선택해 주세요. | `INPUT-422 field=assigneeUserId` | 재선택 후 |
| **내부(DB)** | Prisma update 실패(Neon 커넥션·제약 위반 등) | 일시적인 오류로 저장하지 못했습니다. 잠시 후 다시 시도해 주세요. | `BRAND-ASSIGN-500 op=assignBrandOwner brandId=... dbError=...(로그에만)` | 최대 1~2회 |

> **점검 완료**: 사용자 메시지 6칸 어디에도 `Error: 500`·`Forbidden`·SQL·키 없음. 로그 6칸 전부 `XXX-숫자` 형태 코드 있음. `dbError` 원문은 **개발자 로그에만**(사용자 화면 X).
>
> **치환 주의**: 교재의 `AUTH-403 role=member`(역할 기반)는 Findable에 역할 모델이 없어 **`AUTH-403 org 불일치`**(조직 격리)로 대체했다. 역할 기반(leader만) 403은 Day11에서 추가.

---

## 3. Slice 2 최소 구현 (A-10-O1)

### 오류 처리 흐름 (단순 모델 — 오늘 범위)

```
브랜드 담당자 배정 요청
  ① 인증(Clerk auth)      실패 → AUTH-401
  ② 브랜드 조회(org 스코핑) null → BRAND-404  ← where:{id, organizationId:orgId} 로 "없음/타org"를 한 번에
  ③ 비즈니스 규칙          archived → RULE-409
  ④ 입력 검증              assignee 형식 위반 → INPUT-422
  ⑤ Prisma UPDATE          error → BRAND-ASSIGN-500 / 0행 → BRAND-404(거짓성공 방지)
  ✓ 성공 → revalidatePath('/brands') → 목록에 담당자 표시
```
> 교재 그림3의 ②역할(AUTH-403 role)·⑤팀 경계(team_id) 분기는 **Day11**에서 추가. 오늘은 org 스코핑이 그 자리를 대신한다(where 조건에 organizationId 포함 = "내 org 아니면 0건"으로 404 처리).

### 구현 설계 (파일 — Findable next-forge 치환, Slice1 A-07-O1 패턴 계승)

**① `apps/app/features/brand/actions.ts` 에 `assignBrandOwner(prevState, formData)` 추가**
```ts
'use server'
// React useActionState용: throw 대신 항상 { ok, code, message } 반환
export async function assignBrandOwner(prev, formData) {
  const { userId, orgId } = await auth()          // packages/auth (Clerk)
  if (!userId || !orgId)                            // ① 인증
    return { ok:false, code:'AUTH-401', message:'로그인이 필요합니다.' }

  const brandId = String(formData.get('brandId'))
  const assigneeUserId = String(formData.get('assigneeUserId'))

  // ② org 스코핑 조회 — 내 org 아니면 애초에 null (RLS 등가 방어)
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, organizationId: orgId },  // ★ organizationId 강제
    select: { id:true, status:true },
  })
  if (!brand) return { ok:false, code:'BRAND-404', message:'해당 브랜드를 찾을 수 없습니다.' }

  if (brand.status === 'archived')                  // ③ 비즈니스 규칙
    return { ok:false, code:'RULE-409', message:'보관된 브랜드는 담당자를 바꿀 수 없습니다.' }

  if (!assigneeUserId || assigneeUserId.length < 3) // ④ 입력 검증
    return { ok:false, code:'INPUT-422', message:'선택한 담당자를 찾을 수 없습니다. 다시 선택해 주세요.' }

  try {
    // ⑤ UPDATE — where에도 organizationId 재확인(이중 방어), updateMany로 변경 행 수 확인
    const res = await prisma.brand.updateMany({
      where: { id: brand.id, organizationId: orgId },
      data:  { assigneeUserId },
    })
    if (res.count === 0)                             // 0행 = 스코핑 차단/사라짐 → 거짓 성공 방지
      return { ok:false, code:'BRAND-404', message:'해당 브랜드를 찾을 수 없습니다.' }
  } catch (dbError) {
    log.error('BRAND-ASSIGN-500', { op:'assignBrandOwner', brandId:brand.id, dbError }) // observability, console.log 금지
    return { ok:false, code:'BRAND-ASSIGN-500', message:'일시적인 오류로 저장하지 못했습니다.' }
  }
  revalidatePath('/brands')
  return { ok:true, code:'OK', message:'담당자를 배정했습니다.' }
}
// 팀·역할(leader만·team_id 격리)은 Day11에서 분기 추가
```
치환 포인트: 교재 `supabase.from('tasks').update({assignee}).eq('id',id)` + `.select().maybeSingle()` (0행 확인)
→ Findable `prisma.brand.updateMany({where:{id, organizationId:orgId}})` + `res.count===0` 확인. Prisma엔 `maybeSingle`이 없어 **`updateMany`의 `count`로 "실제 바뀐 행"을 확인**(교재의 0행 거짓성공 방지와 동일 목적).

**② `apps/app/features/brand/components/AssignOwnerForm.tsx` (Client)**
```ts
'use client'
const [state, formAction] = useActionState(assignBrandOwner, { ok:false, code:'', message:'' })
// <form action={formAction}>: hidden brandId, select assigneeUserId(=본인만), 제출 버튼
// {state.message && <p role="status">{state.message}</p>}  ← 성공·실패 모두 인라인 표시(흰 화면 방지)
```
배정 대상 `members` prop = **현재 사용자(본인) 1명만**(단순 모델). 팀원 목록은 Day11.

**③ 목록 조회 보강** — `queries.ts`의 `findMany`에 `assigneeUserId` select 추가, 각 행에 담당자 표시(본인 id면 "나", 비었으면 "미배정"). → 저장 여부를 눈으로 검증.

**④ `apps/app/.../brands/error.tsx`** — Server Action이 잡은 6유형 외 예상 못한 예외 fallback("문제가 발생했어요 / 다시 시도").

### ⚠️ 실코드 반영 판단 (CLAUDE.md §7.4)

- **오늘은 설계·명세 확정 + 오류 가이드까지가 전원 필수 산출물.** 실제 `apps/app` 코드 커밋은 별도 결정:
  - Findable엔 `Brand` 모델은 있으나 **`assigneeUserId` 컬럼이 없음**([확인필요] → 있으면 그대로, 없으면 Prisma migration 필요 = 실배포 DB 스키마 변경이라 신중).
  - `features/brand/actions.ts`(Slice1에서 계획) 실파일 존재 여부 [확인필요].
- **저위험**(신규 actions.ts에 함수 추가·폼 컴포넌트 신규)은 반영 가능. **고위험**(라이브 Neon DB에 컬럼 추가 migration)은 실행백로그 등록 후 신중.
- 실행백로그에 **BL-Day10-01(assignBrandOwner Server Action)** · **BL-Day10-02(Brand.assigneeUserId 컬럼 migration — 실DB, 보류)** 등록.
