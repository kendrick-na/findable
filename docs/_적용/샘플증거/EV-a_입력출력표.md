# EV-a 증거 한 장 조립기 — 입력 → 출력 표

> 코드: `packages/audit/evidence-sheet.ts` (`assembleEvidenceSheet`, `notComparableReasonsOf`). 시험: `evidence-sheet.test.ts`.
> 계산은 하지 않는다. S1이 계산한 K0 타입 조각을 받아 `EvidenceSheetInput`으로 묶을 뿐이다. S1 파일은 import하지 않는다.

| 입력 조각(`EvidenceSheetParts`) | 출력 위치(K0) | 비었을 때 |
|---|---|---|
| `observed` | `envelope.observed` | 확인 불가(사유 유지) + `not_comparable` |
| `unmeasured[]` | `envelope.unmeasured` | 빈 배열 그대로(못 잰 것 0건 명시). 분모 0이면 `rate`는 0이 아니라 null |
| `before_after` | `before_after`, `envelope.comparison` | null = 해당 없음 |
| `retrieval`·`engine_model`·`method_version`·`measured_at`·`source_ids` | 같은 이름 | 확인 불가(`not_recorded`) |
| `index_check` | `envelope.index_check` | 확인 불가(`not_configured`) |
| `limits` | `envelope.limits` | 필수(문구는 EV-c `buildLimitsBlock`) |
| `language`·`ui_language` | `envelope.language`·`ui_language` | 측정 언어와 문구 언어는 별개 |
| `as_of` | `footer.as_of` (`not_effect_proof`는 항상 true) | 필수 |
| `min_repeats` | (출력 없음, 판정 기준) | null이면 안전하게 `not_comparable` |

## `finding_kind` 판정

| 조건 | 결과 | 사유 코드 |
|---|---|---|
| `observed` 확인 불가 | not_comparable | `repeats_insufficient` (분모 사유면 `denominator_zero`) |
| 반복 횟수 < `min_repeats` (또는 기준 null) | not_comparable | `repeats_insufficient` |
| 분모 0 | not_comparable | `denominator_zero` |
| 언어 `mixed` | not_comparable | `mixed_cohort` |
| 위 모두 아님 | observed | - |

「효과」 종류는 없다. 반복이 모자라면 「발견」 문구를 만들지 않는다(문구는 EV-c).

## 전후 비교 정리
- `not_comparable`이 있으면 `difference`와 행별 `delta`를 null로 맞춘다(K0 규칙).
- `pair_count < min_pairs_required`인데 사유가 비어 있으면 `pairs_insufficient`를 채운다.

## 증거 한 장 화면안(O4 3-2) 승인 기록

| 항목 | 값 |
|---|---|
| 승인 여부 | 확인 필요(대표 묶음 2, 10/22 예정) |
| 승인일 |  |
| 승인 범위(md/HTML 대체 포함 여부) |  |
| 비고 | 승인 전에는 화면 코드 없음. 출력은 `scripts/proof/render-evidence-sheet.ts` 의 md/HTML로 대신하며 「화면 제공」 표현을 쓰지 않는다 |

## 아직 없는 것
- `fromStoredRuns()`(저장 결과 → 조각 연결): S1이 통합 브랜치에 머지된 뒤 10/24에 붙인다.
