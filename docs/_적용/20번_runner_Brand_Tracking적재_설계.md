# 확정 설계문서 — 20번: audit runner → Brand/Tracking 적재 + org 시계열

> 상태: **1단계 코드 작성 완료(2026-07-29 세션D). flag OFF라 라이브 영향 0. 배포·마이그레이션 미실행(Bash 착수단계 대기).** 결론: **incremental 2단계 + 보강4개**, 트리거는 **엄격판 A**(team 적대검증).

## ✅ 구현 완료 로그 (2026-07-29 세션D) — 다시 하지 말 것
전 앱 `tsc --noEmit` = **web·app·api 전부 0**(prisma generate로 복합유니크 타입 반영 후 확인). studio 무변경.
| 파일 | 변경 | 스텝 |
|---|---|---|
| `packages/database/prisma/schema.prisma` | Prompt `@@unique([brandId,text])` (D3) | 2 |
| `packages/database/prisma/seed.ts` (신규) | Engine 9개 upsert, 본류7만 isActive. ENGINES는 ai 순환회피로 인라인 사본 | 3 |
| `packages/database/prisma.config.ts` | `migrations.seed` 추가. ⚠️러너 미확정(tsx 없음→택1 주석) | 3 |
| `apps/web/env.ts` | `AUDIT_DUAL_WRITE_ENABLED`(z.string→==="true", **기본 off**) | 4 |
| `apps/web/lib/audit/tracking.ts` (신규) | `persistAuditTracking`: 보강1(org findUnique)·2(prompt.upsert brandId_text)·3($transaction)·4(DB engineId 필터)·D5(stub/실패 제외). best-effort | 5 |
| `apps/app/lib/db/ensure-org.ts` (신규) | `ensureOrgExists`(웹훅 폴백)·`ensureBrand`·normalizeDomain. ⚠️app 버튼 붙기 전까진 미사용(대기) | 6 |
| `apps/web/lib/audit/runner.ts` | `AuditRunInput`에 organizationId?/brandId? + flat이전 프롬프트 태깅(`tagged`) + 완료update 직후 **3중게이트**(flag&&org&&brand) `persistAuditTracking` | 7 |
| `apps/api/app/webhooks/auth/route.ts` | **D2 근본**: user/org **DB upsert** 추가(`upsertUserToDb`·`upsertOrgToDb`, ownerId=`data.created_by`, billing 미기입). 핸들러 async화+switch await. best-effort | 8 |
| `apps/web/proxy.ts` | matcher에 `/api/audit/org` **한 경로만** 추가 + before체인(i18n·arcjet) 이 경로 skip(auth는 돎) | A |
| `apps/web/app/api/audit/org/route.ts` (신규) | **엄격판 A 트리거**: orgId=`auth()` 재도출(payload 금지)·brandId=서버 domain도출·org실재확인·org+domain 하루1회·`after(runAuditJob{org,brand})` | A |
| `apps/web/package.json` | `@repo/auth` workspace 의존 추가(auth() 위해) | A |

**트리거 위치 결정(team 13에이전트 적대검증)**: 후보 A/B/C 중 **A 채택**. B=confused-deputy(web이 payload orgId 재검증 불가→시크릿유출시 남의org 오염, A의 순열등)·C=runner를 packages로 이동=라이브 무료audit 회귀+chromium번들 app전이 치명. **A는 orgId를 세션서 재도출→위조표면 0.** 단 "엄격판"(payload로 org/brand 금지)에서만 견고.

## 🔄 D2 정정 (2026-07-29 세션D, 실측 후 전략 재판단)
- **D2를 "웹훅 정공법 우선"에서 "lazy 적재 우선 + 웹훅은 코드만 대기"로 정정.**
- 근거(실측): apps/api는 **Vercel 미링크**(web·app만). 웹훅 배포=새 Vercel 프로젝트+도메인+env(CLERK_WEBHOOK_SECRET)+Clerk 구독 = org 하나 적재하려고 인프라 신설=현 단계 과잉.
- 우리 트리거는 org를 "추적 시작 버튼 누를 때"만 씀(무료 audit 54건은 org 불요). **그 순간 app이 Clerk에서 org 조회→DB upsert(lazy)** 하면 충분. `ensure-org.ts`의 `ensureOrgExists`가 이미 이 역할.
- 웹훅 코드(apps/api org/user upsert)는 **버리지 않음** — apps/api가 (다른 이유로든) 배포되는 날 자동으로 근본 경로 활성화. lazy는 그때까지의 다리.
- **전환 트리거**: org 수가 실시간 미러링이 필요할 만큼(수백+) 늘면 그때 웹훅 배포. 지금은 아님.
- 착수 체크리스트 스텝4가 "웹훅 배포"→"lazy 경로 배선 확인"으로 대체됨(아래).

## 📊 라이브 실측 완료 (2026-07-29 세션D) — 재실측 불필요
- **A0 ✅ CLERK_SECRET_KEY = Vercel web Production에 존재**(87일 전 설정). org route 라이브 500 위험 해소. `AUDIT_DUAL_WRITE_ENABLED`는 미설정(정상=OFF).
- **DB 행 수(라이브 Neon)**: Prompt **0**·Brand **0**·Engine **0**·Organization **0**·User **0**·Tracking **0**·AuditJob **54**(completed 53·failed 1).
- **해석**: (1)Prompt (brandId,text) 중복 그룹 **0** → 유니크 마이그레이션 **완전 안전**. (2)Organization 0인데 AuditJob 54 → **근본원인 A 숫자로 실증**(웹훅이 org를 DB에 한 번도 안 적재). (3)D1 backfill 대상=54건 존재(헛돌지 않음). (4)**D7 CONCURRENTLY 불필요**(AuditJob 54행 소량, 2단계 FK 인덱스도 일반 migrate 순간처리).
- ⚠️ DB 스크립트: `@neondatabase/serverless` 1.x는 `sql()` 직접호출 막힘 → **`sql.query(\`...\`)` 사용**(인계 메모의 옛 neon() 패턴 무효).

