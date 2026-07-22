# Findable 시스템 아키텍처

**문서 버전**: v1.0 (2026.04.30)
**관련 문서**: PRD.md (Part C 기술 설계)

---

## 1. 디렉토리 구조

```
Findable/
├── README.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md           ← 본 문서
│   ├── ROADMAP.md
│   ├── COMPETITORS.md
│   ├── DECISIONS.md
│   └── inputs/                   # PRD 작성 원본 자료 (7개 발췌본)
├── apps/
│   └── web/                      # Next.js 16 App Router
│       ├── app/
│       │   ├── (marketing)/      # SSG·SEO 최적화
│       │   │   ├── page.tsx
│       │   │   ├── audit/
│       │   │   ├── pricing/
│       │   │   ├── about/
│       │   │   └── blog/
│       │   ├── (app)/            # Cache Components·인증 필수
│       │   │   ├── dashboard/
│       │   │   ├── brands/[id]/
│       │   │   ├── reports/
│       │   │   └── settings/
│       │   ├── api/
│       │   │   ├── audit/
│       │   │   ├── brands/
│       │   │   ├── engines/[engine]/
│       │   │   ├── reports/
│       │   │   ├── crew/
│       │   │   ├── webhooks/     # toss, clerk
│       │   │   └── cron/         # daily-tracking, weekly-report
│       │   ├── sign-in/
│       │   ├── sign-up/
│       │   └── proxy.ts          # Next.js 16 인증 게이트
│       ├── components/
│       │   ├── ui/               # shadcn/ui
│       │   ├── marketing/
│       │   └── app/
│       └── lib/
├── packages/
│   ├── core/                     # 비즈니스 로직 (재사용)
│   │   ├── engines/              # 7 AI 엔진 어댑터
│   │   │   ├── chatgpt.ts
│   │   │   ├── claude.ts
│   │   │   ├── perplexity.ts
│   │   │   ├── gemini.ts
│   │   │   ├── hyperclova.ts
│   │   │   ├── naver-search.ts   # AI Briefing 추적용 (구 Cue:는 종료됨)
│   │   │   └── daum.ts
│   │   ├── entity-grounding/     # Korean Entity Grounding
│   │   ├── crew-agents/          # CrewAI 4 에이전트
│   │   │   ├── minji.ts
│   │   │   ├── alex.ts
│   │   │   ├── sujin.ts
│   │   │   └── junho.ts
│   │   ├── scoring/              # SoV·Citation·Sentiment
│   │   ├── prompt-generator/     # 자동 프롬프트 추천
│   │   └── reporting/            # PDF 리포트
│   ├── db/                       # Drizzle 스키마·migrations
│   │   ├── schema.ts
│   │   └── migrations/
│   └── ui/                       # 공통 UI 컴포넌트
├── public/
│   └── mockups/                  # 기존 4세트 목업 보존
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── vercel.ts
```

---

## 2. 시스템 컴포넌트

### 2.1 Frontend (apps/web)
- **Next.js 16 App Router** — Server Components 기본, `'use client'` 최소화
- **Cache Components** — 랜딩 SSG, 대시보드 ISR
- **Routing**: `(marketing)` 그룹은 SSG, `(app)` 그룹은 인증 + Cache Components
- **`proxy.ts`** — `middleware.ts` 대체. 인증 게이트, BotID 통합, 라우트 분리

### 2.2 Backend (Next.js Route Handlers + Vercel Functions)
- **Fluid Compute** — 함수 인스턴스 재사용으로 콜드 스타트 최소화
- **Node.js 24 LTS** — 기본
- **300초 timeout** — CrewAI 4 에이전트 순차 실행 충분

### 2.3 Queue System (Vercel Queues, Public Beta)
- **Audit 잡** — 7 엔진 동시 호출 부하 분산
- **Daily Tracking 잡** — Cron 트리거 + 큐 분배
- **Weekly Report 잡** — 주간 PDF 생성·이메일 발송
- **At-least-once delivery** — 응답 누락 방지

### 2.4 데이터베이스
- **Neon Postgres (Vercel Marketplace)** — 메인 DB
  - Branch 기능으로 PR마다 Preview DB 생성
  - Drizzle ORM
- **Pinecone** — Vector DB (Korean Entity Grounding 임베딩)
- **Vercel Blob** — PDF 리포트 (Public/Private 분리)

### 2.5 AI 엔진 통합
| 엔진 | 통합 방식 | 비고 |
|---|---|---|
| ChatGPT (gpt-5.4) | AI Gateway | `gateway('openai/gpt-5.4')` |
| Claude (sonnet-4-7) | AI Gateway | `gateway('anthropic/claude-sonnet-4-7')` |
| Perplexity (sonar) | AI Gateway | `gateway('perplexity/sonar')` |
| Gemini (2.0) | AI Gateway | `gateway('google/gemini-2.0')` |
| HyperCLOVA X | 직접 fetch | CLOVA Studio HCX-DASH-002 |
| Naver Search | 직접 fetch | 공식 검색 API + HyperCLOVA 합성 (네이버 AI Briefing 근사) <!-- [확인사실 2026-07-22] "Cue: 90% 재현"은 종료된 엔진 기준이라 무의미. Cue: 2026-04-09 종료 → 현행 답변 표면 AI Briefing(하이퍼클로바X 기반) 추적. 코드에 naver-briefing-adapter.ts 구현됨 --> |
| Daum | 직접 fetch | Kakao Daum 검색 API |

