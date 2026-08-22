# A-10-O4 — 2주차(Day06~10) 산출물 품질 점검표

> Findable · Day10 단계5·6 · 2026-07-17 · Track A
> 근거: 각 Day 실제 제출물 파일. 상태 = 동작/부분/미완. 추측 금지. 정상·오류 흐름은 Day11 테스트 입력 후보로 정리.

## 2주차 산출물 점검

| 산출물 | 현재 상태 | 증거 | 남은 문제 / Day11 테스트 후보 |
|---|---|---|---|
| **Day06 기술SEO·GEO·JSON-LD** (A-06-O1~O3) | 동작(문서) | `day-06/제출물/` 기술SEO패키지·GEO전략·공개점검표 3종 제출 | 실제 `apps/web` 메타·JSON-LD 반영 여부 → Day16 배포 시 검증 |
| **Day07 Slice 1 — Brand 등록** (A-07-O1) | **부분** (설계·명세 확정, 실코드 반영은 판단 보류) | `A-07-O1_slice1_계획+구현.md` — 8칸 계획서 + 4파일 치환 설계. Findable에 Brand 모델·Clerk 존재 확인 | feature-based actions/queries 분리 실파일 반영 [확인필요] → 정상/오류 흐름을 Day11 테스트 케이스로 |
| **Day08 Skill — blind-revalidator** (A-08-O1) | 있음 | `A-08-O4 test_log`·`A-08-O5 improvement_note`·`R1 후보선택` | Slice 3 이후 재사용 여부. 문서 입력 전용(DB 접근 X) |
| **Day09 MCP — org-scoping-checker 결정** (A-09-O2) | **부분** (후보 결정까지. 실연결은 별도 세션) | `A-09-O2 후보결정`·`O3 보안점검`·`O4 handoff`·명령어가이드 | 실제 `claude mcp add`·도구 호출 미완 → org 격리 자동탐지 Day11 RLS 검증에 활용 |
| **Day10 Slice 2 — 브랜드 담당자 배정** (A-10-O1) | **부분** (오류 가이드·구현 명세 확정, 실코드 보류) | `slice2_implementation_note.md` — 5기준 선택·오류 6유형·Server Action 설계 | 오류 6유형(AUTH-401·403·BRAND-404·RULE-409·INPUT-422·500) → Day11 테스트 케이스. `assigneeUserId` 컬럼 migration 판단 |
| **Day10 오류 가이드** (A-10-O2) | **동작(문서)** ✅ | `slice2_implementation_note.md §2` — 6유형 표, 화면 민감정보 0·로그 코드 100% | 그대로 Day11 역할 기반 AUTH-403 추가 |
| **보안·격리 (org 스코핑)** | 부분 | BL-007·011 명세, A-10 검증표에 A/B 설계 근거. 실행 검증은 미실행 | org 스코핑 A/B 실행 검증(Clerk 테스트 org 2개) → Day11 |
| **캡처 안전·빌드** | 미실행(이번 Day 코드 변경 없음) | 이번 Day 산출물은 문서만 → git에 .env·키 없음(전 Day 동일) | 실코드 반영 시 `pnpm check`·`turbo build` 실행 후 채움 |

## Day11 테스트 입력 후보 (정상/오류 흐름 이관)

Slice 2 오류 6유형 = Day11 테스트 케이스로 직행:
1. 정상(내 org 브랜드 배정) 2. AUTH-401(비로그인) 3. RULE-409(archived) 4. BRAND-404(대상 없음/타org) 5. INPUT-422(형식 위반) 6. BRAND-ASSIGN-500(DB 실패)
+ Day11 신규: **역할 기반 AUTH-403**(leader만 배정 — Member/role 모델 도입 후)

## 공개 전 점검

> 이번 Day10은 **문서 산출물만 생성**(코드 변경 없음). lint·build는 실코드 반영 시 실행. 아래는 이번 Day 기준 실제 상태.

| 점검 항목 | 실제 결과 | 비고 |
|---|---|---|
| `pnpm lint` | 미실행 | 이번 Day 코드 변경 없음 (실코드 반영 시 실행) |
| `pnpm build` / `turbo build` | 미실행 | 동상 |
| git status에 `.env`·키 파일 노출 | **없음** ✅ | 산출물은 `docs/day-10_*/` .md 3개뿐. secret 미포함 |
| 캡처·로그에 API 키·SQL·실고객 데이터 | **없음** ✅ | 문서 내 코드는 예시(더미), 실 키·실고객 0 |
| 화면 메시지에 stack trace·SQL·키 | **없음** ✅ | 오류 가이드 6유형 사용자 메시지 모두 일반 안내문 |