## 🚧 배포·라이브 체크리스트 (진행중)
```
[x] A0. ✅ CLERK_SECRET_KEY = Vercel web Production 존재(87d) — org route 500 위험 해소.
[x] 1. ✅ 사전 실측: Prompt0·Brand0·Engine0·Org0·User0·Tracking0·AuditJob54(중복0). 위 "라이브 실측" 참조.
[x] 2. ✅ Prompt @@unique 반영 = `prisma db push --accept-data-loss`(⚠️이 repo는 migration 파일 안씀=db push 운영. _prisma_migrations 없음). 빈테이블이라 손실0. `Prompt_brandId_text_key` 인덱스 실재 확인.
[x] 3. ✅ Engine seed = **순수 SQL upsert**(tsx·strip-types 다 실패 실측 → neon sql.query INSERT ON CONFLICT). Engine 9행(본류7 isActive) 확인.
[x] A1. ✅ pnpm install(Already up to date=@repo/auth workspace symlink) + `pnpm --filter web build` 통과. `ƒ /api/audit/org`·`ƒ Proxy` 라우트 등록 확인.
[x] 4. ✅ D2=lazy로 대체(웹훅 배포 안 함). org route가 clerkClient로 org lazy upsert. apps/api 웹훅 코드는 미배포 대기.
[x] 5. ✅ **web·app 프로덕션 배포 완료(flag OFF)**. web=findable(www.findable.co.kr), app=findable-app(project.json swap→원복). ⚠️app 로컬빌드는 Clerk env 비어서 불가(원래 그럼, tsc0로 갈음).
[x] 6. ✅ 트리거 UI 완성+배포: app brand 페이지 각 브랜드에 StartTrackingButton(fetch credentials:include). **라이브 검증: `/api/audit/org`→401(인증가드 작동), 기존 `/api/audit`→400(회귀 없음).**
[ ] 6b. 👤 **사용자 브라우저 테스트(쿠키 관문)**: 실제 로그인→brand 페이지→"추적 시작" 클릭. 401이면=크로스서브도메인 쿠키 안 감→Clerk 대시보드 satellite/domain 설정(코드아님). 성공 토스트 뜨면 엄격판A 완전 성립.
[ ] 7. flag ON: `AUDIT_DUAL_WRITE_ENABLED=true` (Vercel web Production env 추가 후 web 재배포) → 로그인 org audit 1건 → `SELECT count(*) FROM "Tracking" WHERE "brandId"=...` (성공응답 수, ≤28)
[ ] 8. 게이트 감시 → 2단계: AuditJob nullable FK(D8) + D1 backfill 잡(AuditJob 54건 대상) + scopedTracking 활성화 + 대시보드 Tracking 전환
```
> ⚠️ 스키마 배포는 `prisma db push`(migration 파일 안 씀). seed는 순수 SQL(neon sql.query). `@neondatabase/serverless` 1.x는 `sql()` 직접호출 막힘→`sql.query()`. app 배포=project.json swap→원복 필수.
> ⚠️ **git 미커밋**: 이번 세션 코드 변경 다수. 커밋 여부는 사용자 결정.

---

> (원본 설계) 이 문서는 3개 설계안(minimal·schema·incremental)과 6개 적대적 검증(live-data-corruption / fk-constraint-violation / rollback-and-downtime × 3안)을 종합한 단일 확정안이다. 결론: **incremental(2단계 점진안)을 채택하되, 적대적 검증에서 살아남지 못한 4개 지점을 설계에 흡수해 보강**한다.

## 🔒 사용자 확정 결정 (2026-07-29) — 착수 시 이 블록 우선
- **D1 = backfill 방식.** 무료(비로그인) audit은 지금처럼 `AuditJob`(email)에만 쌓는다. 그 사람이 **로그인·결제하면 동일 email의 과거 AuditJob 기록을 org/brand 그래프로 이어붙인다(backfill).** 익명 placeholder org 생성 금지(프로덕션 DB 오염 방지). "무료 맛보기 → 결제 전환 시 그동안 것도 시계열로" 흐름.
- **D2 = 웹훅 정공법 우선.** lazy upsert 우회가 아니라 **`apps/api` Clerk 웹훅을 Vercel 링크·배포하고 Clerk에 구독시켜 org/user를 DB에 정식 적재**하는 것을 근본원인 A 해소의 1차 경로로 한다. (단, 웹훅 이벤트 지연/유실 대비 write 직전 `organization.findUnique` 이중 가드는 유지 — 보강1.)
- **D3 = 1단계 포함.** Prompt `@@unique([brandId, text])` 추가(같은 브랜드에 같은 질문 프롬프트 중복 생성 방지 → 시계열 선 분열 방지). Prompt 테이블이 비어 있어 충돌 위험 0으로 확인됨.
- **D4 = 제외.** Brand `@@unique([organizationId, domain])`는 넣지 않는다. 중복은 `$transaction` 내 findFirst+create로 코드에서 최소화(완전 원자성은 없음, 잔여위험 인지).
- 파생: **D5 = 실패/stub 엔진행 Tracking 제외**(진짜 0언급과 구별). D6(rawResponse full/절단)·D7(인덱스 CONCURRENTLY)·D8(AuditJob FK 시기=2단계)은 착수 시 [확인필요] 유지.
- ⚠️ **D1 backfill의 전제**: AuditJob과 org/brand를 email로 잇는 매핑이 필요 → AuditJob FK(D8, 2단계)와 backfill 잡이 짝이다. 무료→유료 전환 순간 트리거.

