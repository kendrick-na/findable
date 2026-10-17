# T1 동시 폭주

**필요한 합쳐진 단위**: U2(입장 관리). 이 단위가 없으면 합격선을 시험할 대상이 없다.
**실행 명령**: `cd packages/audit && npx vitest run test-harness/scenarios -t "T1"` (합친 뒤 it.todo 를 채운 다음)
**준비값 코드**: `plans.ts` 의 `T1`

## 준비
- 고객 3곳이 같은 순간에 측정을 시작한다. A 는 질문 20개, B·C 는 1개씩.
- 내부 측정 2건, 무료 진단 3건을 같은 순간에 섞는다.
- DB 연결 풀 크기를 1, 2 로 바꿔 두 번 돌린다(`FakePool(size)`).
- 시계는 `installFakeClock()`. 엔진은 장애 없는 `createFaultHarness({ rules: [] })` + 질문당 지연(예: 30초)을 `delay` 로 줘서 겹침이 생기게 한다.
- 입장 관리자는 `ConcurrencyProbe.enter(owner, task)` 로 감싸서 동시 실행 수를 잰다.

## 실행
- 모든 job 을 동시에 던지고, `clock.settle()` 로 전부 끝날 때까지 가짜 시계를 민다(최대 2시간 분량).

## 합격 단언
1. `probe.maxConcurrent` ≤ U2 가 정한 동시 실행 상한. [확인필요: 상한 값]
2. 고객별 동시 실행 `probe.maxConcurrentFor("A")` ≤ 공정 상한 — A 한 곳이 자리를 다 차지하지 않는다.
3. B·C 의 첫 시작까지 대기(`probe.waitMs("B", t0)`)가 A 의 남은 작업 시간에 비례하지 않는다(A 20개가 다 끝나길 기다리지 않는다).
4. 입장 대기 중인 job 이 30분 규칙(`AUDIT_JOB_QUEUE_STALE_AFTER_MS`)으로 실패 처리되지 않는다 — `store.statusTrail(id)` 에 `failed` 없음.
5. `pool.timeouts === 0` (연결 대기 오류 0), 풀 크기 1·2 모두.

## 지금 검증되는 부분 (scenarios.test.ts 에서 실제로 통과)
- 30분 규칙의 현재 동작: lease 없는 대기 job 은 30분 넘으면 stale, 이어가기 대기(lease 있음)는 stale 아님.
- 계측 틀(`ConcurrencyProbe`, `FakePool`) 자체의 동작은 `harness.test.ts`.
