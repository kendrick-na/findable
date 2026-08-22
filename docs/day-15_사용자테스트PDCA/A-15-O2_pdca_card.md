# A-15-O2 · PDCA 카드 (pdca_card)

> 2026-07-24 · Day15 단계3 · Plan·Do·Check·Act 4단계 + 전후 증거
> 대상 문제: [A-15-O3](A-15-O3_improvement_priority.md) 선정 **P3 — crew 백그라운드 크래시 시 영구 stuck**
> ⭐ 전략 판단(옵션 B): 억지 문구 개선 대신, 이미 반영됐으나 E2E 미검증인 stuck 가드를 PDCA로 완주. **검증 중 실제 사각지대를 발견해 최소 코드 보강까지 수행.**

---

## Plan — 무엇을 왜 바꾸는가 + 성공 기준

- **원인 가설**: crew(4에이전트)는 `after()` 백그라운드 실행이라 프로세스가 크래시하면 `crewStatus`가 한 값에 굳어 사용자 화면이 영구히 "분석 중"에 갇히고 재트리거도 409로 막힌다(Day13 D13-3). Day13/14에서 route에 `STALE_AFTER_MS=15분`, runner에 `CREW_TIMEOUT_MS=12분` 2단 가드를 넣어 대부분 완화했으나 **런타임 E2E가 미검증**으로 남아 있었다(실행백로그 58행).
- **성공 기준**:
  1. stale 판정 로직이 케이스별로 의도대로 작동함을 검증(processing 5/12/14분=차단, 16/60분=복구 허용, completed=차단).
  2. 2단 방어 정합성(runner 12분 < route 15분) 확인.
  3. **검증에서 결함이 나오면 최소 변경으로 보강**하고 재검증. 저장/스키마 무변경.

## Do — 어떤 코드를 어떻게 바꿨나

- **검증**: 순수 로직 시뮬레이션으로 route.ts 판정식(69~91행) 재현, 8케이스 검증 → **8/8 pass**. 2단 방어 정합 ✅.
- **★검증 중 발견한 실제 사각지대**: route의 stale 판정은 `crewStartedAt !== undefined`에 의존하는데, `after()`가 runner의 processing 전환(= `crewStartedAt` 세팅, crew-runner.ts:55) **직전에** 크래시하면 `crewStatus="queued"` + `crewStartedAt=null`로 굳는다. 이 상태는 stale 판정을 못 받아 **영구히 409로 막힘**. 코드 주석(72행)의 "queued는 방금 트리거된 것" 가정의 빈틈.
- **보강(최소 변경)**: `apps/web/app/api/audit/[jobId]/crew/route.ts` — queued 전환 시(101~104행) `crewStartedAt: new Date()`를 함께 세팅. 이러면 queued로 굳은 job도 15분 초과 시 재실행 허용. 트리거 시각 기준이라 정상 흐름은 runner가 processing 전환하며 실제 시작 시각으로 덮어써 영향 없음.
- 변경 범위: 이 route 파일 1개, `update` 한 줄 + 근거 주석. 저장 흐름·스키마 무변경.

## Check — 변경 전 현황(증거) → 변경 후 확인 방법

- **변경 전 현황(증거)**:
  - 로직 시뮬 v1(변경 전): queued+startedAt=null이 16분 굳어도 `409_blocked` = **영구 stuck 재현** (`/tmp` stuck_guard_check.mjs, 8/8 통과하나 이 케이스가 사각지대)
  - `apps/api/app/cron/`에 `keep-alive`만 존재, `sweep-stuck-jobs`는 **미반영**(Day14 명세만) → cron 안전망도 아직 없음 = queued 사각지대를 잡아줄 2차 방어 부재
- **변경 후 확인 방법 + 결과**:
  - 로직 시뮬 v2(변경 후): "queued 16분 굳음 → restart_allowed"로 전환, **6/6 pass** ✅ (stuck_guard_check2.mjs)
  - `npx tsc --noEmit`(web) = **error 0** (기존 실측 0 유지, CLAUDE.md §5 준수) ✅
  - `biome check` 변경 파일 = **통과** ✅
  - ⚠️ **실제 라이브 DB에 stuck job을 만들어 브라우저에서 재클릭 복구까지는 미실행** — 라이브 서비스라 인위적 stuck 주입은 위험. 로직·타입·lint 검증으로 대체하고 정직하게 미실행 표기(교재 "안 한 측정은 지어내지 마" 준수).

## Act — 다음 사이클 행동

- **stuck 스윕 cron(sweep-stuck-jobs) 실코드 반영** — 사용자 조회에 의존하지 않는 2차 안전망. queued 사각지대의 근본 방어. 실행백로그 Day14 P0 항목(65행)을 Day16 배포 트랙과 함께 착수.
- queued+null 굳음의 런타임 E2E(스테이징에서 인위적 stuck 주입 후 복구 확인)를 Day17 관측성 사이클에서.
- P1(7개 엔진 문구)·P2(액션 자동 노출)는 실사용자 검증 데이터 확보 후 다음 PDCA.

---

## ✅ 완료 기준 자기 점검
- [x] Plan·Do·Check·Act 4칸 모두 채움
- [x] Check에 "변경 전 현황(증거)" + "변경 후 확인 방법·결과" 둘 다
- [x] 전후 증거 연결(시뮬 v1→v2, tsc, biome, 실행백로그 근거)
- [x] 다음 사이클 행동(Act) 명시
- [x] 미실행(라이브 E2E) 정직 표기