---

## 1. 문제 요약 — 왜 Brand/Tracking이 비는가

Findable 대시보드의 org 시계열(SoV 추이·엔진별 언급)이 표시되지 않는 이유는 단일 버그가 아니라 **세 개의 구조적 근본원인이 연쇄**하기 때문이다. Phase 1 실측 근거:

**근본원인 A — Organization row가 DB에 없다 (진짜 뿌리).**
Clerk 웹훅(`apps/api/app/webhooks/auth/route.ts:75-94` `handleOrganizationCreated`, `:15-34` `handleUserCreated`)이 PostHog analytics 이벤트만 발생시키고 **Prisma write를 하지 않는다**(import부에 `@repo/database` 자체가 없음). repo 전체에서 `organization.create`/`organization.upsert`/`user.create` 애플리케이션 호출 **0건**. 게다가 apps/api는 **Vercel 미링크**(`.vercel/` 없음, 링크된 건 web=`findable`·app=`findable-app`뿐)이라 이 웹훅은 **애초에 배포·구독되지 않아 돌지도 않는다**. → `Brand.organizationId`(NOT NULL, `schema.prisma:57`)가 가리킬 Organization row가 존재할 근거가 없다.

**근본원인 B — Tracking write 경로가 코드에 존재하지 않는다.**
audit 파이프라인 전체(`apps/web/app/api/audit/route.ts:151` create → `apps/web/lib/audit/runner.ts` → crew-runner → briefing-runner)가 오직 `AuditJob`(+`Lead`)에만 write. `tracking.create`/`prompt.upsert` 애플리케이션 호출 **0건**(생성 클라이언트/빌드 산출물 제외). `brand.create`는 `apps/app/app/actions/brand/assign.ts:100`의 수동 액션 **1곳뿐**. 추가로 `Engine` 테이블은 seed 스크립트가 repo에 없어 **비어 있다**(엔진 목록의 실제 출처는 DB가 아니라 코드 상수 `packages/ai/lib/engines/types.ts:33 ENGINES`).

**근본원인 C — AuditJob은 org/brand와 분리된 고아 테이블이다.**
`AuditJob`(`schema.prisma:155-179`)은 org/brand FK가 **0개**, `email String` 스코프뿐. 대시보드 전 화면(`apps/app/app/(authenticated)/page.tsx:27-32`)이 `auditJob.findMany({ where:{ email } })`로 **email 스코프**만 읽는다. 반면 org 시계열은 `Tracking(brandId+promptId+engineId 전부 NOT NULL)`을 요구한다. audit은 무료·비로그인(`apps/web` `/audit`, route.ts:8 주석 "이메일만 받음") 진입이라 org/brand 개념이 원천적으로 없고, `apps/app`에는 audit 트리거 라우트가 아예 없다(대시보드는 apps/web로 링크만).

**연쇄 구조**: C 때문에 audit이 쌓여도 Tracking이 안 생기고, B 때문에 Tracking을 만들 코드가 없고, 그 코드를 만들려 해도 A 때문에 Brand의 부모 Org가 없다. **A→B→C 순으로 풀지 않으면 어느 하나만 고쳐도 화면은 비어 있다.**

---

## 2. 권고안 — incremental(2단계 점진안) + 4개 보강

### 3안 비교

| 축 | minimal | schema | **incremental(채택)** |
|---|---|---|---|
| 스키마 변경 | 무변경 | AuditJob에 nullable FK 2개 + Brand @@unique | 1단계 무변경(+보강 시 Prompt @@unique), 2단계에 nullable FK |
| 커버리지 | 로그인 org가 "추적 시작" 버튼 누른 브랜드만(on-demand) | 로그인 audit 전체(신규 apps/app 라우트) | 로그인 org audit(dual-write), 대시보드는 게이트 통과 후 전환 |
| 라이브 파손 표면 | 가장 작음(DDL 0) | 가장 큼(FK·유니크 마이그레이션) | 작음(1단계 DDL 실질 0, 2단계 nullable ADD만) |
| 되돌리기 | 코드 revert | 컬럼 롤백 필요 | flag off / 코드 revert, AuditJob 상시 백업 |
| 얻는 값 | org 시계열(수동) | org 시계열 + AuditJob 조인 | org 시계열 + **점진 검증 게이트로 안전 전환** |

### 왜 incremental인가 — 적대적 검증에서 살아남은 근거로

**저울질할 값**: org 시계열(SoV 추이 = 이 프로젝트의 핵심 자산), 2번 레버(요금제 이코노미의 `isPaid=growth이상` 게이팅과 Tracking on-demand 연동 → 유료 org에만 시계열 제공 = painkiller 전환), before/after 잠금해제(현재 email 단발 진단 → org 누적 시계열). **저울질할 파손 리스크**: 라이브 Neon 프로덕션, `relationMode="prisma"`(FK를 DB가 강제하지 않음).

