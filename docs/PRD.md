# Findable PRD — Product Requirements Document

**버전**: v1.1
**작성일**: 2026.04.30 (v1.0) → 2026.05.01 (v1.1, D-011~D-019 반영)
**작성자**: 나현덕 (인디고차일드 대표) + Claude
**상태**: 작성 중 (v1.1)

---

## 📑 목차

- [Part A. 제품 정의](#part-a-제품-정의)
  - 1. Vision & Problem Statement
  - 2. 제품 본질·포지셔닝
  - 3. 4-Way 시장 매트릭스 (ICP)
  - 4. North Star Metric & KPI
- [Part B. 기능 스펙](#part-b-기능-스펙)
  - 5. v1.0 필수 기능 7개
  - 6. v1.5 로드맵 (워크플로 확장)
  - 7. v2.0 로드맵 (영문 글로벌)
  - 8. Out of Scope (명시 제외)
- [Part C. 기술 설계](#part-c-기술-설계)
  - 9. 시스템 아키텍처
  - 10. 데이터 모델
  - 11. API 설계
  - 12. 기술 스택 확정
- [Part D. UI/UX](#part-d-uiux)
  - 13. 화면 인벤토리
  - 14. 핵심 인터랙션 플로우
  - 15. 디자인 시스템
- [Part E. 운영](#part-e-운영)
  - 16. 배포·인프라
  - 17. 모니터링·로깅
  - 18. 비용·SLA
  - 19. 보안·법적 컴플라이언스
- [Part F. 일정·영업](#part-f-일정영업)
  - 20. 5일 개발 일정 (Day-by-Day)
  - 21. 위험·완화 전략
  - 22. 영업 전략 (4-Way ICP)
  - 23. 자금·비용 계획

---

# Part A. 제품 정의

## 1. Vision & Problem Statement

### 1.1 한 줄 정의
> **Findable은 한국어와 영어 AI 답변 속에서 모든 브랜드의 가시성을 측정·관리하는 플랫폼이다.**
> *Korean & English AI Search Visibility Platform*

### 1.2 Vision 2028
2028년, 한국어·영어 AI 검색을 모두 다루는 표준 GEO 플랫폼으로, 한국 시장에서 활동하는 모든 브랜드(한국 브랜드와 한국 진출 외국 브랜드 양쪽)가 AI 검색 가시성을 측정할 때 가장 먼저 떠올리는 도구가 된다.

### 1.3 Problem Statement

**거시 문제**:
- 검색 시장이 SEO에서 GEO로 구조적으로 전환 중 (Gartner: 전통 검색 -25% by 2026, AI Referral +357% YoY)
- 글로벌 GEO 시장은 $1.01B → $17.02B (2034) CAGR 45.5%
- a16z 공식 테제 "GEO over SEO" (2025.05), Profound 첫 GEO 유니콘 ($1B, 2026.02)

**한국 시장 특수 문제**:
1. **한국어 AI 검색 추적 도구 부재** — Profound·Peec·Bluefish·AthenaHQ·HubSpot AEO 등 글로벌 GEO 도구는 모두 한국어 AI 엔진(HyperCLOVA X·Naver·Daum·네이버 AI Briefing) 미커버 <!-- [확인사실 2026-07-22] Cue:는 종료(2026-04-09)되어 목록에서 제외, 현행 AI Briefing으로 교체 -->
2. **한국 브랜드의 영어 AI 노출 갭** — 영문 ChatGPT가 K-브랜드를 누락·오인용 (Medicube, 마뗑킴, Channel Talk 등)
3. **한국 진출 외국 브랜드의 한국어 AI 가시성 측정 도구 0건** — Apple Korea·LV·Tesla 등의 한국 마케팅팀이 본사 보고용 KPI를 만들 수 없음
4. **한국 GEO SaaS 기관 투자 0건** (2026.04 웹 검증) — 시장 선점 공백

### 1.4 Why Now
- AI 검색 사용자: 한국 ChatGPT 1,500만+ (2025.10), Perplexity 200~300만 (SK Telecom 무료 제공)
- 네이버 검색 점유율 64.39% + HyperCLOVA X·네이버 AI Briefing·Kakao i 한국 자체 AI 엔진 본격 출시 <!-- [확인사실 2026-07-22] Naver Cue:는 종료(2026-04-09), 현행 답변 표면은 AI Briefing(하이퍼클로바X 기반) -->
- 정부 2026 AI 예산 10.1조 원, SaaS 1만 개 육성 정책

---

## 2. 제품 본질·포지셔닝

### 2.1 카테고리 (D-011 업데이트)
**한국 최초 Agentic GEO Platform**

> Bluefish AI "Agentic Marketing Platform" 카테고리 선점 패턴 차용. Sierra ($10B / $150M ARR = 66x), Decagon ($4.5B / $35M ARR = 128x) 등 Agentic 회사는 일반 SaaS 대비 10~20배 멀티플 프리미엄. VC 피칭 키워드: Agentic GEO Platform · Multi-agent orchestration · Autonomous content optimization · Tool-use & function calling · Outcome-based pricing · Agent Experience Layer · K-Brand AI Discovery Infrastructure.

### 2.2 슬로건 (D-016 — D-010 변경)

**Hero 메인**: **"AI는 우리 브랜드를 추천하고 있나요?"**
*Is AI recommending your brand?*

**Hero 서브**: "ChatGPT · HyperCLOVA · Perplexity · 네이버 · Claude · 다음 · Gemini — 한국어·영어 7개 AI 답변에서 우리 브랜드의 위치를 추적합니다."

**Hero CTA**: "[무료 진단 받기 (3분)] · [전문가 상담 예약]"

**Footer/About 비전 (한국어)**:
> "AI에 의해 발견되는 브랜드, AI에 의해 잊혀지는 브랜드.
> 경쟁사 말고 우리 브랜드를, AI가 먼저 답하게."

**Vision (English)**:
> "Brands AI finds. Brands AI forgets. Make AI answer with you. Not your competitor."

**VC 피칭**:
> "Princeton KDD'24 GEO + ICLR'26 AutoGEO + 26.6k stars GPT Researcher 백본 + 한국 K-뷰티 독점 데이터 모트 위에 4 자율 에이전트가 작동하는 한국 최초 Agentic GEO Platform"

### 2.3 Findable이 아닌 것 (Anti-Positioning)
- ❌ AI 콘텐츠 자동 생성 도구 (Jasper·Copy.ai 함정)
- ❌ 범용 멀티 에이전트 플랫폼 (Lindy 함정)
- ❌ SEO 도구의 확장판 (Ahrefs·Semrush의 add-on)
- ❌ "K-브랜드 글로벌 진출 전용" — 한국 진출 외국 브랜드도 핵심 ICP

### 2.4 차별화 핵심 (USP 6 — Agentic 추가)
1. **한국 AI 엔진 독점 커버리지** — HyperCLOVA X · Naver 검색(+AI Briefing) · Daum (3개) <!-- [확인사실 2026-07-22] "Cue: 합성"→AI Briefing. Cue:는 종료(2026-04-09), 현행 답변 표면 추적 -->
2. **Korean Entity Grounding** — 한/영/혼용 표기 통합 추적 (Ahrefs Brand Radar 한국어 버전 세계 최초)
3. **한국어 + 영어 동시 7개 엔진** — Profound 9개·Peec 3개·HubSpot 3개 모두 영어만
4. **무료 한국어 Audit** — 한국어 도메인·인용 분석은 Findable이 유일
5. **가격 경쟁력 (엔터프라이즈 구간)** — Profound $99·AthenaHQ $295 대비 Findable ₩99K(~$70). 단 저가 진입은 Otterly Lite $29 등 더 저렴한 곳 있음 → **"최저가"가 아니라 "한국어 커버리지 대비 합리적 가격"으로 포지셔닝**. 가격은 USP 후순위, 한국어 독점(1번)이 1순위. <!-- Day02 재검증(2026-07-07): "1/3 가격"은 전 구간 아님, Otterly $29 반례. docs/day-02_시장분석 §6-2 -->
6. **4 자율 에이전트 (Agentic)** — 민지·Alex·수진·준호가 측정→인용 분석→액션 추천을 자동 실행. 측정만 하는 모니터링 도구가 아닌 "행동하는 GEO 플랫폼".

---

## 3. 4-Way 시장 매트릭스 (ICP)

|  | 한국어 AI | 영어 AI |
|---|---|---|
| **한국 브랜드** | ✅ 한국 D2C·내수 (6,500사) | ✅ K-뷰티·K-패션 글로벌 (650사) |
| **해외 브랜드** | ✅ ⭐ **블루오션** — Apple·Tesla·LV 한국 마케팅팀 (3,500사) | ⏸ Profound 영역 — Findable v2.0+ |

**총 잠재 고객 (v1.0~v1.5)**: 약 10,650사 / **TAM ₩1,375억**

### 3.1 ICP 우선순위 (영업 채널·결제 사이클)

| 순위 | ICP | 시장 규모 | 영업 채널 | 첫 결제 사이클 |
|---|---|---|---|---|
| 🥇 1 | **글로벌 진출 K-뷰티 D2C** (메디큐브·아누아·조선미녀·라운드랩) | 300사 | 인바운드(PLG) + KOTRA·Cafe24 | 2~6주 |
| 🥈 2 | **한국 진출 외국 브랜드 마케팅팀** (Apple·LV·Tesla·SK-II·Zara Korea) | 3,500사 | 아웃바운드 + 한국 광고 에이전시 파트너 | 4~8주 |
| 🥉 3 | **한국 내수 D2C** (무신사·29CM·올리브영 입점) | 6,500사 | 아웃바운드 + 콘텐츠 마케팅 | 4~12주 |
| 4 | **글로벌 진출 K-패션·K-콘텐츠** (마뗑킴·MUSINSA Global·Studio Dragon) | 350사 | 인바운드 + 미디어 | 4~8주 |
| 5 | **한국 의료·교육·금융 이노랩** | 1,500사 | 아웃바운드 (개별 미팅) | 8~16주 |
| ⏸ v1.5+ | **글로벌·내수 B2B SaaS** | 700사 | 워크플로 기능(CMS·Brand Guardrails) 출시 후 | - |

> 🔍 **[Day02 재검토 제안 — 미확정]** (docs/day-02_시장분석 §6-3)
> 2순위 **외국 브랜드 한국법인**은 본사가 "한국 AI 가시성"을 KPI로 강제 + 경쟁사 한국 고객 0곳(uncontested) → **강제 수요가 가장 강함**.
> K-뷰티(1순위)는 인바운드가 쉬우나 강제성은 외국법인이 우위. 세일즈 1·2순위 재고려 가치. ⚠️ 실영업 데이터로 검증 후 확정.

### 3.2 명시적 비추천 (v1.0)
- 한국 대기업 (삼성·LG·현대) — Bluefish 자리, RFP 6개월+
- 국내 내수 SaaS — 시장 인지도 낮음
- K-푸드 (Bibigo·신라면) — 페인 약함 (이미 1위)

---

## 4. North Star Metric & KPI

### 4.1 North Star Metric (NSM)
**Paid ARR (유료 연간 반복 매출)**

> 🔍 **[Day02 재검토 제안 — 미확정]** (2026-07-07, docs/day-02_시장분석 §6-1)
> Paid ARR은 *결과지표*(lagging). 고객이 실제로 값을 얻는지 보여주는 *선행지표*가 North Star로 더 적합할 수 있음.
> 제안: **North Star = "주간 실행 액션 수 × SoV 상승"**(`action.executed`×`sov.delta`), Paid ARR은 사업 목표로 분리.
> 근거: Profound가 "측정만" 제공해 고객 ROI -2.0x. Findable 차별점(Agentic 개선)과 정렬.
> ⚠️ 방향 결정이라 실고객 검증 후 확정. 지금은 제안만 기록 (원 NSM 유지).

### 4.2 단계별 KPI

| 단계 | 시기 | KPI 목표 |
|---|---|---|
| v1.0 베타 출시 | 2026.05.04 | 무료 Audit 100건 / 첫 결제 1건 (1주 내) |
| 베타 1개월 | 2026.06.04 | 무료 Audit 1,000건 / 유료 10사 (₩1M ARR) |
| 베타 3개월 | 2026.08.04 | Audit 5,000건 / 유료 50사 (₩6M ARR) |
| 6개월 (정식 출시) | 2026.11.04 | 유료 100사 (₩15M ARR) |
| 12개월 | 2027.05.04 | 유료 300사 (₩60M ARR) |
| 24개월 | 2028.05.04 | 유료 1,000사 (₩300M ARR) |

### 4.3 보조 KPI

| 카테고리 | 지표 | 목표 |
|---|---|---|
| **Acquisition** | findable.co.kr/audit DAU | 50/일 (1개월), 500/일 (6개월) |
| **Activation** | Audit 완료율 (이메일 등록 → PDF 다운로드) | 60%+ |
| **Conversion** | Audit → 14일 트라이얼 시작률 | 15%+ |
| **Conversion** | 14일 트라이얼 → 유료 전환율 | 25%+ |
| **Retention** | 월간 이탈율 (Churn) | 5% 미만 |
| **Revenue** | NRR (Net Revenue Retention) | 110%+ |
| **NPS** | 분기별 NPS | 40+ |

---

# Part B. 기능 스펙

## 5. v1.0 필수 기능 7개

### 5.1 [F1] 무료 도메인 Audit ⭐ 콜드 영업 핵심 무기

**User Story**:
> 한국 브랜드 마케터로서, 도메인을 입력하면 즉시 7개 AI 엔진에서 우리 브랜드가 어떻게 노출되는지 1페이지 PDF 리포트를 받고 싶다.

**Acceptance Criteria**:
- 비로그인 상태에서 이메일만 입력 → 도메인 입력 → 30초~3분 내 PDF 다운로드
- PDF 1페이지 구성: SoV 점수(7개 엔진 평균) · 경쟁사 대비 순위 · Top 3 개선 추천
- PDF 한국어 (영문 옵션은 v1.5)
- 이메일 자동 발송 (Resend) → CRM에 리드 등록
- 도메인 1개 무료, 추가 도메인은 회원가입 유도

**기술 흐름**:
1. 도메인 입력 → DB에 잡 큐 등록 (Vercel Queues)
2. 4 글로벌 엔진 (AI Gateway) + 3 한국 엔진 (CLOVA · Naver Search · Daum) 병렬 호출
3. CrewAI 4 에이전트 분석 (10분 → 1페이지 빠른 모드는 30초)
4. PDF 생성 (`@vercel/og` + Puppeteer) → Vercel Blob Public 업로드
5. 이메일 + 화면 다운로드

**5일 구현 우선순위**: Day 2 (5/1)

### 5.2 [F2] 7개 엔진 동시 추적 (Multi-Market AI Tracker)

**User Story**:
> 마케터로서, 우리 브랜드가 한국어와 영어 AI 답변에서 어떻게 노출되는지 한 화면에서 비교하고 싶다.

**Acceptance Criteria**:
- 7개 엔진 동시 호출: ChatGPT · Claude · Perplexity · Gemini · HyperCLOVA X · Naver · Daum
- 좌우 비교 뷰: "한국어 AI" 4개 vs "영어 AI" 4개 (혹은 사용자 선택)
- 각 엔진별 응답에 우리 브랜드 언급 여부·순위·인용 소스 추출
- 응답 시간: 평균 < 3초 (Vercel Queues 비동기 처리)

**기술 흐름**:
- AI Gateway: 글로벌 4개 (`openai/gpt-5.4`, `anthropic/claude-sonnet-4-7`, `perplexity/sonar`, `google/gemini-2.0`)
- HyperCLOVA X: 직접 fetch (`HCX-DASH-002`)
- Naver Search API: 검색 결과 + HyperCLOVA X 합성 (네이버 AI Briefing 응답 근사) <!-- [확인사실 2026-07-22] "Cue: 90% 재현"은 종료된 엔진 기준이라 무의미. Cue:는 2026-04-09 종료, 현행 추적 대상은 AI Briefing(하이퍼클로바X 기반) -->
- Daum 검색 API: 결과 fetch

**5일 구현 우선순위**: Day 2 (5/1)

### 5.3 [F3] Brand Sentiment + Share of Voice 대시보드

**User Story**:
> 마케팅 매니저로서, 우리 브랜드의 AI 검색 가시성을 시간 흐름·경쟁사 비교로 보고 임원에게 보고하고 싶다.

**Acceptance Criteria**:
- 메인 대시보드 1장에 표시:
  - SoV 점수 (0~100, 7개 엔진 가중 평균)
  - 시계열 그래프 (일별·주별·월별)
  - 경쟁사 비교 (3~5개 브랜드)
  - Sentiment 분포 (긍정·중립·부정 %)
- 데이터 새로고침: 일 1회 자동 (Vercel Cron) + 수동 새로고침 버튼

**5일 구현 우선순위**: Day 3 (5/2)

### 5.4 [F4] Custom Prompt + 자동 추천

**User Story**:
> 마케터로서, 우리 브랜드 카테고리에 맞는 검색 프롬프트를 자동 추천받고, 직접 추가도 하고 싶다.

**Acceptance Criteria**:
- 도메인 입력 → AI가 30~50개 프롬프트 자동 생성 (한국어 + 영어)
- 사용자가 직접 추가·삭제 가능
- 플랜별 한도: Starter 30 / Growth 150 / Scale 500
- 한국어 프롬프트는 한국어 AI 엔진에, 영어 프롬프트는 영어 AI 엔진에 자동 라우팅

**5일 구현 우선순위**: Day 3 (5/2)

### 5.5 [F5] 경쟁사 벤치마크 (3~5개 비교)

**User Story**:
> 마케터로서, 우리 브랜드와 직접 경쟁사 3~5개를 같은 프롬프트로 비교하고 싶다.

**Acceptance Criteria**:
- 사용자가 경쟁사 도메인 3~5개 직접 입력 또는 AI 자동 추천
- 동일 프롬프트로 7개 엔진 동시 호출 → 비교 표·차트
- 한국 vs 글로벌 좌우 비교 뷰 (한국 경쟁사 vs 미국 경쟁사 등)

**5일 구현 우선순위**: Day 3 (5/2)

### 5.6 [F6] Citation Source + 도메인 권위 점수

**User Story**:
> 마케터로서, AI가 우리 브랜드 답변할 때 어떤 출처를 인용하는지 알고 콘텐츠 전략에 반영하고 싶다.

**Acceptance Criteria**:
- 각 답변의 인용 URL 추출 → 도메인별 집계
- 한국 인용 가중치: 네이버 블로그·카페·티스토리·브런치·디시·강남언니 등
- 영어 인용: Reddit·Quora·Wikipedia·Amazon Reviews 등
- 도메인 권위 점수 (자체 산식 + Ahrefs DR 외부 API 옵션)

**5일 구현 우선순위**: Day 4 (5/3)

### 5.7 [F7] CSV/엑셀 Export (Starter부터)

**User Story**:
> 마케터로서, Findable 데이터를 다운로드해서 PPT 보고서에 넣고 싶다.

**Acceptance Criteria**:
- 모든 표·차트 데이터를 CSV/엑셀 1-click 다운로드
- 한국어 헤더 (CP949 + UTF-8 BOM 호환)
- Starter 플랜부터 무료 (Profound·Peec는 상위 티어부터)

**5일 구현 우선순위**: Day 4 (5/3)

---

## 6. v1.5 로드맵 (2026.Q4)

### 6.1 [F8] AI Referral 트래픽 추적
- GA4 연동 → ChatGPT/Perplexity 등 AI 엔진에서 자사 사이트로 들어온 트래픽 분리 추적
- Profound Agent Analytics 패턴

### 6.2 [F9] CMS 네이티브 발행
- 자동 진단 결과의 액션 추천을 클릭 1회로 적용
- Cafe24 / 네이버 스마트스토어 / WordPress / Webflow OAuth 통합
- AirOps 패턴 (Greylock $40M)

### 6.3 [F10] Brand Guardrails 감사
- AI 엔진이 우리 브랜드 톤앤매너 가이드라인을 준수하는지 자동 감사
- Writer.com 패턴 ($1.9B)

### 6.4 [F11] B2B SaaS 영업 본격 진입
- 워크플로 기능 추가 후 채널톡·Sendbird·Moloco 등 영업 가동

### 6.5 [F12] 네이버 AI Briefing 정식 추적
<!-- 🔍 [2026-07-22 재검토] Naver Cue: 종료(2026-04-09) → 추적 대상을 현행 AI Briefing(하이퍼클로바X 기반)으로 교체. 로드맵 방향(정식 추적)은 유지. [확인사실] -->
- 대상: 네이버 AI Briefing (구 Cue:는 종료됨)
- 네이버 파트너 신청 또는 합법 스크래핑 (Vercel Sandbox)

---

## 7. v2.0 로드맵 (2027.Q2)

### 7.1 영문 글로벌 진출
- 도메인 리브랜딩 (findableapp 상표 충돌 회피)
- 일본·동남아·미국 시장 진출
- Profound·Peec 영역 진출 (영어 AI 검색 시장)

### 7.2 일본·동남아 AI 엔진 통합
- Rinna · SAKANA (일본)
- 현지 LLM (인도네시아·베트남·태국)

### 7.3 Agentic Commerce
- Shopify·Cafe24 연동 "AI 답변 → 구매" 컨버전 트래킹

---

## 7.5 학습 데이터셋 활용 (D-019, 2026.05.01 리서치 반영)

GEO 추천 엔진과 평가 프레임의 데이터 백본. 상세는 `docs/inputs/08_research_G_training_datasets.md` 참조.

### 7.5.1 v1.0 즉시 통합 (상업 사용 안전, 7개)
| 우선 | 데이터셋 | 활용 |
|---|---|---|
| 1 | **GEO-Bench (Princeton KDD'24, Apache 2.0)** | 추천 엔진 효과 측정 표준 — 10K queries 9개 도메인 |
| 2 | **AutoGEO E-commerce + Researchy-GEO (ICLR'26, MIT)** | AutoGEOAPI 룰셋 한국어 번역 → v1.0 자동 추천 엔진 base. K-뷰티 SKU 직결 |
| 3 | **Common Crawl cdx index (Free)** | 고객 도메인 LLM 학습 풀 진입 여부 즉시 점수화 — Audit 1차 시그널 |
| 4 | **한국어 위키백과 dump (CC BY-SA 4.0)** | 고객 한국어 위키 존재 검증 + 자동 위키 콘텐츠 제안 |
| 5 | **KLUE Benchmark (CC BY-SA 4.0)** | 한국어 브랜드 추출기 정확도 평가 베이스 |
| 6 | **FineWeb v1.4.0 (ODC-By 1.0)** | Llama3·OLMo 학습 풀 URL 매칭 — 인용 가능성 실측 |
| 7 | **BOLD (Amazon Science, CC BY-SA 4.0)** | LLM 브랜드 톤·편향 측정 모듈 (v1.3) |

### 7.5.2 GEO 추천 엔진 룰베이스 (Princeton 8 strategies)
- Cite Sources / Quotation Addition / Statistics Addition (이 3개가 +40% visibility)
- Authoritative / Fluency / Easy-to-Understand / Unique Words / Technical Terms
- 한국어 적응 후 Findable 자동 추천 엔진 v1.0 룰셋으로 사용

### 7.5.3 합법성 가드레일
- **NAVER Search API**: 일 25K 콜, 콘텐츠 재배포 금지 — 메트릭만 표시. 고객 본인 브랜드 검색만 허용
- **Reddit Data API**: 2024년 유료화. r/AsianBeauty·r/SkincareAddiction 시그널은 v1.4 K-뷰티 전문 플랜에서 정식 계약 후 활성화
- **Amazon Reviews 2023**: 메트릭 집계 형태로만 출력 (별도 계약 권장)
- **DC/클리앙/뽐뿌·네이버 블로그·카페 직접 크롤 일체 금지** (ToS 위반 + 민법 750조 리스크)
- **The Pile Books3 부분 사용 금지** (저작권 분쟁)

### 7.5.4 한국어 GEO 시장의 구조적 격차 (전략적 함의)
- GPT-3 한국어 비율 = **0.017%**, Llama2 = 0.06% — 영문 대비 50배 좁은 학습 풀
- HyperCLOVA X만 한국어 6,500배 더 학습 (NAVER 자사 데이터, 외부 비공개)
- → 영문 LLM GEO ≠ 한국어 LLM GEO. 두 시장은 **완전히 다른 문제**
- → Findable이 "한국어 GEO" 카테고리 독점 가능. Princeton·AutoGEO 알고리즘의 한국어 적응이 직접적 moat

---

## 8. Out of Scope (명시 제외)

| # | 기능 | 사유 | 보유 경쟁사 |
|---|---|---|---|
| 1 | AI 콘텐츠 자동 생성 | Jasper $1.5B → 20% 삭감 함정 | Profound Actions |
| 2 | 범용 멀티 에이전트 플랫폼 | Lindy 함정. GEO 버티컬 집중 | /dev/agents |
| 3 | API 외부 공개 + SSO (v1.0) | Enterprise 영업 전 단계 | 전 경쟁사 Enterprise |
| 4 | Profound 미국 가격 복제 | 한국 엔진 독점 프리미엄으로 차별화 | - |
| 5 | 풀 엔터프라이즈 SDR 조직 | PLG 우선, 5개 레퍼런스 전엔 금지 | - |
| 6 | SOC 2 Type II 초기 인증 | 글로벌 진출 시점까지 연기 | - |
| 7 | 자체 크롤러 인프라 | SerpAPI·Firecrawl로 우회 | - |
| 8 | 네이버 AI Briefing 직접 스크래핑 (v1.0) | 약관 위반·민법 750조 리스크 (구 Cue:는 종료됨) | - |

---

# Part C. 기술 설계

## 9. 시스템 아키텍처

### 9.1 Top-level 다이어그램

```
                    ┌────────────────────────┐
                    │  사용자 (Marketer)     │
                    │  findable.co.kr        │
                    └───────────┬────────────┘
                                │
                    ┌───────────▼────────────┐
                    │  Next.js 16 App Router │
                    │  (Vercel Fluid Compute)│
                    │  - (marketing) SSG     │
                    │  - (app) Cache Comp.   │
                    │  - proxy.ts (인증)     │
                    └───────────┬────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐    ┌─────────▼────────┐    ┌─────────▼────────┐
│ Clerk          │    │ Neon Postgres    │    │ Vercel Queues    │
│ (인증·SSO)     │    │ (Drizzle ORM)    │    │ (엔진 호출 분산) │
└────────────────┘    └──────────────────┘    └─────────┬────────┘
                                                        │
                              ┌─────────────────────────┴─────────────────────────┐
                              │                                                   │
                ┌─────────────▼─────────────┐                       ┌─────────────▼─────────────┐
                │ AI Gateway (Vercel)       │                       │ 한국 엔진 (직접 호출)     │
                │ - openai/gpt-5.4          │                       │ - HyperCLOVA X            │
                │ - anthropic/claude-sonnet │                       │ - Naver Search API        │
                │ - perplexity/sonar        │                       │ - Daum Search API         │
                │ - google/gemini-2.0       │                       └───────────────────────────┘
                └───────────────────────────┘

                ┌──────────────────────────────────────────────────┐
                │           CrewAI 4 에이전트 워크플로             │
                │  민지 (한국 GEO) · Alex (US 벤치마크)            │
                │  수진 (Citation 분석) · 준호 (Action 추천)        │
                └──────────────────────────────────────────────────┘
                                          │
                ┌─────────────────────────┴─────────────────────────┐
                │                                                   │
       ┌────────▼─────────┐                                ┌────────▼─────────┐
       │ Pinecone         │                                │ Vercel Blob      │
       │ (Korean Entity   │                                │ (PDF 리포트)     │
       │  Grounding 임베딩)│                                │                  │
       └──────────────────┘                                └──────────────────┘

       ┌────────────────────────────────────────────────────────────┐
       │               결제·이메일·모니터링                          │
       │  Toss Payments · Resend · Sentry · Vercel Analytics        │
       └────────────────────────────────────────────────────────────┘
```

### 9.2 핵심 흐름 (예: 무료 Audit)

```
1. 사용자 → findable.co.kr/audit
2. 이메일 + 도메인 입력 → POST /api/audit
3. Audit 잡 생성 → Vercel Queues 적재
4. Worker 함수 실행:
   a. 도메인에서 브랜드명·산업 자동 추출
   b. 30개 프롬프트 자동 생성 (한국어 15 + 영어 15)
   c. 7개 엔진 병렬 호출 (Promise.allSettled)
   d. CrewAI 빠른 모드: 30초 분석
   e. PDF 1페이지 생성 (@vercel/og + Puppeteer)
   f. Vercel Blob Public 업로드 → URL 반환
5. Resend 이메일 자동 발송 + 화면에 다운로드 링크
6. 리드 정보 Postgres 저장 (CRM)
```

---

## 10. 데이터 모델 (Drizzle ORM 스키마)

```ts
// packages/db/schema.ts
import { pgTable, text, integer, timestamp, jsonb, real, boolean, uuid, primaryKey } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),  // Clerk user_id
  email: text('email').notNull().unique(),
  name: text('name'),
  organizationId: uuid('organization_id'),
  plan: text('plan').notNull().default('free'),  // free, starter, growth, scale, enterprise
  createdAt: timestamp('created_at').defaultNow(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  plan: text('plan').notNull().default('free'),
  billingCustomerId: text('billing_customer_id'),  // Toss billing key
  createdAt: timestamp('created_at').defaultNow(),
});

export const brands = pgTable('brands', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  industry: text('industry'),  // beauty, fashion, food, b2b_saas, content_ip, ...
  language: text('language').notNull().default('ko'),  // ko, en, both
  competitors: jsonb('competitors').$type<{ name: string; domain: string }[]>().default([]),
  entityVariants: jsonb('entity_variants').$type<string[]>().default([]),  // Korean Entity Grounding
  createdAt: timestamp('created_at').defaultNow(),
});

export const prompts = pgTable('prompts', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandId: uuid('brand_id').notNull(),
  text: text('text').notNull(),
  language: text('language').notNull(),  // ko, en
  category: text('category'),  // best_in_category, alternative, comparison, ...
  isAutoGenerated: boolean('is_auto_generated').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const engines = pgTable('engines', {
  id: text('id').primaryKey(),  // chatgpt, claude, perplexity, gemini, hyperclova, naver, daum
  name: text('name').notNull(),
  provider: text('provider').notNull(),  // openai, anthropic, perplexity, google, naver, kakao
  language: text('language').notNull(),  // ko, en, both
  isActive: boolean('is_active').default(true),
});

export const trackings = pgTable('trackings', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandId: uuid('brand_id').notNull(),
  promptId: uuid('prompt_id').notNull(),
  engineId: text('engine_id').notNull(),
  rawResponse: text('raw_response'),
  brandMentioned: boolean('brand_mentioned').default(false),
  mentionPosition: integer('mention_position'),  // 1, 2, 3, ...
  sentiment: text('sentiment'),  // positive, neutral, negative
  citedSources: jsonb('cited_sources').$type<{ url: string; domain: string; title?: string }[]>().default([]),
  trackedAt: timestamp('tracked_at').defaultNow(),
});

export const reports = pgTable('reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  brandId: uuid('brand_id').notNull(),
  type: text('type').notNull(),  // free_audit, weekly, monthly, custom
  pdfUrl: text('pdf_url'),
  data: jsonb('data'),
  generatedAt: timestamp('generated_at').defaultNow(),
});

export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  domain: text('domain'),
  source: text('source'),  // free_audit, contact_form, ...
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## 11. API 설계

### 11.1 라우트 인벤토리

| 라우트 | 메서드 | 설명 | 인증 |
|---|---|---|---|
| `/api/audit` | POST | 무료 Audit 시작 | 없음 (이메일만) |
| `/api/audit/[jobId]` | GET | Audit 상태·결과 폴링 | 없음 |
| `/api/brands` | GET, POST | 브랜드 CRUD | 인증 필수 |
| `/api/brands/[id]` | GET, PATCH, DELETE | 단일 브랜드 | 인증 필수 |
| `/api/brands/[id]/track` | POST | 즉시 추적 트리거 | 인증 필수 |
| `/api/engines/[engine]/query` | POST | 단일 엔진 호출 (내부) | 인증 필수 |
| `/api/reports` | GET | 리포트 목록 | 인증 필수 |
| `/api/reports/[id]/export` | GET | CSV/엑셀 다운로드 | 인증 필수 |
| `/api/crew/diagnose` | POST | CrewAI 4 에이전트 진단 | 인증 필수 |
| `/api/webhooks/toss` | POST | Toss 결제 웹훅 | 서명 검증 |
| `/api/webhooks/clerk` | POST | Clerk 사용자 이벤트 | 서명 검증 |
| `/api/cron/daily-tracking` | GET | 일일 자동 추적 | Cron 시크릿 |
| `/api/cron/weekly-report` | GET | 주간 리포트 자동 발송 | Cron 시크릿 |

### 11.2 무료 Audit 응답 스키마

```ts
type AuditRequest = {
  email: string;
  domain: string;
  industry?: string;
  language?: 'ko' | 'en' | 'both';  // default: 'both'
};

type AuditResponse = {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  pdfUrl?: string;  // completed 상태일 때만
  result?: {
    sov: number;  // 0~100
    enginesCovered: string[];
    competitorComparison: Array<{
      brand: string;
      sov: number;
      rank: number;
    }>;
    topRecommendations: string[];  // 3개
  };
};
```

---

## 12. 기술 스택 확정

| 영역 | 선택 | 비고 |
|---|---|---|
| **프레임워크** | Next.js 16 App Router | App Router · Server Components · Cache Components |
| **언어** | TypeScript 5.x | 엄격 모드 |
| **모노레포** | Turborepo + pnpm workspaces | apps/web + packages/{core,db,ui} |
| **UI** | shadcn/ui + Tailwind CSS 4 | 빠른 개발 |
| **인증** | Clerk (Google·카카오·네이버·이메일 4종) | 네이버는 Custom OAuth Provider (D-012) |
| **결제** | Toss + PayPal Business + Wire Transfer | Toss(한국) + PayPal(글로벌 카드) + Wire(Enterprise) (D-013) |
| **알림** | Resend (이메일) + 카카오톡 비즈니스 채널 | 한국 마케터 retention 강화 (D-018) |
| **LLM 가시성 측정** | Stagehand (browserbase/stagehand, 22.3k stars) | TypeScript 기반 LLM 자동화 — v1.0 백본 (D-017) |
| **콘텐츠 리서치 에이전트** | GPT Researcher (assafelovic, 26.6k stars) | Python 마이크로서비스, Inngest가 호출 (D-017) |
| **GEO 알고리즘** | Princeton KDD'24 GEO + ICLR'26 AutoGEO | 한국어 버전 자체 구현, VC 피칭 핵심 무기 (D-017) |
| **에이전트 오케스트레이션** | Mastra.ai (TS, 22k stars, YC W25) | Vercel CEO 투자, 백엔드 워커 |
| **백그라운드 잡** | Inngest | 7 엔진 호출·CrewAI·GPT Researcher 트리거 |
| **개발 도구** | gstack (Garry Tan YC CEO, 87.2k stars) | Claude Code 23인 가상팀 — 5일 압축 개발 가속 (제품 외부) |
| **DB** | Neon Postgres + Drizzle ORM | Vercel Marketplace |
| **Vector DB** | Pinecone | Korean Entity Grounding 임베딩 |
| **AI** | AI SDK v6 + Vercel AI Gateway | 4 글로벌 엔진 통합 |
| **한국 엔진** | 직접 fetch (CLOVA Studio · Naver Search · Daum) | Gateway 미지원 |
| **큐** | Vercel Queues (Public Beta) | 7 엔진 부하 분산 |
| **이메일** | Resend | Vercel Marketplace |
| **PDF 생성** | `@vercel/og` + Puppeteer | Audit 리포트 |
| **파일 저장** | Vercel Blob | Public/Private 분리 |
| **에러 모니터링** | Sentry | Vercel Marketplace |
| **분석** | Vercel Analytics + Speed Insights | 기본 제공 |
| **봇 차단** | Vercel BotID | Audit 어뷰즈 방지 |
| **배포** | Vercel | Fluid Compute 기본 |
| **DNS·도메인** | findable.co.kr (가비아 등록 2026.04.16) | Vercel 연결 |

---

# Part D. UI/UX

## 13. 화면 인벤토리

### 13.1 Marketing (SSG·SEO)
- `/` — 메인 랜딩 (Hero + 7 엔진 로고 + 3 사용 사례 + CTA)
- `/audit` — 무료 Audit 진입 (이메일·도메인 입력)
- `/audit/[jobId]` — Audit 결과 화면 (PDF 다운로드)
- `/pricing` — 4-tier 가격
- `/about` — 회사 소개·비전
- `/blog` — GEO 콘텐츠 마케팅

### 13.2 SaaS (인증 필수, Cache Components)
- `/dashboard` — 메인 대시보드 (SoV·Sentiment·시계열)
- `/brands` — 브랜드 목록
- `/brands/[id]` — 브랜드 상세 (7 엔진 추적·경쟁사·인용)
- `/brands/[id]/prompts` — 프롬프트 관리
- `/brands/[id]/competitors` — 경쟁사 벤치마크
- `/reports` — 리포트 히스토리
- `/reports/[id]` — 리포트 상세
- `/settings/profile` — 프로필
- `/settings/billing` — 결제·플랜 관리

### 13.3 Auth
- `/sign-in`, `/sign-up` — Clerk 호스팅

---

## 14. 핵심 인터랙션 플로우

### 14.1 무료 Audit (PLG 진입)

```
[랜딩] → [/audit 클릭] → [이메일·도메인 입력] →
[잡 큐 적재] → 30초~3분 진행률 표시 →
[PDF 자동 생성] → [화면 다운로드 + 이메일 발송] →
[CTA: "전체 분석은 Starter로" → 회원가입]
```

### 14.2 회원가입 → 첫 트래킹

```
[회원가입 (Clerk)] → [브랜드 등록] → [도메인·산업 입력] →
[프롬프트 자동 생성 30~150개] → [경쟁사 자동 추천 3~5개] →
[즉시 트래킹 시작] → [대시보드 진입]
```

### 14.3 결제 흐름

```
[/pricing 또는 트라이얼 만료] → [플랜 선택] →
[Toss 결제 위젯] → [카드 등록] →
[빌링키 발급] → [Webhook: /api/webhooks/toss] →
[organizations.plan 업데이트] → [세금계산서 자동 발급]
```

---

## 15. 디자인 시스템

### 15.1 컬러
- Primary: 한국적이면서 글로벌한 색상 (네이비 + 골드 vs 블랙 + 시그니처) → 추후 디자이너 확정
- Tailwind 기본 + shadcn/ui 토큰 시스템

### 15.2 타이포그래피
- 한국어: Pretendard
- 영어: Inter
- `next/font` 사용

### 15.3 컴포넌트 라이브러리
- shadcn/ui 기본 컴포넌트 + 커스텀 차트 (Recharts)

### 15.4 다국어
- v1.0: 한국어 메인 + 영어 보조
- v2.0: 전 화면 i18n (한·영·일)

---

# Part E. 운영

## 16. 배포·인프라

### 16.1 환경
- **Production**: findable.co.kr (Vercel Production)
- **Preview**: PR마다 Vercel Preview URL 자동 생성
- **Development**: localhost:3000 + Vercel CLI (`vercel dev`)

### 16.2 환경 변수 관리
- `vercel env pull .env.local` (Vercel CLI 필수 설치)
- `.env.example` 커밋, `.env.local` 무시
- Production 시크릿: Vercel Dashboard에서 직접 입력

### 16.3 CI/CD
- Vercel 기본 GitHub 연동
- main 브랜치 → Production
- 모든 PR → Preview Deployment

### 16.4 도메인
- findable.co.kr (Vercel Production)
- staging.findable.co.kr (Preview 별도 도메인 — 옵션)

---

## 17. 모니터링·로깅

| 영역 | 도구 |
|---|---|
| 에러 모니터링 | Sentry |
| 성능 모니터링 | Vercel Analytics + Speed Insights |
| 로그 | Vercel Logs + Logtail (Better Stack) |
| 업타임 | Vercel 자체 + Better Uptime |
| AI 비용 추적 | Vercel AI Gateway 자체 대시보드 |

---

## 18. 비용·SLA

### 18.1 월 인프라 비용 추정 (베타 1개월 ~ 100사 유료)

| 항목 | 월 비용 | 비고 |
|---|---|---|
| Vercel Pro | $20 | Fluid Compute 기본 포함 |
| Vercel AI Gateway 사용료 | ~$300 | 4 글로벌 엔진 호출 |
| HyperCLOVA X (CLOVA Studio) | ~₩30~80만 | 콘솔에서 정확 단가 확인 |
| Naver Search API | 무료 | 일 25,000건 |
| Daum 검색 API | ~₩6만 | 20,000건 |
| Neon Postgres | $19~ | Branch 기능 |
| Pinecone | $0~$70 | 임베딩 |
| Clerk | $0~$25 | 1,000 MAU 무료 |
| Resend | $0~$20 | 3,000건/월 무료 |
| Vercel Blob | ~$10 | PDF 저장 |
| **합계** | **약 ₩100~150만** | 베타 100사 유료 기준 |

### 18.2 SLA 목표
- 가용성: 99.5% (Vercel 기본 99.99%, 한국 엔진 의존성으로 하향)
- 응답 시간: 대시보드 < 3초, Audit < 3분
- 데이터 백업: Neon 자동 백업 + 일일 외부 백업

---

## 19. 보안·법적 컴플라이언스

### 19.1 인증·세션 보안 (Clerk 표준)
- **OAuth 4종 v1.0 동시 지원**: Google · 카카오 (Clerk 공식) · 네이버 (Custom Provider) · 이메일·비밀번호
- **JWT 토큰**: HttpOnly Secure 쿠키 (XSS 방지)
- **세션 자동 갱신**: 7일 슬라이딩, 만료 시 재로그인
- **MFA 옵션**: 2FA 앱·SMS·이메일 OTP
- **비밀번호 정책**: 최소 12자, haveibeenpwned 차단
- **계정 잠금**: 5회 실패 시 15분 잠금
- **봇 차단**: Vercel BotID + Clerk 봇 차단

### 19.2 데이터 격리 (RLS — Row Level Security)
- 모든 테이블 `organizationId` 필수
- Postgres RLS 정책으로 다른 조직 접근 물리적 불가
- Drizzle 미들웨어로 모든 쿼리 자동 `organizationId` 주입

### 19.3 API 권한 (3중 체크)
모든 엔드포인트에 강제:
1. 인증 체크 (Clerk JWT) → 401
2. 조직 멤버십 체크 → 403
3. 리소스 소유권 체크 → 404

### 19.4 ⭐ 플랜 권한 4단계 게이트 (결제 안 한 사용자 차단)

#### 게이트 1: 데이터베이스
```sql
plan TEXT NOT NULL DEFAULT 'free'
plan_expires_at TIMESTAMP
trial_ends_at TIMESTAMP
billing_status TEXT  -- active, trialing, past_due, canceled, expired
```

#### 게이트 2: API (`requirePlan()` 함수)
- 결제 상태 + 플랜 등급 체크
- 위반 시 PlanError 반환 → 자동 `/pricing` 또는 `/settings/billing` 리다이렉트

#### 게이트 3: 사용량 한도 (`checkUsage()`)
| 플랜 | brands | prompts | audits |
|---|---|---|---|
| Free | 0 | 0 | 1 (무료 1회) |
| Starter | 1 | 30 | unlimited |
| Growth | 5 | 150 | unlimited |
| Scale | unlimited | 500 | unlimited |
| Enterprise | unlimited | unlimited | unlimited |

#### 게이트 4: UI 차단 (`<PlanGate />` 컴포넌트)
- UX 향상용, 진짜 보안은 서버 사이드
- 상위 플랜 기능에 자동 "업그레이드" CTA 표시

### 19.5 결제 상태 동기화 (Webhook)
- **Toss Webhook**: 서명 검증 (HMAC) 후 organizations 테이블 업데이트
- **PayPal Webhook**: IPN/Webhooks 검증
- **이벤트별 처리**:
  - `PAYMENT.SUCCESS` → `billingStatus = 'active'`
  - `PAYMENT.FAILED` → `billingStatus = 'past_due'` (3일 후 cron으로 expired)
  - `PAYMENT.CANCELED` → 결제 기간 끝까지 사용 가능
- 모든 변경은 audit log 기록

### 19.6 무료 Audit 어뷰즈 방지
- 같은 이메일: 일 1회
- 같은 IP: 일 5회 (회사 IP 고려)
- 일회용 이메일 차단 (disposable email API)
- Vercel BotID 점수 0.5 미만 차단
- hCaptcha (옵션)

### 19.7 인프라 보안
- HTTPS 강제 (Vercel 기본)
- 환경 변수는 Vercel 시크릿만 (`vercel env pull`)
- Vercel Sandbox로 외부 호출 격리 (v1.5 스크래핑)
- Sentry로 권한 위반 시도 자동 알림
- 모든 결제 변경 audit log → compliance 대비

### 19.2 개인정보
- 한국 개인정보보호법 준수
- 개인정보 처리방침 페이지 (`/privacy`)
- 이용약관 페이지 (`/terms`)

### 19.3 법적 리스크
- ❌ 네이버 AI Briefing 직접 스크래핑 (v1.0 제외) — 약관 위반·민법 750조 리스크 <!-- [확인사실 2026-07-22] 구 Cue:는 2026-04-09 종료. 현행 답변 표면은 AI Briefing -->
- ✅ Naver 공식 검색 API + HyperCLOVA X 합성 (합법)
- 외주 협력사 NDA 의무
- 핵심 알고리즘 모듈 분리·접근 제한

### 19.4 지식재산
- 도메인 선점 (findable.co.kr, 2026.04.16)
- 상표 출원 (2026.Q4 예정)
- 국내 특허 2건 출원 예정 (2026.08, 10)

---

# Part F. 일정·영업

## 20. 5일 개발 일정 (Day-by-Day)

### Day 1 — 2026.04.30 PM
**목표**: 코드베이스 세팅 + Vercel·도메인 연결 + 랜딩 Hero

- [ ] Findable 디렉토리 생성 + Turborepo + pnpm workspaces
- [ ] Next.js 16 App Router + TypeScript + Tailwind 4 + shadcn/ui
- [ ] Vercel 프로젝트 연결 + findable.co.kr 도메인 바인딩
- [ ] Clerk 인증 세팅
- [ ] Neon Postgres + Drizzle 스키마 마이그레이션
- [ ] Toss Payments 가맹점 신청 (사업자 서류 제출)
- [ ] 랜딩 Hero 섹션 (`/`) — "AI 시대의 검색은 다릅니다"
- [ ] `vercel.ts` 코드형 배포 설정

### Day 2 — 2026.05.01
**목표**: 7 엔진 통합 + 무료 Audit 작동

- [ ] AI Gateway 통합 (4 글로벌 엔진)
- [ ] HyperCLOVA X 어댑터 (CLOVA Studio 직접 fetch)
- [ ] Naver Search API 어댑터
- [ ] Daum 검색 API 어댑터
- [ ] Vercel Queues 잡 처리 시스템
- [ ] `/audit` 페이지 + `/api/audit` POST + 잡 폴링
- [ ] PDF 생성 (`@vercel/og` + Puppeteer)
- [ ] Vercel Blob Public 업로드
- [ ] Resend 이메일 자동 발송

### Day 3 — 2026.05.02
**목표**: CrewAI 4 에이전트 + 회원가입 + 대시보드

- [ ] CrewAI 4 에이전트 이식 (L-park 코드 재활용)
- [ ] 민지·Alex·수진·준호 워크플로 정의
- [ ] 회원가입·로그인 (Clerk hosted)
- [ ] `/dashboard` Cache Components — SoV 차트·Sentiment·시계열
- [ ] `/brands/[id]` — 7 엔진 추적·경쟁사·인용
- [ ] Custom Prompt 자동 생성·관리
- [ ] 경쟁사 벤치마크 화면

### Day 4 — 2026.05.03
**목표**: 결제·CSV·Citation·QA 1차

- [ ] Toss Payments 가맹점 승인 후 결제 위젯 통합
- [ ] 빌링키 발급 + 정기결제 cron
- [ ] 세금계산서 자동 발급 + 부가세 표기
- [ ] CSV/엑셀 Export 구현
- [ ] Citation Source + 도메인 권위 점수
- [ ] QA 1차 (모든 화면 클릭 테스트)

### Day 5 — 2026.05.04
**목표**: QA 2차 + 영업 자료 + v1.0 베타 출시

- [ ] QA 2차 + 버그 픽스 + 성능 최적화
- [ ] 영업 자료 1-pager (페인 차트 케이스)
- [ ] Audit 사전 데이터 준비 (메디큐브·아누아·마뗑킴 등 5개)
- [ ] **v1.0 베타 출시** + findable.co.kr 본 도메인 라이브
- [ ] 인디고차일드 SNS·LinkedIn 베타 출시 공지
- [ ] 첫 콜드 영업 메일 5건 발송 (1순위 K-뷰티 D2C)

---

## 21. 위험·완화 전략

| 위험 | 가능성 | 영향 | 완화 |
|---|---|---|---|
| Toss 가맹점 승인 지연 (3일+) | 중 | 결제 미가동 | 포트원 임시 사용 옵션 / 첫 주는 무료 트라이얼만 |
| HyperCLOVA X API 가격 폭등 | 중 | 인프라 비용 증가 | 캐싱 강화 + HCX-DASH-002 사용 (가장 저렴) |
| CrewAI 4 에이전트 응답 시간 > 10분 | 중 | UX 저하 | 빠른 모드 (30초 1페이지) + 풀 모드 (10분 상세) 분리 |
| Naver Search API 일 25,000건 한도 초과 | 낮 | 서비스 중단 | 캐싱 + 다중 앱 등록 + 유료 전환 |
| 대표 1인 영업 한계 | 높 | 매출 정체 | 2026.07부터 Growth Marketer 채용 |
| 네이버 약관 변경으로 합성 전략 무효화 | 낮 | 차별점 약화 | 공식 API 확보 (네이버 파트너 신청) |

---

## 22. 영업 전략 (4-Way ICP)

### 22.1 영업 채널 매트릭스

| ICP | 영업 방식 | 첫 미팅 무기 |
|---|---|---|
| 글로벌 진출 K-뷰티 | 인바운드 + KOTRA·Cafe24 파트너 | "메디큐브 vs Beauty of Joseon" 페인 차트 |
| 한국 진출 외국 브랜드 | 아웃바운드 + 한국 광고 에이전시 파트너 | "LV·Apple Korea의 한국어 ChatGPT 노출 0" |
| 한국 내수 D2C | 아웃바운드 + 콘텐츠 마케팅 | "무신사 인기 브랜드 한국어 AI 검색 노출 비교" |
| 글로벌 진출 K-패션 | 인바운드 + 미디어 | "마뗑킴 vs ADER Error" 페인 차트 |

### 22.2 영업 자료 (1-pager × 4 ICP)
- 각 ICP별 1-pager 제작 (페인 차트·결과 사례·가격·CTA)
- 영문 1-pager 1종 (글로벌 진출형용)

### 22.3 콘텐츠 마케팅
- "한국어 GEO 가이드북" 무료 PDF 배포
- 블로그 주 1~2회 발행 (한국어·영어)
- LinkedIn·X·인스타그램 운영

### 22.4 파트너십
- KOTRA·Cafe24 글로벌·Shopify Korea (글로벌 진출형)
- 한국 광고 에이전시 (대홍기획·이노션·제일기획 등) — 외국 브랜드 진출
- 한국 마케팅 에이전시 (인하우스 추천)

### 22.5 첫 6주 영업 KPI

| 주차 | 무료 Audit | 콜드 미팅 | 유료 결제 |
|---|---|---|---|
| 1주 (5/4~5/10) | 50건 | 5건 | 1건 |
| 2주 | 100건 | 10건 | 2건 |
| 3주 | 200건 | 15건 | 5건 |
| 4주 | 400건 | 20건 | 8건 |
| 5주 | 600건 | 25건 | 12건 |
| 6주 | 1,000건 | 30건 | 18건 |

---

## 23. 자금·비용 계획

### 23.1 현재 가용 자금
- 인디고차일드 자체 운영 자금 (3개년 매출 ₩2.66억 누적)

### 23.2 단기 자금 조달 (~2026.06)

| 채널 | 마감 | 규모 | 상태 |
|---|---|---|---|
| 충북ICT융합 기술개발 | 2026.05.05 | 4천만 R&D | 신청 준비 (사업계획서 80% 완성) |
| 충북콘텐츠 액셀러레이팅 | 2026.05.06 발표평가 | 비재무 (멘토링·공간) | 1차 통과 |
| IBK창공 마포·대전 14기 | 2026.05.06 | 비재무 (멘토링·공간·IR) | 신청 준비 (PPTX v3 완성) |

### 23.3 중기 자금 조달 (2026.11~)
- IBK창공 졸업 → IBK 직접투자 + 외부 VC Seed 3~5억
- 2027.Q1 TIPS 5억 (씨엔티테크 추천)
- 2027.Q3~Q4 Pre-A 15~30억 (해외 VC 포함)

### 23.4 베타 운영 비용 (월)

| 항목 | 비용 |
|---|---|
| 인프라 (Vercel·AI Gateway·Postgres 등) | ₩100~150만 |
| 한국 AI 엔진 (CLOVA·Daum) | ₩30~80만 |
| 도메인·SSL | ₩5만 |
| 디자인·콘텐츠 외주 (필요 시) | ₩50~100만 |
| **월 합계 (베타 1~3개월)** | **₩200~350만** |

---

## 📌 PRD 변경 이력

| 버전 | 날짜 | 변경 |
|---|---|---|
| v1.0 | 2026.04.30 | 초안 작성 (5건 리서치 + 기존 자산 발췌 통합, D-001~D-010 반영) |
| v1.1 | 2026.05.01 | D-011~D-019 반영 — 카테고리(Agentic GEO Platform), 슬로건(D-016), Stagehand·gstack·GPT Researcher·Princeton GEO·AutoGEO 기술 스택, 학습 데이터셋 리서치 결과 통합 |

---

## 📂 관련 문서

- `docs/ARCHITECTURE.md` — 시스템 아키텍처 상세
- `docs/ROADMAP.md` — v1.0 → v1.5 → v2.0 로드맵
- `docs/COMPETITORS.md` — 경쟁사 분석 (리서치 A·F)
- `docs/DECISIONS.md` — 의사결정 로그 (D-001~D-019)
- `docs/inputs/` — 리서치 8건 + 기존 자산 발췌
  - `08_research_G_training_datasets.md` — D-019 학습용 데이터셋 리서치 (2026.05.01) — Common Crawl·Wikipedia·AI Hub·모두의 말뭉치·GEO-Bench·Researchy-GEO·r/AsianBeauty·Amazon Reviews 등 Top 10 데이터셋 합법성 평가 포함
