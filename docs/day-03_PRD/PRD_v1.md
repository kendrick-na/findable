# PRD v1 — Findable (A-03-O1)

> KAIST OverEdge 2026 · Day03 · 2026-07-08 · Track A
> 근거: Day02 시장분석(A-02-O5 매핑) + 기존 docs/PRD.md 팩트. 블라인드 재검증 방식.
> ⚠️ Findable 스택 = Clerk 인증 + Neon+Prisma + Vercel + Mastra (커리큘럼 Supabase 전제를 치환)
> 표기: [확인사실]/[가정]/[확인필요]. PRD = "완벽한 문서" 아닌 "지금 아는 최선의 정의".

---

## 1. Goal

- **Target User**: 한국 시장을 노리는 브랜드의 마케팅/그로스 담당자. **1순위 = 외국 브랜드 한국법인 마케터**(Apple·SK-II·LV 등, ~3,500곳, 경쟁사 한국고객 0곳) + K-뷰티 글로벌 D2C(메디큐브·아누아).
- **Problem**: AI 검색(ChatGPT·Perplexity·HyperCLOVA 등)이 답변 생성 시 자사 브랜드를 인용하는지 **확인할 방법도, 인용되게 만들 방법도 없다.** 특히 외국법인은 본사가 "한국 AI 가시성"을 KPI로 강제하는데 측정 도구가 전무.
- **Value Proposition**: 글로벌 GEO 도구가 못 보는 **한국어 AI 엔진(HyperCLOVA·Naver·Daum)까지** 측정하고, "이번 주 뭘 할지" 액션까지 제시. 경쟁 미진입 한국 시장 선점.
- **Success Metrics** (성과지표 / 구현완료 분리):
  - *제품 성과지표*: 유료 ARR (현 PRD North Star). [가정] 🔍 Day02 재검토 제안 — "주간 실행 액션×SoV 상승"이 선행지표로 더 적합할 수 있음(미확정, 실고객 검증 후). 원 지표 유지.
  - *구현 완료 기준*: 무료 도메인 진단 1회 실행 → 7엔진 SoV 결과 1건 정상 반환 → PDF 1건 생성.
- **핵심 가정 1개**: **"한국 마케터가 AI 답변 인용(GEO)을 SEO와 별개의 지불 가치로 인식한다."** 이게 거짓이면 전체 성립 안 됨. (전체 리스크는 §5)

## 2. Scope

- **Must** (3~5개, 4주 1~2인 구현 가능량):
  1. 무료 도메인 진단 (로그인 없이 1회, 1p 결과)
  2. 7엔진 SoV 측정 1개 핵심 흐름 (한국어 3 + 글로벌 4)
  3. 인증 1개 흐름 (Clerk — Google/Kakao 로그인)
  4. 브랜드 SoV 대시보드 (측정 결과 표시)
- **Should**: 경쟁사 벤치마크 · 커스텀 프롬프트 · Citation Source · CSV export
- **Could**: 주간 액션 카드(읽기전용 추천) 🔍 Day02 발견 — 차별화가 액션에 있어 v1 포함 검토 대상(현재 Could)
- **Won't (v1)**: CMS 발행 · API/SSO · 결제 자동화 심화 · 모바일 앱 · B2B SaaS 세그먼트

## 3. Non-Scope

| 제외 항목 | 이유 | 다시 검토할 조건 |
|---|---|---|
| CMS 1클릭 발행(Cafe24·스마트스토어) | 워크플로 기능, 4주 초과 복잡도 | v1.5 (측정→개선 확장 시) |
| API·SSO | 엔터프라이즈용, 초기 고객 불필요 | Enterprise 계약 발생 시 |
| B2B SaaS 세그먼트 영업 | 워크플로 기능 선행 필요 | v1.5 |
| Naver Cue: 직접 스크래핑 | ToS 위반 법적 리스크 | 공식 제휴/합법 경로 확보 시 |

## 4. Constraints

| 항목 | 값 | 공식 문서 확인일 |
|---|---|---|
| 기간 | 4주 (v1) | — |
| 인력 | 1인(+AI 에이전트) | [확인사실] |
| 인증 | **Clerk** (Supabase Auth 아님) | 확인 필요 (Clerk pricing) |
| 데이터 | **Neon PostgreSQL + Prisma** (RLS 대신 앱레벨 권한+Clerk org) | 확인 필요 |
| 배포 | Vercel (Fluid Compute) | 확인 필요 |
| AI | Vercel AI Gateway(4 글로벌) + HyperCLOVA X·Naver·Daum 직접 | HyperCLOVA 가격 [확인필요] |
| 경쟁 가격(참고) | Otterly $29~489 | **2026-07-07 확인** ✅ |

> ⚠️ 커리큘럼은 Supabase Auth/RLS·Claude API 전제 → Findable은 Clerk+Neon+AI Gateway로 치환. 가격/한도는 각 공식 페이지 재확인 필요([확인필요]).