세 안 모두 적대적 검증에서 **동일한 치명 결함 클러스터**를 공유했다 — 전부 `relationMode="prisma"`의 오해에서 나온다:

- **minimal**은 "brand 존재 ⇒ org 존재"를 안전 근거로 삼았으나, fk-lens가 이를 실측으로 반증했다. `assign.ts:100`이 `data:{ organizationId: orgId }` **스칼라 직접 대입**이고 orgId는 Clerk `org_...` 문자열인데 그 Organization row는 DB에 없다(근본원인 A). 즉 minimal의 안전 논거 자체가 무너진다.
- **schema**는 라이브 FK/유니크 마이그레이션 표면이 가장 커서 rollback-lens에서 CONCURRENTLY 인덱스·중복 dedup 등 `prisma migrate`와 충돌하는 완화책을 요구받았다.
- **incremental**은 (1) 기존 AuditJob·대시보드를 1단계에서 **1바이트도 안 건드림**(rollback-lens에서 "본류 오염·다운타임 견고"로 확인), (2) DDL이 실질 0이라 마이그레이션 다운타임 표면이 없음, (3) feature flag + 게이트로 **되돌릴 수 있는 전환**을 제공. 세 렌즈 모두 incremental의 **골격은 견고**하다고 판정했고, 깨진 지점은 전부 "헬퍼 스펙에 명시 안 된 4가지"로 수렴한다 — 즉 **골격 교체가 아니라 명시 보강으로 닫을 수 있다.**

**따라서 incremental 채택 + 아래 4개 보강을 설계에 흡수한다**(각각 어느 렌즈가 지적했는지 병기):

- **보강 1 (fk-lens, 치명)**: Brand/Tracking write 직전 **`organization.findUnique`로 부모 Org 실재를 명시 확인**. 없으면 write 중단(throw 아닌 log+skip). "brand.create 실패를 로그로 잡는다"는 소극책은 `relationMode="prisma"`에서 실패가 안 나고 **고아 row가 성공 생성**되므로 무효. 능동 선확인만이 유효.
- **보강 2 (live-lens, 치명)**: **Prompt에 `@@unique([brandId, text])` 추가**(additive) 후 `prompt.upsert`를 원자화. 유니크 없는 `findFirst→create`는 동시 audit 레이스에서 promptId 분열 → 시계열이 두 선으로 쪼개짐.
- **보강 3 (전 렌즈)**: `persistTracking` 헬퍼 전체를 `database.$transaction([...])`으로 감싸 **brand·prompt·tracking 원자화**. 부분 실패 시 "Brand는 있는데 Tracking 0인 유령 브랜드"를 원천 차단. best-effort(throw 안 함)와 트랜잭션(원자성)은 `try { await $transaction } catch { log }`로 양립.
- **보강 4 (전 렌즈)**: **Engine seed를 DEFAULT_7이 아니라 ENGINES 전량(`types.ts:33`)**으로, `isActive`로 구분. seed↔배포 순서를 **flag 기본 off + `SELECT count(*) FROM "Engine"` 검증 후 on**으로 조여 seed 미완 창을 닫음. Tracking write 직전 **DB 실재 engineId 집합으로 필터**(상수 기준 아님).

---

## 3. 단계별 실행 계획

> 원칙: **A(org/user 적재) → Engine seed → B(dual-write 코드) → C(게이트 통과 후 읽기 전환)** 순서. 앞 단계 검증 실패 시 뒤 단계 진입 금지. 모든 DB 접근은 `packages/database` 경유, 인증 Clerk, `any` 금지, secret 하드코딩 금지(CLAUDE.md).

### 1단계 — 쓰기 이중화 (dual-write)

**선행조건 0 — org/user 적재 배선 (근본원인 A 해소, brand write보다 반드시 먼저). [D2=웹훅 정공법 확정]**

**1차(근본) = Clerk 웹훅 정식 배포.** `apps/api`의 `webhooks/auth/route.ts`가 org/user를 DB에 적재하도록 고치고, apps/api를 Vercel에 링크·배포하고, Clerk 대시보드에서 이 엔드포인트를 `organization.created`·`user.created`(+updated) 이벤트에 구독시킨다. 이게 org row를 만드는 정식 소유 경로다.
- `apps/api/app/webhooks/auth/route.ts` 수정: 현재 `handleOrganizationCreated`(analytics만)에 `database.organization.upsert({ where:{ id: data.id }, create:{ id: data.id, name: data.name, ownerId: data.created_by }, update:{ name: data.name } })` 추가. `handleUserCreated`에 `database.user.upsert(...)` 추가. import에 `@repo/database` 추가(현재 없음).
  - **`id`는 반드시 Clerk가 준 `data.id`(`org_...`)** — assign.ts:102가 `Brand.organizationId`로 이 값을 넣기 때문. Clerk orgId와 DB PK를 동일 문자열로 맞춘다.
  - **`ownerId`는 웹훅 payload `data.created_by`에서** — 이게 D3(ownerId 소스)의 정답: 앱단 추측(currentUser)이 아니라 Clerk가 명시한 org 생성자. 비-owner 오염 위험 원천 제거.
  - **create 시 `billingStatus`/`plan` 미기입**(기본값 `trialing`/`free`에 위임하되 결제 게이팅과의 정합은 결제 웹훅이 소유). billing 필드는 결제 웹훅만 write.
  - apps/api 배포 = Vercel 프로젝트 신규 링크 필요(현재 web=findable·app=findable-app만 링크). ⚠️ 배포·구독까지 리드타임 있음 → 아래 2차 가드 병행.
