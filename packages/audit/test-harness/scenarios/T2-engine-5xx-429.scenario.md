# T2 엔진 1개 100% 5xx + 다른 엔진 20% 429

**필요한 합쳐진 단위**: U1(엔진 재시도·서킷브레이커)
**실행 명령**:
- 현재 동작 기록(지금 통과): `cd packages/ai && npx vitest run lib/engines/test-harness` 와 `cd packages/audit && npx vitest run test-harness/runner-faults`
- 합친 뒤 합격선: `cd packages/audit && npx vitest run test-harness/scenarios -t "T2"`
**준비값 코드**: `plans.ts` 의 `T2_PLAN`, `T2_QUESTIONS`, `MAX_CALLS_PER_CELL`

## 준비
- 질문 20개, 엔진은 기본 세트. `claude` 는 모든 호출 503, `gemini` 는 시드 고정 20% 확률로 429(Retry-After 5초).
- 시계는 `installFakeClock()`. 재시도 간격 2초·8초, 쿨다운 120초는 `advanceThroughRetryBackoff()` / `advanceThroughCooldown()` 로 지나간다.
- 엔진 주입: 라이브 모드 러너에 `vi.mock("@repo/ai/lib/engines")` 로 `makeQueryAllEngines(harness)` 를 꽂는다(`runner-faults.characterization.test.ts` 와 같은 방식). `queryAllEngines` 자체를 시험할 때는 `globalAdaptersMock(harness)`.

## 실행
- `runAuditJob` 을 한 번 돌리고, 필요하면 `clock.settle()` 로 끝까지 민다.

## 합격 단언
1. 모든 칸에서 `harness.callsPerCell()` 값 ≤ 3 (최초 1 + 재시도 2).
2. 총 호출 수 ≤ 질문 수 × 엔진 수 × 3. 장애 엔진(`claude`)은 서킷브레이커로 이보다 훨씬 적다. [확인필요: 브레이커 열림 기준]
3. 장애 엔진 제외 사유가 결과에 기록된다(`measurementContext.engineErrors` 또는 U1 이 정한 필드): 엔진 이름·종류·회복 여부.
4. 오류 칸이 `mentionQuality: "absent"`(미노출)로 바뀌는 경로가 0 — 모든 오류 행은 `errorMessage` 가 남고 분모(`verifiedCount`)에서 빠진다.
5. `gemini` 429 는 Retry-After(5초)를 존중한다: 재시도의 `CallRecord.at` − 첫 호출 `at` ≥ 5000.
6. 쿨다운 120초가 지나면 장애 엔진을 다시 시험 호출 1회만 한다(반열림).

## 지금 검증되는 부분 (실제로 통과, 합친 뒤 의도적으로 깨질 수 있음)
- 429·5xx 는 재시도 없이 그 칸이 바로 오류 응답 1건(호출 1회).
- 장애 엔진을 5번 연속 불러도 매번 호출 — 제외 장치 없음.
- 오류 행은 분모에서 빠지고(안전), 결과에 `engineErrors` 가 남는다.
- Retry-After 값은 오류 문구에 실리지만 코드가 쓰지 않는다.