### 2.6 인증·결제
- **Clerk** — 이메일·소셜 로그인, JWT 토큰
- **Toss Payments** — 한국 카드 정기결제, 빌링키, 세금계산서 자동

### 2.7 부가 서비스
- **Resend** — 이메일 (Audit 결과·뉴스레터·트랜잭션)
- **Sentry** — 에러 모니터링
- **Vercel Analytics + Speed Insights** — 성능·사용자 분석
- **Vercel BotID** — 어뷰즈 방지

---

## 3. 핵심 데이터 흐름

### 3.1 무료 Audit 흐름

```
[1] 사용자 → /audit 페이지
[2] 이메일 + 도메인 입력 → POST /api/audit
[3] AuditJob 생성 (Postgres)
    + Vercel Queues 적재
[4] Worker (Fluid Compute):
    a. 도메인에서 브랜드명·산업 자동 추출 (HyperCLOVA)
    b. 30개 프롬프트 자동 생성 (한국어 15 + 영어 15)
    c. 7개 엔진 병렬 호출 (Promise.allSettled)
       ├── AI Gateway: 4 글로벌 엔진
       ├── HyperCLOVA: 직접 fetch
       ├── Naver Search: 공식 API + HyperCLOVA 합성
       └── Daum: 직접 fetch
    d. 응답 정규화 ETL → trackings 테이블
    e. CrewAI 빠른 모드 (30초): 1페이지 PDF 데이터 생성
    f. PDF 생성 (@vercel/og + Puppeteer)
    g. Vercel Blob Public 업로드
    h. Resend 이메일 발송
[5] 사용자 화면: 진행률 폴링 → 다운로드 링크
[6] 리드 정보 leads 테이블 저장 (CRM)
```

### 3.2 회원가입 → 첫 트래킹 흐름

```
[1] /sign-up (Clerk hosted)
[2] Webhook: POST /api/webhooks/clerk
    → users 테이블 + organizations 테이블 생성
[3] 온보딩 페이지: 브랜드 등록
[4] POST /api/brands
    → brands 테이블 + 자동 프롬프트 생성 + 자동 경쟁사 추천
[5] 즉시 트래킹 트리거: POST /api/brands/[id]/track
    → Vercel Queues 적재
[6] Worker: 7 엔진 병렬 호출 → trackings 저장
[7] Cache Components 대시보드 진입 → 데이터 표시
```

### 3.3 결제 흐름

```
[1] /pricing 또는 트라이얼 만료 페이지
[2] 플랜 선택 → Toss Payments 결제 위젯
[3] 카드 등록 → 빌링키 발급
[4] Webhook: POST /api/webhooks/toss
    → organizations.plan 업데이트
    → organizations.billing_customer_id 저장
    → 세금계산서 자동 발급 트리거
[5] 정기결제 cron: 매월 1일 GET /api/cron/monthly-billing
    → Toss API: 빌링키로 정기 청구
```

---

## 4. CrewAI 4 에이전트 워크플로

### 4.1 에이전트 정의

| 에이전트 | 역할 | 입력 | 출력 |
|---|---|---|---|
| **민지** | 한국 GEO 분석가 | 한국 엔진 응답 (HyperCLOVA·Naver·Daum) | 한국 SoV 점수, 한국 인용 소스 분석 |
| **Alex** | US 벤치마크 | 글로벌 엔진 응답 (ChatGPT·Claude·Perplexity·Gemini) | 글로벌 SoV, 한국 vs 글로벌 갭 |
| **수진** | Citation 분석가 | 7 엔진 인용 URL | 도메인별 권위 점수, 인용 소스 카테고리 분류 |
| **준호** | Action 추천 | 민지·Alex·수진 결과 | Top 3~5 콘텐츠 개선 추천 |

### 4.2 실행 모드

**빠른 모드 (30초, 무료 Audit용)**:
- 7 엔진 동시 호출 → 4 에이전트 병렬 실행 → 1페이지 PDF

**풀 모드 (10분, 회원 가입자용)**:
- 7 엔진 동시 호출 → 4 에이전트 순차 실행 (서로 결과 참조) → 다중 페이지 PDF

### 4.3 L-park 코드 재활용
- L-park 프로덕션의 CrewAI + Hermes 멀티 에이전트 구조 그대로 이식
- Findable 도메인 특화 프롬프트만 새로 작성

---

## 5. Korean Entity Grounding 알고리즘