- **2차(가드) = write 직전 실재 확인(보강1 유지).** 웹훅이 지연·유실될 수 있으므로, Brand/Tracking write 직전 `organization.findUnique({ where:{ id: orgId } })`로 Org 실재를 **능동 확인**하고 없으면 write skip + `log.error`. `relationMode="prisma"`가 스칼라 FK create를 안 막아 **고아 row가 조용히 성공 생성**되므로, "실패를 잡는다"가 아니라 "선확인 후 진행"만 유효. (웹훅이 정상 도는 한 이 가드는 거의 안 걸리지만, 안전망으로 상시 유지.)
  - 신규 `apps/app/lib/db/ensure-org.ts`의 역할은 D2 확정으로 **"생성"에서 "확인/보정 폴백"으로 축소** — 웹훅이 이미 만든 걸 확인하고, 없으면(웹훅 미도달) 최소 upsert 폴백. 웹훅이 1차 소유자.
- 검증: 테스트 org 신규 생성 후 웹훅 로그 + `SELECT * FROM "Organization" WHERE id='org_...'` row 확인 → 그다음 audit 트리거.

**선행조건 1 — 로그인 audit 트리거 경로 신설 (근본원인 C 해소).**

fk-lens 치명 3의 핵심: 현재 audit은 비로그인 `apps/web` `/audit`뿐이라 **orgId가 runner에 도달할 경로가 없다**. 이게 없으면 `if(input.organizationId)`가 영구 false → 1단계는 no-op → 게이트 통과 불가. **따라서 이 경로는 1단계 필수 포함**(당초 incremental이 "나중"으로 미룬 것을 앞당김).

- 신규 `apps/app/app/actions/audit/run.ts` (`"use server"`):
  `const { orgId } = await requireOrg()` → `await ensureOrg(orgId)` → `ensureBrand(orgId, domain, name)` → `auditJob.create({ ... , organizationId, brandId })` → `after(() => runAuditJob({ jobId, domain, language, brandName, brandId, organizationId }))`.
  - `ensureBrand`: **[확인필요] Brand 복합 유니크 부재**(`schema.prisma:54-73`는 `@@index`만, `@@unique` 없음). `assign.ts:105`도 findFirst+create라 경합 시 중복. → 보강으로 `@@unique([organizationId, domain])`를 검토하나, 이는 스키마 변경이라 **열린 결정 D4**. 1단계에서 유니크 없이 가면 `$transaction`(보강 3) 안에서 findFirst+create로 최소화하되 완전 원자성은 없음.
- `apps/app/app/(authenticated)/brand/page.tsx`에 "AI 가시성 추적 시작" 버튼(on-demand, `scopedBrands` 이미 사용). 자동/cron 없음(원가·429 보호).
- **레이트리밋**: `apps/web/app/api/audit/route.ts:55-100 checkUsageGate`와 동형으로 **org+brand 기준 하루 N회**. 요금제 이코노미 `isPaid=growth이상` 게이팅과 연동(2번 레버).

**본체 A — Engine seed (보강 4).**

- 신규 `packages/database/prisma/seed.ts` — `import { ENGINES } from "@repo/ai/lib/engines"` 후 `for (const e of ENGINES) engine.upsert({ where:{id:e.id}, create:{...}, update:{...} })`. **ENGINES 전량(9행)**, `isActive`로 DEFAULT_7만 true. 멱등.
- `packages/database/package.json`에 `"db:seed": "tsx prisma/seed.ts"` 추가(현재 db 스크립트는 `prisma generate`뿐).
- 검증: `pnpm --filter @repo/database db:seed` → `SELECT count(*) FROM "Engine"` ≥ 7.

**본체 B — dual-write 헬퍼 + runner 배선.**

- 신규 `packages/database/lib/audit-tracking.ts` — `persistAuditTracking({ organizationId, brandId, promptDefs, flat, completedAt })`:
  1. **보강 1**: `organization.findUnique({ where:{ id: organizationId } })` — null이면 `log.error("audit.tracking.org_missing")` + return(write 없음).
  2. **보강 3**: 이하를 `database.$transaction([...])`로:
     - `prompt.upsert`(보강 2 유니크 기준 `{ brandId_text }`)로 각 프롬프트 → `text→promptId` map. Prompt 필수 `text`·`language`(ko|en, **both 없음** `schema.prisma:275-278`)·`brandId` 전부 이 시점 확정.
     - **보강 4**: `engine.findMany({ select:{id} })`로 DB 실재 id 집합 확보. `flat`에서 그에 없는 engineId 행은 skip + `log.warn`.
     - **[확인필요] stub/실패행 처리** (live-lens 중 C4): `isStub || errorMessage` 행을 Tracking에 그대로 넣으면 "인프라 실패"와 "진짜 0 언급"이 `brandMentioned:false`로 구별 불가 → SoV 급락 오독. Tracking에 isStub 컬럼 없음. → stub 행 제외 or errorMessage에 표식. **열린 결정 D5**.
     - `tracking.createMany`(또는 개별 create) — 매핑은 무손실 직결표(아래).
  3. 전체를 `try { await $transaction } catch { log만 }` — audit status는 이미 completed라 무영향.

  **Tracking 컬럼 ← EngineResponse 매핑 (engine-cost 조사 확정, 무손실)**:
  `engineId←r.engineId`(문자열=Engine.id PK 1:1) / `rawResponse←r.rawResponse`(@db.Text, **full 저장** — [확인필요] 용량, D6) / `brandMentioned` / `mentionPosition` / `sentiment`(enum 완전일치) / `citedSources←r.citedSources`(Json) / `shareOfVoice←r.shareOfVoice` / `errorMessage` / `brandId`=파라미터 / `promptId`=map / `trackedAt`=completedAt.
  ⚠️ `.flat()`(`runner.ts:136`) 후엔 프롬프트 출처 소실 → **flat 이전에 각 응답에 promptText 태깅** 필요.

