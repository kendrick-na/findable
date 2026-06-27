# Findable 의사결정 로그

**문서 버전**: v1.0 (2026.04.30)

각 의사결정은 시점·근거·대안을 기록한다. 결정 번복 시에도 원본은 보존하고 신규 항목으로 추가한다.

---

## D-001 (2026.04.30) — 제품 본질 정의

### 결정
"한국어와 영어 AI 답변 속에서 모든 브랜드의 가시성을 측정·관리하는 플랫폼"

### 근거
- 본인 의문: "한국 글로벌 진출 브랜드만이 ICP면 시장 작지 않나?"
- 진짜 시장 4-Way 매트릭스: 한국 브랜드 + 해외 브랜드 × 한국어 AI + 영어 AI
- 해외 브랜드 → 한국어 AI 시장 (Apple·LV·Tesla 한국 마케팅팀) 블루오션 발견

### 대안 (기각)
- "한국 브랜드 AI 검색 가시성 도구" → 시장 좁음
- "K-브랜드 글로벌 진출용" → 시장 크기 약 1,150사 (vs 4-way 10,650사)

---

## D-002 (2026.04.30) — ICP 우선순위

### 결정
| 순위 | ICP |
|---|---|
| 1 | 글로벌 진출 K-뷰티 D2C |
| 2 | 한국 진출 외국 브랜드 마케팅팀 |
| 3 | 한국 내수 D2C (무신사·29CM·올리브영 입점) |
| 4 | 글로벌 진출 K-패션·K-콘텐츠 |
| 5 | 한국 의료·교육·금융 이노랩 |
| ⏸ v1.5+ | 글로벌·내수 B2B SaaS |

### 근거
- 리서치 F: 글로벌 GEO 4개사 고객 38%가 B2B SaaS → 시장 크지만 한국 B2B SaaS는 자체 인하우스 마케팅 선호
- 리서치 F: D2C는 정량 효과 가장 강함 (Omnilux 3배·Popl 1561% ROI)
- 본인 의문: "Channel Talk이 Findable 결제할 가능성 낮을 듯"
- → B2B SaaS는 v1.5 워크플로 기능 (CMS 발행·Brand Guardrails) 출시 후 영업 가동

### 대안 (기각)
- B2B SaaS 1순위 → 한국 인하우스 마케팅 의존 + 결제 사이클 길음
- K-푸드 ICP 포함 → 페인 약함 (이미 1위, Bibigo·신라면)

---

## D-003 (2026.04.30) — 가격 5-Tier 구조

### 결정
| 플랜 | 월 요금 | 연 요금 (17% 할인) |
|---|---|---|
| Free Audit | ₩0 (1회) | - |
| Starter | ₩99,000 | ₩990,000 |
| Growth | ₩390,000 | ₩3,900,000 |
| Scale | ₩990,000 | ₩9,900,000 |
| Enterprise | 연 ₩30M부터 (협상) | - |

(VAT 별도)

### 근거
- 글로벌 경쟁사 정렬: Profound $99/$399/$2K~5K, AthenaHQ $295/$545/$2K, Peec €89/€199/커스텀
- Findable Starter ₩99K (~$70) = Profound $99 거의 동급, AthenaHQ $295의 1/4
- Growth ₩290K → ₩390K 인상: Profound $399 정렬
- Scale ₩790K → ₩990K 인상: 심리적 ₩1M 미만
- Enterprise 하한 ₩30M 명시 (Bluefish 연 $50K~$200K 모델)

### 대안 (기각)
- Starter ₩99K → ₩79K 인하: 가치 anchor 약화 + 마케팅 예산 큰 D2C는 가격 차이 결정 요인 아님
- Enterprise 비공개 (Contact Sales만): 영업 anchor가 약해서 ₩30M 하한 표기 + 상한 비공개

---

## D-004 (2026.04.30) — 한국 AI 엔진 통합 방식

### 결정
- ✅ HyperCLOVA X (CLOVA Studio 공식 API, HCX-DASH-002)
- ✅ Naver 공식 검색 API (블로그·뉴스·웹문서·지식인) + HyperCLOVA 합성으로 Cue: 90% 재현
- ✅ Daum 검색 API (Kakao)
- 🚫 Naver Cue: 직접 스크래핑 — v1.0 제외, v1.5 이연

