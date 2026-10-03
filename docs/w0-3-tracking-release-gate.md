# W0-3 Tracking replay release gate

이 문서는 Tracking idempotency/replay 변경을 통합하거나 RELEASE 후보로 올릴 때의 선별 목록과 선행 조건이다. 이 worktree에서는 배포·운영 DB migration 적용·RELEASE를 수행하지 않는다.

## 선별 통합 후보

아래 커밋은 하나의 기능 경계로 함께 검토한다.

| 순서 | 커밋 | 내용 |
| --- | --- | --- |
| 1 | `7ac0453` | `trackingRowKey` 기반 dual-write idempotency와 PostgreSQL replay 경로 |
| 2 | `8b74f97` | briefing row key에 `promptIndex` 반영 |
| 3 | `9ec179f` | core key helper와 schema/migration parity 검증 |
| 4 | `ae2f72d` | 실제 migration SQL 적용 및 core replay/different-run PG 검증 |
| 5 | `c4b3697` | durable marker 기반 tracking reconciler |
| 6 | `cb137fe` | raw share-of-voice·usage·capture flag snapshot 보존 |
| 7 | `3d3eec5` | `pending`/`unknown` marker gate |
| 8 | `513f0cb` | 기존 cron에 bounded tracking sweep 연결 |
| 9 | `a42062e` | sweep 20초 예산과 stale recovery 경계 |
| 10 | `a933975` | claim token fencing, stale finalize 방지 |
| 11 | `b2fa782` | 실제 PostgreSQL 두 연결의 claim/finalize 경합 검증 |
| 12 | `408306b` | stale 경계 +9분 거절 fixture 추가 |

## `cdb34fb` 기반 격리 통합 후보 (2026-10-04)

이 후보는 위 소스 SHA `408306b`의 W0-3 실행·Tracking·브리핑·reconciler·cron 경계를 파일별로 선별 적용했다. 전체 merge/cherry-pick은 하지 않았다. RELEASE의 W1 가이드, Report, PDF template/generator 및 `audit-v3` artifact 이름은 그대로 두었다. terminal result commit에는 이전 `pdfUrl`을 원자적으로 `null`로 지우는 RELEASE 계약을 이식했다. 판정 LLM의 abort 경계도 RELEASE 구현을 보존했다.

소스와 RELEASE의 prompt scheduler 계약이 달라 checkpoint wrapper가 저장된 질문·엔진 plan key를 전달한다. 이 key는 기존 checkpoint 구조를 식별하며, checkpoint 입력 검증·lease fencing을 대체하지 않는다.

로컬 통합 후보와 운영 적용은 별개다. 특히 `20261001_audit_question_checkpoint`, `20261002_audit_postprocessing_state`, `20261004_tracking_row_key` migration의 **실제 운영 대상/적용 여부는 W0-0 대조 전까지 미확인**이다. migration 선행, 기존 NULL processing/구 writer 전환, provider/DB의 늦은 commit, 실제 cron 30초와 플랫폼 300초, Preview·운영 검증이 남아 있다. 이 후보에서 운영 DB·Preview·배포를 실행하지 않는다.

## 선행 migration gate

코드 rollout보다 먼저, 해당 애플리케이션 DB에서 다음을 순서대로 확인한다.

1. `packages/database/prisma/migrations/20261004_tracking_row_key/migration.sql`을 적용한다.
2. `Tracking.trackingRowKey` 컬럼과 `Tracking_trackingRowKey_key` unique index가 존재하는지 확인한다. 기존 legacy row의 `NULL` key는 보존되어야 한다.
3. migration 후 Prisma client/schema drift가 없는지 확인한다.
4. 아래 테스트를 통과시킨 뒤에만 reconciler/cron 코드를 RELEASE 후보로 올린다.
   - `apps/app/__tests__/tracking-prisma-replay.test.ts`
   - `packages/audit/reconcile-audit-tracking.test.ts`
   - `packages/audit/sweep-audit-tracking.test.ts`
   - `pnpm --filter @repo/audit typecheck`
   - `pnpm --filter web typecheck`

## 동시성 확인 범위와 한계

일회용 PostgreSQL에서 두 Prisma 연결로 같은 completed job을 동시에 claim하면 한 연결만 writer 진입한다. 같은 fixture에서 +9분 재claim은 0행, +11분 stale 재claim은 1행이며, 이전 token의 늦은 finalize는 0행, 최신 token의 finalize만 1행임을 검증한다. 이는 claim/finalize fencing의 보장이다. 이 테스트는 claim helper 경합과 marker fencing을 검증하는 범위이며, 실제 `persistAuditTracking` payload write까지 포함한 end-to-end worker 검증은 아니다.

Sweep의 `withTimeout`은 caller 반환을 제한하지만 이미 시작된 Prisma/provider Promise를 취소하지 않는다. 따라서 이 테스트와 현재 구현만으로 cron의 전체 30초 종료, 외부 provider exactly-once, 늦은 provider commit의 물리적 취소를 보장한다고 해석하지 않는다. 운영 rollout 전에는 provider 취소/작업 큐의 lease semantics를 별도로 확인해야 한다.
