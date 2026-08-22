# A-14-O2 · stuck 스윕 cron + 관리자 콘솔 구현 명세

> Day14 · 설계 확정 · **실코드 반영 보류(§7.3 라이브 서비스)**
> 대상: `apps/api`(cron) · `apps/studio`(콘솔) — 기존 keep-alive 패턴 재사용
> 전제: Vercel cron + next-forge studio 앱 슬롯 활용

---

## 1. 스코프 — Day13 P0를 cron으로 승격

| 우선 | 항목 | 위험 | 근거 |
|------|------|------|------|
| **P0** | stuck 스윕 cron (audit + crew) | 저 | 기존 상태필드 UPDATE만, 스키마 무변경. Day13 P0 승격 |
| **P1** | 운영 집계 cron (daily digest) | 저 | 읽기 집계, 부작용 없음 |
| **P1** | 관리자 콘솔 최소판 (studio 채우기) | 중 | admin 역할 게이트 필요 |
| 🟡보류 | 수동 재처리 버튼(콘솔 쓰기) | 중 | 실데이터 변경, admin 감사로그 필요 |

---

## 2. P0 stuck 스윕 cron 명세

### 2-1. cron 라우트 (keep-alive 인증 패턴 그대로 재사용)
```
// apps/api/app/cron/sweep-stuck-jobs/route.ts (명세 — 실코드 아님)
GET /cron/sweep-stuck-jobs
  1. 인증: CRON_SECRET Bearer 또는 x-vercel-cron === "1"  (keep-alive와 동일)
  2. const cutoff = new Date(Date.now() - 15*60*1000)   // 15분
  3. audit 스윕:
       database.auditJob.updateMany({
         where: { status: { in: ["queued","processing"] }, createdAt: { lt: cutoff } },
         data: { status: "failed", errorMessage: "STUCK: swept by cron", completedAt: new Date() }
       })
  4. crew 스윕:
       database.auditJob.updateMany({
         where: { crewStatus: "processing", crewStartedAt: { lt: cutoff } },
         data: { crewStatus: "failed", crewCompletedAt: new Date() }
       })
  5. log.info("cron.sweep", { auditSwept, crewSwept })
  6. "OK" 200
```
- ⚠️ **updateMany 멱등**: 중복 실행돼도 이미 failed면 where에 안 걸려 무해(CRON-409 해결).
- ⚠️ **[확인필요]**: audit `status`가 실제로 처리 중 오래 걸리는 정상 케이스가 있는지(15분이 안전한 임계인지). crew는 Day13에서 "2~10분"이라 15분 안전. audit 빠른모드는 수 초라 15분이면 확실히 stuck.

### 2-2. vercel.json crons 추가
```
// apps/api/vercel.json — 기존 keep-alive에 한 줄 추가
"crons": [
  { "path": "/cron/keep-alive", "schedule": "0 1 * * *" },
  { "path": "/cron/sweep-stuck-jobs", "schedule": "0 * * * *" }   // 매시간
]
```
- ⚠️ **[확인필요]**: Vercel 플랜별 cron 최소 주기·개수 제한. 무료/Hobby는 하루 1회·제한 있을 수 있음 → Pro면 매시간 OK. 제한 시 keep-alive와 통합(1회 실행에 스윕도 같이).

## 3. P1 운영 집계 cron 명세
```
// apps/api/app/cron/daily-ops-digest/route.ts
GET /cron/daily-ops-digest  (schedule "0 2 * * *" 새벽 2시)
  - 어제(00:00~24:00) 범위:
      audit 총건 / status별 count / 평균 (completedAt - createdAt)
      crew 요청수(not_requested 제외) / completed 비율
      신규 Lead count (source별)
  - 결과 log.info + (Day17) 이메일/슬랙 전송 훅 자리만 마련
```
- 순수 읽기 집계. 부작용 없음. `@@index([createdAt])` 활용해 효율적.

## 4. P1 관리자 콘솔 최소판 (apps/studio 채우기)

### 4-1. 방향 — admin 역할 게이트 (Day11 org 스코핑과 반대)
- 일반 앱: `where: { organizationId }`로 **자기 org만**.
- 관리자 콘솔: **전사(크로스-org) 조회가 정당** — 단 Clerk **admin 역할**인 사람만.
- → org 스코핑을 "빼는" 게 아니라 "admin 역할 게이트로 교체". 잘못하면 일반 사용자가 전사 데이터 봄(최대 위험).
- ⚠️ **[확인필요]**: Findable Clerk에 admin/role 개념이 설정돼 있는지(publicMetadata.role 등). 없으면 이것부터.

### 4-2. 최소 화면 (읽기 전용 1페이지)
```
/  (studio 홈, admin 게이트)
  ┌ 오늘/7일 audit: 총건·성공·실패·평균소요
  ┌ 🔴 stuck 목록 (queued/processing 15분+ — sweep 전 실시간 확인용)
  ┌ crew 상태 분포 (not_requested/queued/processing/completed/failed)
  ┌ 최근 Lead 20건 (email·domain·source·시각)
```
- 서버 컴포넌트로 조회(CLAUDE.md §2 서버 우선). 쓰기 없음 → 감사로그 불필요.

## 5. 파일별 변경 지점 (반영 시)
| 파일 | 변경 | 위험 |
|------|------|------|
| `apps/api/app/cron/sweep-stuck-jobs/route.ts` | 신규 cron (keep-alive 복제 후 로직 교체) | 저 |
| `apps/api/app/cron/daily-ops-digest/route.ts` | 신규 cron (집계) | 저 |
| `apps/api/vercel.json` | crons 배열에 2줄 추가 | 저 |
| `apps/studio/app/` | 콘솔 페이지 신규 (현재 빈 앱) | 중(admin 게이트) |
| schema.prisma | **변경 불필요** (기존 status/index 활용) | — |

## 6. 검증 명령 (반영 시, CLAUDE.md §5)
- `pnpm check`
- `npx tsc --noEmit` (apps/api + apps/studio) — studio 기존 오류 1 이하 유지, api 2 이하 유지
- `turbo build`
- cron 실동작: 로컬 `curl -H "Authorization: Bearer $CRON_SECRET" .../cron/sweep-stuck-jobs` + stuck 더미 job 만들어 정리 확인
