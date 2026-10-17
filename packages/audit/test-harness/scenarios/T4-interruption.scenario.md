# T4 중단 시뮬

**필요한 합쳐진 단위**: U3(중단 복구 — lease 만료를 「이어가기 대기」로 바꾸는 정리 cron)
**실행 명령**:
- 지금 통과하는 부분: `cd packages/audit && npx vitest run test-harness/runner-faults`
- 합친 뒤 합격선: `cd packages/audit && npx vitest run test-harness/scenarios -t "T4"`
**준비값 코드**: `plans.ts` 의 `T4`

## 준비
- 질문 12개짜리 job 을 `createMemoryJobStore()` 에 `processing` + 유효 lease 로 넣는다.
- 엔진은 장애 없는 harness. 7번째 질문이 저장된 직후 실행이 멈춘다(저장 콜백에서 던지거나 `store.expireLease(id)`).
- 정리 cron 은 U3 가 정한 함수(예: 이어가기 정리). 현재 코드에서 가장 가까운 것은 `stale-job.ts` 의 `isStaleAuditJob` / 일괄 정리.

## 실행
1. job 실행 → 7번째 질문 저장 직후 중단(`store.expireLease`).
2. 가짜 시계를 정리 cron 주기만큼 민 뒤 정리 cron 실행.
3. 이어가기 실행.

## 합격 단언
1. 정리 후 상태가 `failed` 가 아니라 이어가기 대기(`queued` + `leaseUntil`). `store.statusTrail(id)` 에 `failed` 없음.
2. 이어가기는 8~12번째 질문만 호출한다 — `harness.calls` 의 두 번째 구간에 `q1`~`q7` 이 없다.
3. 같은 칸(엔진+질문) 유료 호출이 1회 — `Math.max(...harness.callsPerCell().values()) === 1`.
4. 이어가기 횟수가 `MAX_AUDIT_CONTINUATIONS`(`continuation-limit.ts`)를 넘지 않는다. 초과 시 잠정 마감.
5. 최종 결과는 12개 질문 전체를 포함한다.

## 지금 검증되는 부분 (실제로 통과)
- 체크포인트 이어가기(7개 저장 → 남은 5개 질문만 호출, 같은 칸 호출 1회) — `runCheckpointedQuestions` 수준.
- 현재 코드에서 실행 중 job 의 lease 만료 = stale(실패 정리 대상). U3 는 이 경로를 이어가기 대기로 바꿔야 한다.

## 합친 뒤 채울 부분
- 정리 cron 이 실제로 `failed` 대신 이어가기 대기로 만드는지(1·4·5번).