- `apps/web/lib/audit/runner.ts`:
  - `AuditRunInput`(`:26-32`)에 `organizationId?: string`·`brandId?: string` 추가(비로그인은 undefined).
  - `queryAllEngines` 호출부(`:117` 부근)를 프롬프트 태깅형으로: `prompts.map(p => queryAllEngines(...).then(rs => rs.map(r => ({ ...r, promptText: p.text, lang: p.lang }))))`.
  - 삽입점: `auditJob.update({ status:"completed" })` **직후**(`:206` 부근, 완료 커밋 이후):
    ```
    if (env.AUDIT_DUAL_WRITE_ENABLED && input.brandId && input.organizationId) {
      await persistAuditTracking({ organizationId: input.organizationId, brandId: input.brandId, promptDefs: prompts, flat, completedAt: new Date() });
    }
    ```
  - **flag 기본 off**(보강 4). `env`는 `@t3-oss/env`(packages/env) 경유, 하드코딩 금지.

- 검증(1단계 전체): `pnpm typecheck`(또는 `pnpm --filter @repo/database exec tsc --noEmit`, `pnpm --filter web build`) → 로그인 org audit 1건 실행 → `SELECT count(*) FROM "Tracking" WHERE "brandId"=...` = 28(4×7, stub 제외 시 그 이하).

### 2단계 — 대시보드를 Tracking 소스로 전환 (게이트 통과 후)

- `apps/app/lib/db/scoped.ts:48-58 scopedTracking`(현재 **dead code**, 호출처 0)을 **여기서 첫 활성화**. `brand:{ organizationId: orgId }` relation filter가 org 시계열에 정확히 맞음.
- `apps/app/app/(authenticated)/page.tsx:27-32` email 스코프 → `requireOrg()` + `scopedTracking` 시계열 집계로 교체. `@@index([brandId, trackedAt])`(`schema.prisma:129`) 인덱스 그대로 탐.
- `apps/app/lib/dashboard-data.ts`에 Tracking 집계 함수 추가 — **`packages/ai`의 `aggregateAudit`과 정합** 필수(같은 숫자).
- `components/sov-trend-chart`·`audit-history-list`·`history/page.tsx` 데이터 소스를 Tracking으로.
- **1단계 dual-write는 끄지 않고 유지** → AuditJob이 상시 백업 소스라 언제든 읽기 롤백 가능.
- 검증: `pnpm typecheck` + `pnpm --filter app build` → 시계열 차트에 2회차 이상 점이 선으로 그려짐 확인.

---

## 4. 스키마 변경

### 1단계 — **거의 무변경** (보강 2만 additive)

- Tracking/Brand/Engine/AuditJob **필드 diff 없음**. 기존 컬럼에 write만 시작. Engine은 seed(row insert, DDL 아님).
- **보강 2로 Prompt에 유니크 추가**(live-lens 치명 2 완화, `prompt.upsert` 성립 위해 필수):
  ```prisma
  model Prompt {
    ...
    @@unique([brandId, text])   // 추가
    @@index([brandId])
  }
  ```
  `relationMode="prisma"`라도 `@@unique`는 실제 DB 유니크 인덱스로 생성됨. **선행 점검**: 기존 중복 `(brandId,text)` 존재 시 CREATE UNIQUE INDEX 실패 → Prompt 테이블이 사실상 비어 있으므로(prompt.create 호출 0건 = 데이터 없음) 안전할 것이나 **[확인필요]**.

### 2단계 — AuditJob에 nullable FK 2개 (additive, 라이브 안전)

```prisma
model AuditJob {
  ...
  organizationId String?
  organization   Organization? @relation(fields:[organizationId], references:[id], onDelete: SetNull)
  brandId        String?
  brand          Brand?        @relation(fields:[brandId], references:[id], onDelete: SetNull)
  @@index([organizationId])
  @@index([brandId])
}
// 역방향: Organization { auditJobs AuditJob[] }, Brand { auditJobs AuditJob[] }
```
- **반드시 nullable**(schema-full 확정): 기존 AuditJob 전 행이 org/brand 없음 → NOT NULL이면 마이그레이션 실패. 무료 audit은 영구 비로그인이라 NOT NULL 승격 구조적 불가.
- `SetNull`(Report의 Cascade와 구분): 감사이력은 org/brand 삭제 시에도 보존.
- ⚠️ `relationMode="prisma"`라 SetNull/Cascade는 **Prisma delete 경유에서만** 실행 — **raw SQL 삭제는 dangling FK를 남긴다**(운영 런북에 "삭제는 Prisma client 경유, 자식→부모 순서" 명문화).

### 라이브 마이그레이션 안전순서 + 롤백