## 5. Risks · Assumptions

| 분류 | 위험 | 확률 | 영향 | 공개가능 | 완화 | 재확인 |
|---|---|---|---|---|---|---|
| 일정 | Must 과대 → 4주 초과 | 중 | 상 | 내부 | Must 4개로 제한, Could 이월 | Day05 |
| 기술 | GEO 진단 엔진 실동작 미검증(Day01 최대리스크) | 중 | 상 | 내부 | Day07 Vertical Slice로 end-to-end 검증 | Day07 |
| 보안 | 앱레벨 권한 누락 시 조직 간 데이터 노출(Clerk org 경계) | 중 | 상 | 내부 | Clerk org + Prisma 쿼리 스코핑 강제 | Day04 |
| 개인정보 | 실제 브랜드 진단 데이터 원문 노출 | 중 | 중 | 내부 | 더미 데이터만 사용 | 매일 |
| 비용 | HyperCLOVA X·AI Gateway 호출 비용 초과 | 중 | 중 | 내부 | 캐싱 + 저가 모델(HCX-DASH) | Day06 |
| 운영 | 1인 운영 병목 | 중 | 중 | 내부 | Mastra 에이전트 자동화 | Day14 |
| 데이터 | Naver Cue: 비공식 → 합성 정확도 한계 | 중 | 중 | 내부 | 공식 Search API+HyperCLOVA 합성(90%) | v1.5 |

**핵심 가정**: ①외국법인 지불의사 [확인필요] ②측정vs개선 지불지점 [확인필요] ③무료→유료 전환율 가정 [가정] ④GEO엔진 실동작 [확인필요, Day07]

## 6. 범위 판단표

| 기능 | MoSCoW | 예상시간 | 포함·제외 이유 | Day04 데이터 영향 |
|---|---|---|---|---|
| 무료 도메인 진단 | Must | 3일 | 콜드리드 진입점, North Star 유입 시작 | audit 엔티티 |
| 7엔진 SoV 측정 | Must | 5일 | 핵심 가치, 차별점(한국어 엔진) | measurement·engine 엔티티 |
| 인증(Clerk 1흐름) | Must | 2일 | 유료 전환 필수 | user·org(Clerk) |
| SoV 대시보드 | Must | 4일 | 측정 결과 표시=제품 실체 | dashboard 뷰 |
| 경쟁사 벤치마크 | Should | 3일 | 가치 크나 없어도 핵심흐름 성립 | competitor 엔티티 |
| 커스텀 프롬프트 | Should | 2일 | 고급 사용자용 | prompt 엔티티 |
| 주간 액션 카드 | Could | 4일 | 차별화 강하나 v1 범위압박(Day02 발견) | action 엔티티 |
| CSV export | Should | 1일 | Starter 티어 | — |
| CMS 발행 | Won't | — | 워크플로, 4주 초과 | (v1.5) |

> Must 4개 = 4주 1인 상한. 액션카드는 차별점이나 Could로 두고 Day05 백로그에서 v1 승격 재검토.

## 7. Day04 전달표

| 구분 | 내용 |
|---|---|
| **핵심 엔티티** | `user`(Clerk 연동) · `organization`(Clerk org, 워크스페이스) · `audit`(무료진단: domain·created_at·result_json) · `measurement`(engine·brand·sov_score·prompt·measured_at) · `brand`(name·domain·org_id) · `competitor`(brand_id·competitor_name) |
| **사용자 역할** | org owner / member (Clerk organization 역할). RLS 대신 **앱레벨: 모든 쿼리 org_id 스코핑** |
| **저장 데이터** | audit(도메인·결과JSON) · measurement(엔진별 SoV·프롬프트·시각) · brand·competitor |
| **권한 경계** | org member는 자기 org의 brand·measurement만 조회 · audit(무료)는 로그인 전이라 org 없음(익명·이메일만) · Clerk org_id로 데이터 격리 |
| **백로그 후보(Day05)** | 액션카드 v1 승격 검토 · 경쟁사 벤치마크 · CSV export · North Star 이벤트 로깅 |
| **측정 이벤트** | `audit.completed` · `measurement.created` · `plan.upgraded`(전환) · (제안)`action.executed`·`sov.delta`(North Star 재검토 시) |

> 🔍 **[Day04 재검토 — 실제 스키마 대조 정정]**: 위 6엔티티(추상)는 실제 `schema.prisma`와 이름·구조가 다르다. [확인사실] `measurement`→**Tracking**, `audit`→**AuditJob**, `competitor`→**Brand.competitors JSON**(테이블 아님). 전달표가 누락한 실제 모델 4개: **Prompt·Engine·Report·Lead**. `measurement.created`→`tracking.created`로 정정. (North Star 제안 이벤트 `action.executed`·`sov.delta`는 **저장할 모델 없음** → 확정 시 스키마 선행 필요, 미확정 유지.) 상세 = [[day-04_ERD/ERD]] §1.2.