### 근거 (리서치 C)
- Naver Cue: 공식 API 부재 (2026.04 기준 partner-only)
- 직접 스크래핑 시 네이버 약관 위반 + 민법 750조 책임 가능
- HyperCLOVA X = Naver 자체 LLM = Cue:가 쓰는 LLM과 동일 계열
- Naver 검색 API 결과 + HyperCLOVA → Cue: 답변 90% 재현 가능 (합법)

### 대안 (기각)
- Cue: 직접 스크래핑 (Vercel Sandbox + Oxylabs): 합법 리스크
- SerpAPI engine=naver: 차단 책임 위임이지만 비용 ($50~$250/월)

---

## D-005 (2026.04.30) — 결제 시스템

### 결정
**Toss Payments 단일 PG**

### 근거 (리서치 E)
- 인디고차일드 = 개인사업자
- Stripe: 한국 개인사업자 가입 불가 (외국법인만)
- Toss: 가맹점 심사 2~3영업일 → 5일 내 라이브 가능
- Next.js 공식 SDK + 빌링키(정기결제) 성숙
- 세금계산서 자동 발급 지원

### 대안 (기각)
- Stripe: 가입 불가
- 포트원 멀티 PG: v1.0에선 오버엔지니어링, v1.5에서 추가 검토

---

## D-006 (2026.04.30) — 기술 스택

### 결정
- 프레임워크: Next.js 16 App Router
- AI: AI SDK v6 + Vercel AI Gateway
- DB: Neon Postgres (Vercel Marketplace) + Drizzle ORM
- Vector DB: Pinecone
- 인증: Clerk
- 결제: Toss Payments
- 큐: Vercel Queues (베타)
- 이메일: Resend
- 배포: Vercel
- 모노레포: Turborepo + pnpm

### 근거
- Vercel 시스템 메모(2026.02.27): Fluid Compute 기본, Edge Functions 비추천, `proxy.ts` (Next.js 16) 권장, `@vercel/postgres`/`@vercel/kv` 사용 X
- L-park 프로덕션 (TRL 8) 검증된 스택 재활용
- AI Gateway: 4 글로벌 엔진 통합 1줄 + 자동 fallback
- Neon Postgres: Branch 기능으로 PR마다 Preview DB

---

## D-007 (2026.04.30) — 5일 압축 개발 일정

### 결정
- Day 1 (4/30): 코드베이스 + Vercel·도메인 + 랜딩
- Day 2 (5/1): 7 엔진 통합 + 무료 Audit
- Day 3 (5/2): CrewAI + 회원가입 + 대시보드
- Day 4 (5/3): 결제 + CSV + Citation
- Day 5 (5/4): QA + 영업 자료 + 베타 출시

### 근거
- 본인 요청: "2~3일 내로 모든 서비스 가동, 영업 가능 수준 아니어도 OK"
- 본인 가용 시간: 풀가동 8시간+/일 가능
- L-park 코드 재활용 + AI Gateway + Vercel Marketplace로 시간 단축

### 대안 (기각)
- 6.5주 개발: 너무 보수적
- 3일 개발: QA·영업 자료 부실
- 5/5 충북ICT 마감 + 5/6 충북콘텐츠 발표평가 병행 가능 (자료 80% 완성)

---

## D-008 (2026.04.30) — Naver Cue: 합성 전략

### 결정
**Naver 공식 검색 API + HyperCLOVA X 답변 합성으로 Cue: 90% 재현**

### 메커니즘
```
[Cue: 실제]
질의 → Naver 검색 인덱스 → Naver LLM → 답변

[Findable 재현]
질의 → Naver 공식 검색 API → HyperCLOVA X → 답변
       (블로그·뉴스·지식인)        (Naver LLM)
```

### 근거
- HyperCLOVA X = Naver 자체 LLM (Cue:가 쓰는 LLM과 동일 계열)
- Naver 공식 검색 API 결과 = Cue:가 인용할 만한 후보 문서 동일
- 합법적, 비용 무료 (일 25,000건)

---

## D-009 (2026.04.30) — Out of Scope (명시 제외)

### 결정 (v1.0 제외)
1. AI 콘텐츠 자동 생성 (Jasper 함정)
2. 범용 멀티 에이전트 플랫폼 (Lindy 함정)
3. API 외부 공개 + SSO (Enterprise 영업 전 단계)
4. 풀 엔터프라이즈 SDR 조직
5. SOC 2 Type II 초기 인증
6. 자체 크롤러 인프라
7. Naver Cue: 직접 스크래핑

