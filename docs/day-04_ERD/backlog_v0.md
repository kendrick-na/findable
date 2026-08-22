# A-04-O4 — INVEST 백로그 초안 10개

> Findable · Day04 · 2026-07-08 · Track A · Day05 20개 확장의 씨앗
> 근거: PRD_v1 §2 Must 4개 + Day04 ERD/권한 발견. INVEST(Independent·Negotiable·Valuable·Estimable·Small·Testable).
> ⚠️ 스택 치환: RLS = **Clerk org 앱레벨 스코핑**(rls_policy §2).

## PRD Must → 백로그 매핑
1. 무료 도메인 진단(비로그인 1회) → BL-001·002
2. 7엔진 SoV 측정 → BL-003·004·005
3. 인증(Clerk 1흐름) → BL-006·007
4. SoV 대시보드 → BL-008 (+ Should: BL-009·010)

## 백로그 표

| BL-ID | 제목 (사용자는 …할 수 있다) | 완료 기준(테스트 가능 1줄) | 우선순위 | 관련 테이블 | 관련 권한/스코핑 | 선행 |
|---|---|---|---|---|---|---|
| **BL-001** | 로그인 없이 도메인을 입력해 무료 진단을 요청할 수 있다 | 도메인+email 제출 시 AuditJob 1건 `queued` 생성 | Must | audit_jobs | anon INSERT(rate limit) | — |
| **BL-002** | 진단 결과(1p SoV·경쟁사·Top3)를 email 링크로 받아 볼 수 있다 | AuditJob `completed` 후 result JSON·pdf_url 조회 가능 | Must | audit_jobs·reports(free_audit) | email로 본인만 | BL-001 |
| **BL-003** | 브랜드를 등록해 추적 대상으로 저장할 수 있다 | Brand 1건이 내 org로 저장, 목록에 표시 | Must | brands | org 스코핑(organizationId) | BL-006 |
| **BL-004** | 브랜드별 프롬프트로 7엔진 SoV를 1회 측정할 수 있다 | 엔진×프롬프트당 Tracking 생성, shareOfVoice 반환 | Must | trackings·prompts·engines | brand.org 경유 | BL-003 |
| **BL-005** | 측정 실패 엔진을 오류로 구분해 확인할 수 있다 | Tracking.errorMessage 채워지고 성공/실패 분리 표시 | Must | trackings | brand.org 경유 | BL-004 |
| **BL-006** | Clerk(Google/Kakao)로 로그인해 내 워크스페이스에 들어갈 수 있다 | 로그인 후 organizationId 매핑, 내 org 데이터만 조회 | Must | users·organizations | Clerk org 세팅 | — |
| **BL-007** | 같은 org 멤버만 서로의 브랜드·측정을 볼 수 있다(격리) | A-org 데이터가 B-org 계정에 0건(A/B 검증 통과) | Must | brands·trackings | ★앱레벨 org 스코핑 | BL-003·006 |
| **BL-008** | 브랜드 SoV를 대시보드에서 엔진별로 볼 수 있다 | 최근 Tracking 기준 엔진별 SoV 카드 렌더 | Must | trackings | brand.org 경유(읽기) | BL-004 |
| **BL-009** | 경쟁사와 내 브랜드 SoV를 나란히 비교할 수 있다 | 경쟁사별 SoV 표시(현 competitors JSON 기반) | Should | brands(competitors JSON) | org 스코핑 | BL-008 |
| **BL-010** | SoV 결과를 CSV로 내려받을 수 있다 | 대시보드 데이터 CSV 1파일 export | Should | trackings | org 스코핑 | BL-008 |

## Day04 발견에서 나온 기술 백로그 (Should/Could — Day05 편입)
| BL-ID | 제목 | 우선순위 | 근거 |
|---|---|---|---|
| BL-006-S | Tracking org 스코핑 헬퍼(brand 경유 강제) | Should | ERD/rls §위험1(격리 우회 방지) |
| BL-007-S | AuditJob ipAddress rate limit 실재 확인·보강 | Should | rls §위험3(비로그인 방어) |
| BL-009-C | competitors JSON→정규 테이블(경쟁사 SoV 시계열) | Could | ERD §3-1(BL-009 승격 시) |
| BL-NS | North Star 이벤트 스토어(action.executed·sov.delta) | Could🟡 | 실고객 검증 후(Day02/03 발견) |

## INVEST 점검
- **Small/Testable**: 각 항목 완료 기준 1줄·테스트 가능. "사용자 관리 시스템" 같은 큰 덩어리 없음(로그인=BL-006, 격리=BL-007로 분리).
- **Independent**: 선행만 표시, 병렬 가능한 건 분리.
- **Valuable**: 전부 PRD Must/Should에 직접 닿음(Non-Scope 기능 없음).
> Day05: 위 10 + 기술 4개 + 세부 태스크로 20개 확정 + TRD v1.
