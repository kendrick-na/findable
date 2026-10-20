# T3 빈 응답 20% 주입

**필요한 합쳐진 단위**: U1(빈 응답 재시도·분모 제외)
**실행 명령**:
- 현재 동작 기록(지금 통과): `cd packages/ai && npx vitest run lib/engines/test-harness/engine-faults` 와 `cd packages/audit && npx vitest run test-harness/runner-faults`
- 합친 뒤 합격선: `cd packages/audit && npx vitest run test-harness/scenarios -t "T3"`
**준비값 코드**: `plans.ts` 의 `T3_PLAN`, `T3_QUESTIONS`

## 준비
- 질문 20개. `chatgpt`·`perplexity` 가 시드 고정 20% 확률로 **빈 응답**(`errorMessage` 없음, `rawResponse` 빈 문자열, 노출 아님)을 낸다.
- 시계는 `installFakeClock()`, 엔진은 `makeQueryAllEngines(harness)` 를 러너에 꽂는다.

## 실행
- `runAuditJob` 1회 + `clock.settle()`.

## 합격 단언
1. 빈 응답 칸이 미노출로 세어지지 않는다 — `aggregateAudit` 의 `verifiedCount`(분모)에서 빠지고 `sov` 가 그만큼 오르거나 같다(내려가지 않는다).
2. 빈 응답은 재시도되고(칸당 호출 ≤ 3), 재시도 후에도 비면 분모 제외로 확정한다.
3. 분모 제외 사유가 기록된다(예: `empty_response`) — 어느 엔진·질문인지 알 수 있다.
4. 같은 시드·같은 입력은 같은 결과(재현성).
5. 빈 응답 때문에 정상 응답이던 칸의 값이 바뀌지 않는다(정상 칸 불변).

## 지금 검증되는 부분 (실제로 통과, 합친 뒤 의도적으로 깨진다)
- 빈 응답은 오류가 아닌 정상 응답으로 돌아오고(호출 1회, 사유 없음) 분모에 들어가 미노출로 센다. 예: 정상·노출 1 + 빈 응답 1 → 분모 2, 노출률 50%.
- 오류 행(`errorMessage` 있음)은 분모에서 빠진다 — 빈 응답과 오류 응답의 취급이 다르다는 것이 문제의 핵심.