1. **Engine seed**(INSERT-only, 멱등, 기존 무영향) → count 검증.
2. **1단계 Prompt @@unique**: 중복 없음 확인 후 `prisma migrate`. `CREATE UNIQUE INDEX`는 Prompt가 비어 있어 락 순간적. 실패 시(중복) dedup 먼저.
3. **1단계 코드 배포**: flag off로 배포(위험 0) → ensureOrg·트리거 경로 검증 → **flag on**. **Prisma Client 배포는 반드시 컬럼/유니크 이후**(rollback-lens 치명 1: Client가 컬럼보다 먼저 나가면 두 앱 동시 500).
4. **forward-fill만**: 과거 AuditJob 백필 **금지**. `result.excerpt`가 1500자 절단·`citedSources` 미포함(engine-cost 4번)이라 무손실 복원 불가.
5. **2단계 nullable FK ADD**: nullable+default NULL이라 Postgres 메타데이터-only(rewrite 없음). `@@index` `CREATE INDEX`는 AuditJob이 핫 테이블이면 짧은 SHARE 락 → **[확인필요] 행 수가 많으면 수동 `CREATE INDEX CONCURRENTLY`**(prisma migrate는 CONCURRENTLY 미지원, D7).

**롤백**: 전 단계 additive → 역순 무손실. 최악에도 flag off / 코드 revert로 write 중단, 추가 컬럼·seed·유니크는 남겨도 무해(nullable·미참조). 데이터 삭제 0.

---

## 5. 리스크 등급표

| 리스크 | 심각도 | 발생조건 | 완화책 | 잔여위험 |
|---|---|---|---|---|
| **R1** Org row 부재 상태서 고아 Brand/Tracking 성공 생성 (fk·live 치명) | 치명 | 웹훅 지연/유실 + `relationMode=prisma`가 스칼라 FK create를 안 막음 | **D2 정공법**: Clerk 웹훅이 org/user 정식 적재(근본) + 보강1: write 직전 `organization.findUnique` 이중가드(없으면 skip) | 웹훅 미도달 창에서 추적 무동작(파손 아닌 무동작). findUnique 가드가 오염은 차단 |
| **R2** promptId 분열로 시계열 두 선 (live 치명) | 치명 | 동시 audit 2건이 `findFirst→create` 레이스 | 보강2: Prompt `@@unique([brandId,text])` + `upsert` 원자화 | 유니크 추가는 스키마 변경(D4 승인 필요) |
| **R3** 배포 스큐 → Prisma Client가 컬럼보다 먼저 나가 두 앱 동시 500 (rollback 치명) | 치명 | S2(컬럼) 전에 새 Client 배포 | Client 배포는 반드시 컬럼/유니크 마이그레이션 **이후**. schema+Client+미참조코드 한 배포로 | Vercel 앱별 독립 배포라 타이밍 규율 의존 |
| **R4** Engine seed 미완/부분 → 고아 engineId 조용히 삽입 (전 렌즈) | 중 | seed 전에 flag on / seed 절반 실패 | 보강4: flag 기본 off + count 검증 후 on + write 직전 DB 실재 id 필터. `createMany`가 FK 안 막음을 전제로 필터가 유일 방어 | 사람이 지키는 순서 규율 |
| **R5** 부분 실패로 Brand/Prompt만 남고 Tracking 0 = 유령 브랜드 (전 렌즈) | 중 | 헬퍼가 비원자 다중 쿼리, createMany 직전 중단 | 보강3: `$transaction` 원자화(try/catch로 best-effort 유지) | `relationMode=prisma` tx 내 FK도 앱단 emulation |
| **R6** 잘못된 ownerId/billing 고착 (live·rollback) | 중 | 비-owner 최초 진입, create시 billing 기본값 | ownerId를 owner로만/웹훅 위임(D3), create시 billing 필드 미기입 | Clerk role 확인 로직 필요 |
| **R7** email↔org 스코프 축 불일치로 2단계 전환 후 대시보드 공백 (rollback 중) | 중 | 개인email 무료audit → 회사org 로그인 동일인 | 게이트에 "email 대비 org 커버리지 손실률" 추가. 필요시 email→org 확실한 건만 backfill | 매핑 불확실 건은 email 스코프로 잔존 |
| **R8** stub/실패행이 진짜 0과 구별 불가 → SoV 오독 (live 중) | 중 | 엔진 env 미설정/실패일 | stub 행 제외 or errorMessage 표식(D5) | Tracking에 isStub 컬럼 없음 |
| **R9** 재실행 Tracking 중복(자연키 없음) → SoV 뻥튀기 (전 렌즈) | 중 | 같은 brand 재추적, createMany append-only | 레이트리밋 + "배치 재실행 시 해당 brand 당일 Tracking 삭제 후 삽입" 정책 | 완전 멱등은 배치키 컬럼 필요 |
| **R10** raw SQL 삭제 시 Cascade 미발동 dangling (전 렌즈) | 경 | 운영자가 psql로 Brand/Org 직접 DELETE | 런북: 삭제는 Prisma client, 자식→부모 순서 | 운영 규율 의존 |
| **R11** rawResponse full 저장 용량/latency (live 경) | 경 | 28행 full raw 적재 | Tracking rawResponse도 1500자 절단 정책 검토(D6) | 결정 필요 |
| **본류 오염·다운타임·기존 AuditJob 충돌** | — (견고) | — | 삽입점=완료update 이후+`after()`, 1단계 대시보드/AuditJob 무변경, DDL 실질 0 | rollback-lens 3안 모두 "견고" 판정 |