### 근거
- Jasper $1.5B → 20% 삭감 / Copy.ai 2025.10 피인수: AI 콘텐츠 생성 함정
- Lindy 2023 이후 라운드 0: 수평 에이전트 플랫폼 정체
- Findable v1.0은 측정·인텔리전스 레인 집중

---

## D-010 (2026.04.30) — 슬로건·메시지

### 결정
- 메인: **"AI 시대의 검색은 다릅니다."**
- 영문: **"Findable tracks your brand across Korean and English AI answers."**
- 7 엔진 표기: ChatGPT · Claude · Perplexity · Gemini · HyperCLOVA X · Naver · Daum

### 근거
- 본인 의견: "한국 브랜드 AI 검색 가시성 플랫폼"은 잘못됨 (해외 브랜드의 한국 진출도 타겟)
- 본질: 한국어·영어 AI 답변 = 브랜드를 양쪽에서 추적

### 대안 (기각)
- "한국 브랜드 AI 검색 가시성 도구" → 시장 좁힘
- "K-브랜드 글로벌 진출용 GEO" → 4번째 케이스(해외 → 한국) 누락

---

## D-011 (2026.04.30 PM) — Agentic GEO Platform 카테고리 포지셔닝

### 결정
**"한국 최초 Agentic GEO Platform"** 카테고리 자체를 새로 정의하는 마케팅 전략

### 근거
- Bluefish AI가 "Agentic Marketing Platform" 카테고리 선점으로 $43M Series B 받음 (2026.04, Threshold + NEA)
- 글로벌 GEO 4개사 모두 자기를 "에이전트 회사"로 포지셔닝 (Profound Actions, AthenaHQ Action Center, HubSpot Breeze Agents, Peec Agent Experience Platform)
- Sierra ($10B / $150M ARR = 66x), Decagon ($4.5B / $35M ARR = 128x) — Agentic 회사는 일반 SaaS 대비 **10~20배 멀티플 프리미엄**
- 2025 AI 펀딩 $270B 중 절반이 Agentic AI

### 적용
- 슬로건은 D-016 참조, 서브카피·VC 피칭에 "Agentic" 적극 사용
- 4 에이전트(민지·Alex·수진·준호) 구조 강화
- 랜딩 페이지·PRD·피칭덱에 "Agentic GEO" 키워드 통일

### VC 피칭 키워드 7개
1. Agentic GEO Platform (Bluefish 미러링)
2. Multi-agent orchestration
3. Autonomous content optimization
4. Tool-use & function calling
5. Outcome-based pricing
6. Agent Experience Layer
7. K-Brand AI Discovery Infrastructure

---

## D-012 (2026.04.30 PM) — 4 OAuth v1.0 동시 통합

### 결정
v1.0에 **Google + 카카오 + 네이버 + 이메일·비밀번호** 4개 OAuth 동시 지원

### 근거·구현
- Google·이메일: Clerk 기본 (5분)
- 카카오: Clerk 공식 Provider (10분)
- 네이버: Custom OAuth Provider (30~45분)
- 총 1시간 작업 → Day 1에 무리 없음
- 한국 차별화: 4개 글로벌 GEO 경쟁사 모두 카카오·네이버 미지원
- LinkedIn은 한국 침투율 낮아 v1.5+ 이연

---

## D-013 (2026.04.30 PM) — 다중 결제 시스템 (Toss + PayPal + Wire)

### 결정
v1.0부터 3개 결제 수단 동시 가동:
- **Toss Payments** (한국 카드, KRW, 세금계산서 자동)
- **PayPal Business** (글로벌 카드, USD)
- **Wire Transfer** (Enterprise 인보이스)

### 근거
- 본인 지적: "Toss 단독으로는 글로벌 브랜드 결제 불가"
- 한국 진출 외국 브랜드 한국 법인 → Toss로 충분
- 글로벌 본사 직접 결제 → PayPal 또는 Wire 필요
- 글로벌 GEO 경쟁사 4개사 모두 Stripe + Wire (한국 사업자는 Stripe 가입 불가)
- PayPal Business는 한국 개인사업자 가입 가능 + 200+ 국가 지원
- Wire Transfer는 인보이스만 발송하면 되므로 무비용·즉시 가동

