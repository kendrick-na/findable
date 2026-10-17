# T5 롤백 호환

**필요한 합쳐진 단위**: U1~U4 중 checkpoint·결과에 필드를 더하거나 동작을 플래그로 바꾸는 모든 단위(최종 통합 브랜치).
**실행 명령**:
- 지금 통과하는 부분: `cd packages/audit && npx vitest run test-harness/scenarios -t "T5"` 와 `test-harness/runner-faults`
- 합친 뒤: 옛 코드(기준 커밋 `5068d9f4`)의 `readAuditCheckpoint` 를 가진 worktree 와 새 코드 worktree 를 나란히 두고 아래 순서로 비교.
**준비값 코드**: `plans.ts` 의 `T5` (새 필드 이름은 U1~U4 가 정한 뒤 교체 — [확인필요])

## 준비
- 기준 커밋 `5068d9f4` 에서 `git worktree add` 로 옛 코드 작업본을 만든다.
- 새 코드(통합 브랜치)에서 플래그를 켠 채 측정을 중간까지 돌려 checkpoint JSON 을 저장한다.

## 실행 / 단언
1. **새 → 옛 읽기**: 새 코드가 만든 checkpoint JSON 을 옛 코드의 `readAuditCheckpoint` 에 넣는다. 예외 없이 읽히고, 이어가기가 완료된다.
   - 규칙: 새 코드는 필드를 **더하기만** 한다. `version`(2)·`engineConfigVersion`(1)·`enginePlan` 모양은 건드리지 않는다(건드리면 옛 코드가 `invalid audit checkpoint` 로 거부 — 지금 통과하는 특성화 테스트가 이 사실을 고정).
2. **플래그 끔 = 기준선 동일**: 새 코드에서 모든 신규 플래그를 끄고 같은 입력·같은 가짜 엔진으로 돌린 결과 JSON 이 기준 커밋의 결과와 바이트 동일(시각·소요시간 키 정규화 후).
3. **켰다 끔**: 플래그를 켜서 시작 → 중간에 끄고 → 이어가기가 완료된다.
4. 로그·DB 컬럼이 늘었다면 옛 코드가 그 컬럼을 몰라도 쿼리가 깨지지 않는다(select 목록 확인).

## 지금 검증되는 부분 (실제로 통과)
- 현재 읽기 코드는 모르는 최상위 필드와 응답 행 필드를 무시하고 통과시킨다(더하기만 하면 안전).
- `engineConfigVersion`·`version` 을 바꾸면 거부한다.
- 같은 입력·같은 장애 계획의 결과 JSON 은 두 번 돌려도 같다(시각 정규화 후) — 기준선 비교가 가능하다는 증거.

## 합친 뒤 채울 부분
- 1~4번 중 실제 새 코드가 필요한 것 전부. 위 두 줄의 「정규화 방식」(`stable()` in runner-faults.characterization.test.ts)을 기준선 비교에 그대로 쓴다.
