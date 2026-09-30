# Audit 300초 종료 계측 — 독립 검토 기록 (2026-10-01)

## 범위와 상태

- 기준 `origin/main`: `b3795d9`.
- 계측 커밋: `2fb5cd4` (`codex/timeout-instrument-20261001`). 미푸시·미통합·미배포.
- 지난 운영 Job `2bb84107-3b5c-434e-ac1c-36843339edff`는 Vercel 런타임 300초 제한으로 종료됐다. 어느 내부 단계가 병목인지는 현재 로그만으로 특정할 수 없다. 6분 stale-job 오류 문구는 실제 런타임 제한과 별개의 후속 상태 정리다.
- 이번 변경은 시간 계측만 추가했다. 프롬프트 수, 엔진 라우팅, 판정 규칙, 타임아웃, PDF 동작, DB 스키마를 바꾸지 않았다.

## 계측 검토

`audit.run.stage`에 `jobId`, `stage`, `phase`, 실행 시작 이후 `elapsedMs`, 완료 시 `durationMs`를 기록한다. 추가 식별자는 질문 인덱스, 엔진 ID, 판정 청크 인덱스 및 안전한 개수뿐이다. 질문 문장·답변·브랜드·도메인·자격증명은 새 로그에 넣지 않는다. 로그 콜백 예외는 측정 결과를 바꾸지 않도록 무시한다.

경계는 `mark_processing`, 브랜드/공식 사이트 식별, 경쟁사·질문 결정, 전체 질문 실행과 개별 직렬 질문, 개별 병렬 엔진, 전체 판정과 6건 단위 청크, 집계, 결과 DB 커밋이다. 각 비동기 경계에 `started`를 먼저 남기므로 300초에서 함수가 강제 종료되어도 마지막으로 진입한 단계와 미완료 엔진/청크를 구분할 수 있다. `job` 완료 이벤트는 핵심 결과 DB 커밋 직후이며 후속 Tracking/PDF/브리핑 완료를 뜻하지 않는다.

`queryPromptsSequentially`는 콜백에 0-based 인덱스만 추가했고 실행 순서를 유지한다. `queryAllEngines` 관측 콜백은 `Promise.allSettled` 결과를 유지한다. `verifyMentions` 관측 콜백은 청크 경계에서만 실행한다. 추가 콜백은 모두 선택 사항이므로 다른 호출자의 기존 동작은 유지된다.

## 검증과 기존 타입 오류의 baseline 비교

- 계측 브랜치: 관련 Vitest 7개 파일, 20개 테스트 통과. `pnpm --filter @repo/audit typecheck` 통과(로컬 Prisma Client 생성 후). `git diff --check` 통과.
- `@repo/ai` 전체 typecheck는 두 오류로 실패했다. 동일 lockfile·오프라인 설치를 사용한 **변경 전** `origin/main` `b3795d9`의 독립 worktree에서도 두 오류가 동일하게 재현됐다. 계측 커밋은 아래 파일과 `packages/ai/package.json`을 변경하지 않았다(`git diff origin/main HEAD --` 결과 없음).

```text
packages/ai/components/message.tsx(1,15): TS2724: "ai" has no exported member named "Message". Did you mean "UIMessage"?
packages/ai/lib/react.ts(1,15): TS2307: Cannot find module "ai/react" or its corresponding type declarations.
```

따라서 이 typecheck 실패는 계측 변경의 회귀가 아니다. 이 오류는 이 작업에서 수정하지 않는다.

## 다음 검증 게이트

통합 담당자는 fresh `origin/main` 기반의 **별도** checkout에서 변경 범위를 재검토하고 Preview 배포의 코드·환경·데이터 연결을 확인해야 한다. Preview 실행이 실제 운영 DB에 Job을 생성하거나 외부 AI 비용을 발생시키는지 먼저 확인한다. 사용자 승인 전에는 PR 통합, 운영 배포, 추가 라이브 Job 재실행을 하지 않는다. Preview에서 단계별 시간 로그를 확보한 뒤에야 HTTP enqueue + 영속 worker Job 구조가 필요한지 판단한다. 현재 `after()`의 300초 제한을 단순히 늘리거나 질문/엔진 수를 줄이는 변경은 이 계측에 포함하지 않았다.