### 단계
- v1.0 (5/2): Toss + PayPal + Wire 3개 동시
- v2.0: Stripe 추가 (영문 글로벌 진출 시)

---

## D-014 (2026.04.30 PM) — 4단계 플랜 권한 게이트

### 결정
"결제 안 한 사용자가 결제한 사람처럼 이용 못 하게" 4단계 보안:

#### 게이트 1: DB
```
plan TEXT NOT NULL DEFAULT 'free'
plan_expires_at TIMESTAMP
trial_ends_at TIMESTAMP
billing_status TEXT  -- active, trialing, past_due, canceled, expired
```

#### 게이트 2: API (`requirePlan()` 함수)
- 모든 엔드포인트에 강제

#### 게이트 3: 사용량 한도 (`checkUsage()`)
| 플랜 | brands | prompts | audits |
|---|---|---|---|
| Free | 0 | 0 | 1 |
| Starter | 1 | 30 | unlimited |
| Growth | 5 | 150 | unlimited |
| Scale | unlimited | 500 | unlimited |
| Enterprise | unlimited | unlimited | unlimited |

#### 게이트 4: UI 차단 (`<PlanGate />` 컴포넌트)
- UX 향상용, 진짜 보안은 서버 사이드

### 데이터 격리 (RLS)
- 모든 테이블 `organizationId` 필수
- Postgres Row Level Security 정책
- Drizzle/Prisma 미들웨어로 자동 주입

---

## D-015 (2026.04.30 PM) — 홈페이지 구조 (옵션 A)

### 결정
**Next.js App Router 라우트 그룹 분리** (같은 도메인)
```
findable.co.kr/             ← 마케팅 (SSG·SEO 최적화, 비로그인)
findable.co.kr/audit        ← 무료 Audit (PLG 진입점)
findable.co.kr/pricing      ← 가격
findable.co.kr/blog         ← 콘텐츠
findable.co.kr/sign-up      ← Clerk 호스팅
─────────────────────────────
findable.co.kr/dashboard    ← SaaS 앱 (인증 필수, Cache Components)
findable.co.kr/brands       ← SaaS
findable.co.kr/reports      ← SaaS
findable.co.kr/settings     ← SaaS
```

### 근거
- 단일 도메인 (SEO·브랜딩·세션 단순)
- next-forge 기본 구조와 일치
- 경쟁사 사용 예: Profound, Peec

---

## D-016 (2026.04.30 PM) — 슬로건 최종 선정 (D-010 변경)

### 결정
- **Hero 메인**: "AI는 우리 브랜드를 추천하고 있나요?"
- **Hero 서브 카피**: "ChatGPT · HyperCLOVA · Perplexity · 네이버 · Claude · 다음 · Gemini — 한국어·영어 7개 AI 답변에서 우리 브랜드의 위치를 추적합니다."
- **Hero CTA 1차**: "[무료 진단 받기 (3분)]"
- **Hero CTA 2차**: "[전문가 상담 예약]"
- **Footer/About 비전**:
  > "AI에 의해 발견되는 브랜드, AI에 의해 잊혀지는 브랜드.
  > 경쟁사 말고 우리 브랜드를, AI가 먼저 답하게."

### 영문판
- Main: "Is AI recommending your brand?"
- Vision: "Brands AI finds. Brands AI forgets. Make AI answer with you. Not your competitor."

### 근거
- D-010 카피("AI 시대의 검색은 다릅니다") 본인 "노잼" 피드백
- 본인 선호 패턴: 질문형 페인 직격 + 명령형 경쟁 자극
- G1·G4·G12 후보 통합

---

## D-017 (2026.04.30 PM) — 기술 스택 핵심 추가 (Stagehand·gstack·학술 알고리즘·GPT Researcher)

### 결정 (D-006 보강)