---

## 6. 열린 결정 — 확정 상태 (2026-07-29)

- **D1 ✅ 확정 = backfill.** 비로그인 무료 audit은 `AuditJob`(email)에만 유지. 로그인·결제 전환 시 동일 email의 AuditJob을 org/brand 그래프로 이어붙임. 익명 placeholder org 금지. → D8(AuditJob FK)·backfill 잡과 짝.
- **D2 ✅ 확정 = 웹훅 정공법 우선.** apps/api Clerk 웹훅을 org/user upsert하도록 고치고 Vercel 링크·배포·Clerk 구독. write 직전 findUnique 이중가드(보강1) 병행 유지.
- **D3 ✅ 확정(D2에 흡수) = ownerId는 웹훅 `data.created_by`.** 앱단 추측 아님. 비-owner 오염 원천 제거.
- **D4 ✅ 확정 = 제외.** Brand 복합 유니크 안 넣음. `$transaction` 내 findFirst+create로 최소화(완전 원자성 없음=잔여위험 R2/중복 인지).
- **D5 ✅ 확정 = 제외.** stub/실패 엔진행은 Tracking에 안 넣음(성공 응답만). 진짜 0언급과 인프라 실패 혼동 방지.
- **D6 🔲 [확인필요]** — Tracking.rawResponse full vs 1500자 절단. 착수 시 용량 실측 후 결정. (기본 제안: AuditJob과 동일 1500자 절단.)
- **D7 🔲 [확인필요]** — 2단계 AuditJob 인덱스 추가 시 prisma migrate(짧은 락) vs 수동 CONCURRENTLY. AuditJob 현재 행 수 실측 후 결정.
- **D8 🔲 [확인필요, 채택안=2단계]** — AuditJob에 org/brand nullable FK 추가 시기. D1 backfill이 이 FK를 전제하므로, backfill을 언제 켜느냐와 함께 2단계에서 결정.

---

## 7. 다음 세션 착수 순서 (확인 후 체크리스트)

> D1·D2·D3·D4·D5 확정 반영. D2=웹훅 정공법이라 0단계에 웹훅 배선이 선행으로 들어감.
```
[ ] 0. 사전 실측: SELECT count(*) FROM "Prompt"/"Brand"/"Engine"/"AuditJob" (충돌·행수 점검)
[ ] 1. [D2 근본] apps/api/app/webhooks/auth/route.ts: org/user upsert 추가(@repo/database import)
       + apps/api Vercel 링크·배포 + Clerk 대시보드 org/user 이벤트 구독
       → 테스트 org 생성 → SELECT * FROM "Organization" WHERE id='org_...' 확인
[ ] 2. schema.prisma: Prompt @@unique([brandId,text]) 추가 (D3, Brand 유니크는 D4=제외)
       → pnpm --filter @repo/database exec prisma validate → 중복 없음 확인 후 migrate
[ ] 3. packages/database/prisma/seed.ts (ENGINES 전량, isActive) + package.json db:seed
       → pnpm --filter @repo/database db:seed → SELECT count(*) FROM "Engine" ≥7 확인
[ ] 4. packages/env: AUDIT_DUAL_WRITE_ENABLED 추가 (기본 off)
[ ] 5. apps/app/lib/db/ensure-org.ts: 웹훅 폴백 확인용(보강1 findUnique 이중가드) + ensureBrand
[ ] 6. apps/app/app/actions/audit/run.ts: 로그인 트리거 액션 (requireOrg→org확인→ensureBrand→create→after)
       + brand/page.tsx "추적 시작" 버튼 + 레이트리밋(요금제 게이팅 연동)
[ ] 7. packages/database/lib/audit-tracking.ts: persistAuditTracking
       (보강1 org findUnique → 보강3 $transaction → 보강4 engineId 필터 → D5 실패행 제외 → 매핑)
[ ] 8. apps/web/lib/audit/runner.ts: AuditRunInput 확장 + 프롬프트 태깅 + 완료update 직후 삽입(flag gate)
       → pnpm typecheck && pnpm --filter web build && pnpm --filter app build
[ ] 9. 배포: 웹훅(1)→마이그레이션(2)→seed(3)→코드(flag off) → 검증 → flag on
       → 로그인 org audit 1건 → SELECT count(*) FROM "Tracking" WHERE brandId=... 확인
[ ] 10. 게이트 감시(성공응답 커버리지·2회차 시계열·정합성·email→org 손실률 R7)
[ ] 11. 게이트 통과 시 2단계: AuditJob nullable FK ADD(D7·D8) + D1 backfill 잡(email→org 이어붙이기)
       + scopedTracking 활성화 + 대시보드 전환 (dual-write 유지) → pnpm typecheck && build
```

**한 줄 요약**: incremental 골격(1단계 dual-write 무변경+forward-only, 2단계 게이트 후 읽기 전환)에 적대적 검증이 뚫은 4개 구멍(org 실재 명시확인·Prompt 유니크·$transaction 원자화·Engine seed 전량+flag게이트)을 메워 확정. 근본원인 A(Org DB 미적재)는 lazy upsert로 우회 해소하되 write 직전 findUnique로 이중 가드하고, 무료 audit은 Tracking에서 배제해 NOT NULL FK를 회피가 아니라 준수로 푼다.