### 5.1 목적
"아모레 / Amorepacific / 아모레퍼시픽 / 아모레Pacific" → 동일 브랜드로 인식

### 5.2 단계
1. **표기 변형 수집**: 사용자 입력 + 자동 추출 (한국어 형태소·영어 음역·혼용)
2. **임베딩 생성**: HyperCLOVA X 임베딩 API → Pinecone 저장
3. **클러스터링**: Cosine Similarity > 0.85 → 동일 엔티티 그룹
4. **추적 시 적용**: 7 엔진 응답에서 모든 변형 매칭 → 통합 SoV 계산

### 5.3 한국 특화 사전
- KoNLPy 형태소 분석
- 자체 한·영 음역 사전 (예: "퍼시픽" ↔ "Pacific")
- 한국 브랜드 표기 변형 데이터셋 자체 구축 (사업 종료 후 학계·정부 R&D 활용 가능)

---

## 6. 비용·성능 최적화

### 6.1 캐싱 전략
- **엔진 응답 캐시**: 동일 (도메인 + 프롬프트 + 엔진) 조합은 24시간 캐시 (Redis 또는 Vercel KV 후속)
- **검색 결과 캐시**: Naver Search·Daum 결과는 1시간 캐시
- **PDF 캐시**: 생성된 PDF는 7일간 Vercel Blob

### 6.2 Rate Limit 대응
- HyperCLOVA X 429 → exponential backoff (1s/2s/4s), 5회 한도
- Naver Search API 일 25,000건 → 캐싱 강화 + 다중 앱 등록
- AI Gateway 자체 retry 로직 사용

### 6.3 비용 모니터링
- Vercel AI Gateway 자체 대시보드 → 일일 비용 추적
- 알림 임계치: 일 ₩50,000 초과 시 Slack 경고

---

## 7. 보안

### 7.1 인증·인가
- Clerk JWT 모든 API 검증
- 조직별 데이터 격리 (organizationId 기반 RLS)

### 7.2 시크릿 관리
- 모든 API 키는 Vercel 환경 변수
- `.env.example` 커밋 / `.env.local` 절대 커밋 금지
- Production 시크릿은 Vercel Dashboard에서만 입력

### 7.3 어뷰즈 방지
- Vercel BotID — 무료 Audit 봇 어뷰즈 차단
- IP·이메일 기반 rate limit (시간당 5회 Audit)

### 7.4 외부 호출 격리
- v1.5 스크래핑 작업은 Vercel Sandbox에서만 실행
- 메인 함수와 격리

---

## 8. 모노레포 구성

### 8.1 pnpm-workspace.yaml
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 8.2 turbo.json
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "type-check": {}
  }
}
```

### 8.3 패키지 의존성
- `apps/web` → `packages/core`, `packages/db`, `packages/ui`
- `packages/core` → `packages/db`
- `packages/ui` → 독립 (shadcn/ui 래핑)

---

## 9. 배포 아키텍처

### 9.1 환경
- **Production**: findable.co.kr (Vercel)
- **Preview**: PR마다 자동 생성 (`*.vercel.app`)
- **Development**: localhost:3000

### 9.2 vercel.ts (코드형 배포 설정)
```ts
import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  buildCommand: 'pnpm build',
  framework: 'nextjs',
  crons: [
    { path: '/api/cron/daily-tracking', schedule: '0 9 * * *' },
    { path: '/api/cron/weekly-report', schedule: '0 9 * * 1' },
  ],
};
```

### 9.3 GitHub 연동
- main 브랜치 → Production
- 모든 PR → Preview Deployment
- Vercel BotID·Speed Insights 자동 활성화

---

## 10. 기술 결정 로그 요약

| 결정 | 채택안 | 사유 |
|---|---|---|
| 프레임워크 | Next.js 16 App Router | Vercel 표준, Server Components |
| `middleware.ts` vs `proxy.ts` | **`proxy.ts`** | Next.js 16 권장 |
| AI 엔진 통합 | AI Gateway + 직접 fetch | 글로벌 4 통합, 한국 3 직접 |
| 결제 | Toss Payments 단독 | Stripe 한국 개인사업자 가입 불가 |
| DB | Neon Postgres | Vercel Marketplace, Branch 기능 |
| ORM | Drizzle | TypeScript 최강, 마이그레이션 명확 |
| Vector DB | Pinecone | Vercel Marketplace 통합 |
| 큐 | Vercel Queues | Fluid Compute 위에서 실행 |
| 인증 | Clerk | Next.js 5분 통합, 한국어 지원 |
| 모노레포 | Turborepo + pnpm | 표준 |
| 네이버 AI Briefing 통합 | **합성 전략 (v1.0) → 정식 (v1.5)** | 합법 리스크 회피 (구 Cue:는 종료됨) <!-- [확인사실 2026-07-22] Cue: 2026-04-09 종료 → AI Briefing으로 대상 교체 --> |

상세 의사결정 로그는 `DECISIONS.md` 참조.