#### 제품 코드 (Findable 안에 들어감)
1. **Stagehand** ([browserbase/stagehand](https://github.com/browserbase/stagehand)) — TS, 22.3k stars
   - 용도: ChatGPT·Perplexity 등 LLM에 한국어 질의 자동화 → 답변 추출 → 브랜드 인용 측정
   - **v1.0 핵심 기능 "AI 답변 브랜드 추적"의 백본**

2. **GPT Researcher** ([assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)) — Python, 26.6k stars
   - 용도: 콘텐츠 리서치 에이전트 백본
   - Python 마이크로서비스로 분리, Inngest가 호출
   - **v1.0 통합 (본인 결정 4번 채택)**

3. **Princeton KDD'24 GEO 알고리즘** ([GEO-optim/GEO](https://github.com/GEO-optim/GEO))
   - 용도: 가시성 측정 알고리즘 차용 (가시성 +40% 검증)
   - 한국어 버전으로 자체 구현
   - VC 피칭 핵심 무기

4. **ICLR'26 AutoGEO** ([cxcscmu/AutoGEO](https://github.com/cxcscmu/AutoGEO))
   - 용도: GEO 콘텐츠 리라이트 추천 알고리즘
   - 한국어 버전 자체 구현

#### 개발 도구 (제품 외부)
5. **gstack** ([garrytan/gstack](https://github.com/garrytan/gstack)) — 87.2k stars
   - 용도: 5일 압축 개발 가속 (Claude Code 23인 가상팀 시뮬)
   - 1인 비개발자 + Claude Code 콤보 강화
   - Garry Tan (YC CEO) 직접 오픈소스화

### VC 피칭 카피
> "Princeton KDD'24 GEO 논문 + ICLR'26 AutoGEO + 26.6k stars GPT Researcher 백본 + 한국 K-뷰티 독점 데이터 모트"

### 대안 (기각)
- AutoGPT (183k stars): 자율형 일반 에이전트, GEO 비특화
- LangChain (135k): Python 위주, 러닝커브 큼
- LangGraph (30.7k): Vercel 비호환
- CrewAI (49.9k): Python, 별도 워커 필요
- Hermes Agent: 정체 불명확 (NousResearch 모델인지 L-park 내부 명명인지 확인 안 됨)

---

## D-018 (2026.04.30 PM) — 카카오톡 알림 채널 v1.0 통합

### 결정
v1.0에 **카카오 비즈니스 채널** 통합 → 진단 결과·주간 리포트·결제 알림을 카카오톡으로 발송

### 근거
- 한국 차별화: 4개 글로벌 GEO 경쟁사 모두 미지원
- 한국 마케터 retention 강력 (이메일 대비 오픈율 3~5배)
- Resend(이메일) 병행

### 구현
- 카카오 비즈니스 채널 가입 + Webhook 통합
- 작업량 1일

---

## D-019 (2026.05.01 완료) — 학습용 데이터셋 리서치

### 결정
**v1.0 즉시 안전 활용 7개 데이터셋 채택**, 합법성 가드레일 설정

### 결과 (상세는 `docs/inputs/08_research_G_training_datasets.md`)
- **즉시 안전 활용 (CC BY / Apache / MIT / ODC-By)**:
  1. GEO-Bench (Princeton KDD'24) — v1.0 평가 표준
  2. AutoGEO E-commerce + Researchy-GEO (ICLR'26) — 추천 엔진 룰셋 base
  3. Common Crawl cdx index — Audit 1차 시그널
  4. 한국어 위키백과 dump — 한국어 GEO 검증
  5. KLUE Benchmark — 한국어 NER 정확도
  6. FineWeb v1.4.0 — Llama3·OLMo 학습 풀 매칭
  7. BOLD — LLM 브랜드 톤·편향 측정 (v1.3)
- **조건부**: AI Hub·모두의 말뭉치(인증), Amazon Reviews(별도 계약)
- **회색~위험**: Reddit Data API(유료), NAVER 검색 API(재배포 금지), DC/클리앙/뽐뿌·네이버 블로그 직접 크롤(전면 금지)
- **추천 엔진 룰셋**: Princeton 8 strategies (Cite Sources / Quotation / Statistics 3개가 +40% visibility)

### 핵심 전략적 함의
- **한국어 LLM 학습 풀이 영문 대비 50배 좁음** (GPT-3 0.017%, Llama2 0.06%)
- → 영문 GEO ≠ 한국어 GEO. **두 시장은 완전히 다른 문제**
- → Findable이 한국어 GEO 카테고리 독점 가능

---

## D-020 (2026.05.01) — gstack v1.0 스킵, v1.1 부분 도입

### 결정
- **v1.0 (5/4 베타까지)**: gstack 설치 스킵
- **v1.1 (5/4 이후 폴리싱)**: 4개 커맨드만 부분 도입 검토 (`/cso` 보안 감사, `/qa` 브라우저 테스트, `/review` 프로덕션 버그, `/benchmark` Core Web Vitals)

### 근거
- gstack 본질 = 멀티 에이전트가 아닌 **23개 마크다운 슬래시 커맨드 (정교한 프롬프트 템플릿)**
- 5일 스프린트 비적합 (적합도 5/10):
  - 23개 커맨드 학습 곡선
  - 토큰 폭증 (Pulumi 검증: 단일 스킬 실행 10K+ 토큰)
  - Build 단계 governance 공백 (Medium 검증)
  - **CrewAI 4 에이전트(D-017)와 페르소나 중복** — CEO/Eng Manager 역할이 양쪽에 존재
- HN 절반 평가: "cargo culting with extra steps"
- Pulumi·Medium 권장: "프레임워크 1개를 2주 돌려보고 평가" → 5일에 안 맞음
- 87K stars지만 YC CEO 후광 효과 (Sherveen Mashayekhi 비판 인용)

### 부분 도입 시 가치
- `/cso` (OWASP+STRIDE 보안 감사) — 1인 비개발자 절대 불가 영역, ROI 최고
- `/qa` (실 브라우저 자동 테스트)
- `/review` (프로덕션 버그 사전 발견)
- `/benchmark` (Core Web Vitals)
- 토큰 폭증 회피: SKILL.md만 발췌해서 CLAUDE.md에 인라인 (전체 `./setup` 안 함)

### 대안 (기각)
- 지금 전체 설치: 5일 스프린트와 충돌, CrewAI 페르소나 중복
- 영구 스킵: `/cso`의 보안 감사 효과는 1인 비개발자에게 실제 가치 큼

---

## D-021 (2026.05.01) — Stagehand v1.0 최소 통합 (chatgpt-web 어댑터)

### 결정
- **v1.0**: Stagehand LOCAL 모드로 ChatGPT 웹 UI 어댑터 1개만 추가 (시나리오 A)
- **8 엔진 라인업**: API 7개 + chatgpt-web (베타 라벨)
- **Browserbase는 옵션** — 키 있으면 클라우드 모드 자동 전환, 없으면 로컬 Chrome
- **v1.5**: Naver Cue:·Google AI Overview 웹 UI 추적 추가, 안정성 강화

### 근거
- 본인 재질의 "지금 넣으면 안좋아?"에서 처음 B 권고를 재평가
- D-016 슬로건 "AI는 우리 브랜드를 추천하고 있나요?"의 진짜 답은 ChatGPT 웹 UI에서 나옴 (API ≠ 웹)
- VC 피칭 차별화: "Profound와 동급 측정 능력" 입증 가능
- LOCAL 모드 = 무료 (Browserbase 가입 불필요)
- Stagehand 동적 import + stub fallback으로 깨져도 어댑터 안전
- "베타: 웹 답변 추적" UI 라벨로 깨질 가능성 사전 안내
- K-뷰티 영문 LLM 인용 측정 정확도 (D-019 발견: r/AsianBeauty + Amazon Reviews 인용은 웹 UI에서만 명확)

### 리스크 관리
1. Stagehand import 실패 → stub 응답
2. ChatGPT UI 변경 → `act()` 자연어 조작이 셀렉터 깨짐에 robust
3. OpenAI ToS 회색지대 → 베타 단계 트래픽 제한, v1.5에 정식 검토
4. 무로그인 ChatGPT 사용 (chatgpt.com 익명 모드) → 로그인 자동화 회피

### 환경변수
- `FINDABLE_DISABLE_CHATGPT_WEB=1` — 명시적 비활성화
- `FINDABLE_CHATGPT_WEB_HEADLESS=0` — 디버그용 (기본 headless)
- `FINDABLE_CHATGPT_WEB_TIMEOUT_MS` — 응답 timeout (기본 60초)
- `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` — 있으면 클라우드 모드 전환

---

## D-022 (2026.05.01) — PDF 생성: Puppeteer + sparticuz/chromium

### 결정
**`@sparticuz/chromium` + `puppeteer-core` + Pretendard CDN 폰트** 조합 채택

### 근거
- `@react-pdf/renderer` 평가: 한국어 렌더링 이슈 (gibberish, GitHub Issue #3172)
- `@vercel/og`: PNG 이미지만 생성 (PDF 아님)
- Puppeteer + sparticuz: Vercel Functions 50MB 한도 안에서 안정 동작, 한국어 100% 정확
- Pretendard CDN (jsDelivr): orioncactus/pretendard@v1.3.9 정적 호스팅, 안정적
- HTML 템플릿 = 디자이너·마케터도 수정 가능 (React PDF는 별도 DSL)

### 구현
- `pdf-template.ts`: 1페이지 A4 HTML (Pretendard, 4-카드 스코어카드, 엔진 표, Top 3 추천, 인용 출처)
- `pdf-generator.ts`: 프로덕션은 sparticuz, 로컬은 시스템 Chrome
- Vercel Blob `put(audits/{filename}, buffer, { access: "public" })` 업로드
- 잡 완료 후 자동 트리거 (runner.ts 통합), 실패해도 result/status 유지

### 환경변수
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob 업로드 (production)
- `CHROME_PATH` — 로컬 개발 시 Chrome 위치 override (기본: macOS Chrome)

### 대안 (기각)
- `@react-pdf/renderer`: 한국어 깨짐
- `@vercel/og`: PDF 아님
- Bun PDF 라이브러리: Vercel Functions Bun runtime 안정성 미검증

---

## D-023 (2026.05.01) — 4 에이전트는 Mastra (TypeScript), CrewAI(Python)는 v1.5+

### 결정
- v1.0 4 에이전트 구현 = **Mastra `@mastra/core@1.30.0`** (TypeScript)
- D-017의 "CrewAI" 용어는 페르소나 명칭(민지·Alex·수진·준호)과 4명 구조를 가리키며, 실제 런타임은 Mastra
- CrewAI(Python)는 별도 마이크로서비스로 v1.5+에서 도입 검토 (워크플로 강화 + 메모리 시스템 단계)

### 근거
- 5일 압축: Python 마이크로서비스 = 별도 배포·환경·인증 = 시간 손실
- Mastra: next-forge 모노레포 + AI SDK v6 + Vercel Functions 안에서 별도 서버 없이 동작
- Mastra Agent API: `new Agent({ id, name, model, instructions })` + `agent.generate(messages)` — 단순함
- AI Gateway plain string("anthropic/claude-sonnet-4.6") model 인자 그대로 사용 가능

### 구현
- `packages/ai/lib/crew/agents.ts` — 민지·Alex·수진·준호 페르소나 + 한국어/영어 instructions
- `packages/ai/lib/crew/orchestrator.ts` — 민지·Alex·수진 병렬 → 준호 직렬, OIDC 미설정 시 stub
- `apps/web/lib/audit/crew-runner.ts` — AuditJob.result에서 빠른 모드 데이터 읽고 crew 호출 → AuditJob.crewResult 저장
- `apps/web/app/api/audit/[jobId]/crew/route.ts` — POST 트리거, 중복 호출 방지(409), after() 백그라운드
- AuditJob 스키마 확장: crewStatus enum + crewResult Json + crewStartedAt + crewCompletedAt

### 4 에이전트 책임 분담
| 에이전트 | 페르소나 | 입력 | 산출 |
|---|---|---|---|
| 민지 | 한국 GEO 분석가 | HyperCLOVA·Naver·Daum 응답 | 한국 엔진별 가시성·Entity Grounding 분석 |
| Alex | US/Global 벤치마크 분석가 | ChatGPT·Claude·Perplexity·Gemini 응답 | 글로벌 경쟁사 대비 포지셔닝 |
| 수진 | 인용 출처 분석가 | 모든 엔진 인용 도메인 | 도메인 권위·신호 평가 |
| 준호 | GEO 액션 전략가 | 위 3 분석 + 메트릭 | Princeton 8 strategies 룰셋 기반 Top 5~10 액션 |

### Vercel Functions maxDuration
- crew 라우트: **600초** (4 에이전트 순차 호출, 2~10분 예상)
- Pro 플랜 default 300초보다 길어서 Pro 또는 Enterprise 필요
- Hobby 플랜이면 분할 실행 또는 Vercel Workflow로 마이그레이션 (v1.5+)

### v1.5 마이그레이션 후보
- Python CrewAI 마이크로서비스 (메모리·tool calling·planning 강화)
- Vercel Workflow DurableAgent (crash recovery, 정기 재실행)
