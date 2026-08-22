# CLAUDE.md — Findable

> KAIST OverEdge 2026 · A-01-O2 (프로젝트 규칙 초안)
> 근거: 2026-07-06 실제 폴더 구조 + 진단표.md 실측 결과. 확인되지 않은 규칙은 넣지 않음.

## 1. 폴더 구조 (실제 구조 기준 — next-forge 모노레포)

- **모노레포**: pnpm workspace + Turbo. 앱은 `apps/`, 공유 로직은 `packages/`.
- `apps/web` — 마케팅/랜딩 (다국어 `app/[locale]`), 진단 CTA `/audit`
- `apps/app` — 로그인 후 제품 대시보드
- ⚠️ `apps/api` — **죽은 앱이다. 여기에 새 코드를 넣지 말 것.**
  실측(2026-08-08): Vercel 프로젝트가 **없고**(`findable`·`findable-app` 둘뿐),
  `api.findable.co.kr` 은 **응답 000**(도메인 미존재), `apps/api/.vercel` 도 없다.
  → **배포되지 않으므로 무슨 코드를 넣어도 실행되지 않는다.**
  실제 cron 은 전부 `apps/web/app/api/cron/`, 웹훅은 `apps/app/app/webhooks/` 에 있다.
  > 사고 이력: 세션N-10이 결제 웹훅을 여기 넣어 커밋했다(테스트까지 통과). 배포가
  > 불가능한 위치라 "결제했는데 plan 이 free" 구멍이 그대로 남았고, 세션N-11이 이동시켰다.
- `apps/{docs,email,storybook,studio}` — 문서·메일·UI·운영 콘솔
- 앱 내부 규칙: 라우트는 `app/`, UI는 `components/`, 유틸·서버로직은 `lib/`
- **공유 기능은 `packages/`의 기존 패키지를 우선 사용** (직접 만들지 말 것):
  `database`(Prisma+Neon) · `auth`(Clerk) · `ai` · `analytics` · `seo` · `payments` · `internationalization` · `design-system` · `observability` · `security` 등
- **새 API 라우트는 해당 앱의 `app/api/[기능명]/route.ts`에 만든다.**
- 하위 폴더가 아니라 **이 루트의 CLAUDE.md만 로드**된다.

## 2. 코딩 규칙

- Next.js(App Router) · TypeScript **strict** · pnpm · Turbo
- **서버 컴포넌트 우선.** `'use client'`는 입력·인터랙션이 필요할 때만.
- DB 접근은 `packages/database`(Prisma) 경유. 앱에서 직접 SQL/커넥션 만들지 않음.
- 인증은 `packages/auth`(Clerk) 경유. 자체 세션 로직 새로 만들지 않음.
- 다국어 문자열은 `packages/internationalization` dictionary 사용 (하드코딩 금지).
- UI는 `packages/design-system` 컴포넌트 재사용 우선.

## 3. 금지 사항

- **`any` 타입 금지** (strict 유지)
- **`console.log` 잔존 금지** — 로깅은 `packages/observability` 사용
- **secret 하드코딩 금지** — 값은 `.env.local`에만 (git 제외됨)
- **비밀 키에 `NEXT_PUBLIC_` 접두사 금지** — 공개용(publishable·URL·GA·PostHog)에만 허용
- **service_role/서버 전용 secret을 클라이언트 코드에서 사용 금지**
- 기존 `packages/*`에 있는 기능을 앱에서 중복 구현 금지

## 4. 도메인 컨텍스트

- **Findable = 한국 최초 Agentic GEO 플랫폼.** 내 브랜드가 AI 검색(ChatGPT·Perplexity·Google AI 등) 답변에 얼마나·어떻게 인용되는지 진단하고, 인용되도록 개선한다.
- 핵심 문제: 한국어 기업 정보가 AI 답변에 거의 인용되지 않음(한국어 학습 비중 ~0.017%). SEO(검색순위)와 달리 **GEO/AEO(AI 답변 인용)** 를 다룬다.
- 핵심 진입점: 랜딩 CTA "무료 진단 받기 (3분)" → `/audit`
- 사용자 데이터는 **워크스페이스/조직 단위로 격리** (인증·권한은 Clerk 기반).

## 5. 검증 명령 (코드 작성 후 반드시 확인)

- `pnpm check` — lint(biome/ultracite) 통과
- 각 앱 `npx tsc --noEmit` — 타입 오류 0
  (실측 2026-08-08: web 0 · app 0 · **api 0** · studio 미확인 → 신규 작업이 이 수를 늘리지 말 것.
  ⚠️ 이전 기록의 "api 2"는 낡았다 — 결제 웹훅이 `apps/app` 으로 옮겨진 뒤 0으로 확인됨)
- `turbo build` — 빌드 통과
- ⚠️ turbo에 `typecheck` task는 아직 미정의 (앱별 tsc로 검사)

## 6. 출력 형식 (작업 보고 방식)

- 파일을 바꾸면 **변경한 파일 경로 + 이유**를 한 줄로 보고
- 실행한 **검증 명령(check/tsc/build) 결과**를 함께 보고
- **새 패키지 설치 전 먼저 묻기** (모노레포라 어느 워크스페이스에 넣을지도 확인)
- 모호한 지시("잘 만들어줘")보다 위치·제약을 콕 집어 작업

---

## 7. KAIST OverEdge 실습 연계 규칙 (매 Day 자동 적용) ⭐

> Findable을 소재로 오버엣지 베이스캠프 실습을 진행할 때 **항상 이 방식**으로. 실습 = Findable 실제 발전.

### 7.0 대전제 — 기존 Findable 유지 + 실습을 "재검토 렌즈"로
- **새로 만들지 않는다.** Findable은 이미 배포·결제·i18n·20패키지 완성. 새로 시작하면 있는 자산 버리고 4주 낭비 + 오버엣지 데모데이(10월)에 보여줄 건 작동하는 Findable.
- 실습의 역할 = **기존 Findable을 "재검토 렌즈"로 다시 보는 것.** 매 Day가 Findable의 약점·기회를 데이터로 드러내고, 방향을 다시 벼린다(발전·피봇).
- "새로 만들면 더 객관적 아닌가?"의 답: **객관성은 "백지"가 아니라 "회피 없는 재검증"에서 온다(→ 7.2 블라인드 재검증).** 팩트는 재사용하되 결론은 새로 도출.
- 발전 = 코드를 새로 짜는 게 아니라 **방향을 다시 조준하는 것.** Day01~06 문서로 조준 → Day07~ 코드로 실행(→ 7.4).

### 7.1 작업 위치
- 실습 산출물(.md)은 **`docs/day-NN_주제/`** 에 저장. 코드(apps/·packages/)는 Day07 전까지 **안 건드림**.
- 인덱스 = `docs/00_Index.md`, 문서→코드 다리 = `docs/_적용/실행백로그.md`.
- 실습 노트(학습기록)는 별도: `바이브코딩/카이스트_오버엣지_실습/바이브코딩/day-NN/`.

### 7.2 블라인드 재검증 (핵심 방식)
1. 기존 자산(`docs/PRD·ROADMAP·COMPETITORS·inputs/`)의 **팩트**만 근거로 사용
2. 기존 **결론**은 잠시 덮고, 내가 분석을 새로 도출
3. 마지막에 기존 결론과 **대조** → 차이 = 발견(피봇/강화 후보)
4. 표기 강제: `[확인사실]`/`[AI가설]`/`[확인필요]`. 추측으로 확정 금지(→ [[feedback_no_fabricated_facts]]).
5. 경쟁사 가격·시장수치는 **웹 공식 페이지로 재확인**, 못하면 `[확인필요]`.

### 7.3 발견 반영 = 확신도별 차등 (성급히 코드/방향 안 덮음)
- **저위험·확신**(문구 오류 등) → 문서 실수정 OK
- **고위험·방향결정**(North Star·타깃·범위 등) → 원본 유지 + **"🔍 [Day NN 재검토 제안 — 미확정]" 주석 병기**. 실고객/데이터 검증 후 확정.
- 모든 발견은 `docs/_적용/실행백로그.md`에 **코드 할일**로 등록(근거 §·대상 경로·우선순위).

### 7.4 ⚡ 코드 반영 트리거 (Day07~ 매 Day 지속, 끝 아님)
- **Day07은 "코드 반영 시작점"이지 종료점이 아님.** Day07~20+, 데모데이, 그 이후까지 매 Day **문서 재검토 + 코드 반영이 병행**된다.
- **Day07 이후 실습이거나, 사용자가 "코드 반영/MVP 반영/구현" 언급 시**: `docs/_적용/실행백로그.md`를 열어 미완(⬜) 항목을 **먼저 제시**하고 "이 중 뭘 실제 코드에 반영할지" 확인.
- 반영 시: 실행백로그 항목 → 실제 `apps/`·`packages/` 수정 → 검증(check/tsc/build) → 백로그 상태 ✅로 이동.
- 미확정(🟡) 항목은 반영 전 "실고객 검증했나" 재확인. 안 했으면 코드 반영 보류 권고.
- **매 Day 사이클(Day07~)**: ①실습 재검토(문서·발견) → ②실행백로그 갱신 → ③그날 반영 가능한 코드 반영 → ④검증 → ⑤백로그·노트 업데이트. 백로그가 마르지 않는 한 계속.

### 7.5 커리큘럼 진행 맵 (Day01~20 — 확정, 2026-07-07 사용자 제공)

**1주차 — 설계·기반 (문서 중심, 코드 거의 안 건드림)**
- Day01 프로젝트 진단 + Harness Engineering ✅
- Day02 시장분석·경쟁사·차별화 전략 ✅
- Day03 PRD v1·제품 범위
- Day04 ERD·RLS·자동화 후보·백로그 초안
- Day05 백로그 20개·TRD v1·프로젝트 구조

**2주차 — 구현 시작 (코드 반영 시작 ⚡)**
- Day06 기술 SEO·GEO·메타데이터·JSON-LD
- Day07 **CLAUDE.md 정식판 + Vertical Slice** ← 첫 실제 기능 구현
- Day08 맞춤형 Skill 템플릿
- Day09 MCP 기본 템플릿
- Day10 핵심 기능 2 + 오류 설계 (2주차 마감)

**3주차 — 핵심 기능 (Findable MVP 실질 발전)**
- Day11 Supabase Auth·RLS 적용 ⚠️(Findable은 Clerk+Neon이라 치환 필요)
- Day12 RAG 기본 + 문서 임베딩
- Day13 에이전트형 워크플로·자기개선 루프 (← Findable Mastra 4에이전트와 직결)
- Day14 운영 자동화·관리자 콘솔
- Day15 사용자 테스트·PDCA 개선

**4주차 — 프로덕션·이관**
- Day16 Vercel 자동배포·GitHub Actions
- Day17 로그·이벤트·알림
- Day18 보안·개인정보·런북
- Day19 프로덕션 릴리스·릴리스 노트
- Day20 운영 이관 문서·최종 점검

**코드 반영 경계**: Day01~06 = 문서/설계 중심. **Day07 Vertical Slice부터 실제 apps/ 코드 반영 시작**. Day11(인증)·Day12(RAG)·Day13(에이전트)·Day16(배포)이 Findable MVP를 실질 발전시키는 핵심 코드 Day.
**Findable 치환 주의**: 커리큘럼은 Supabase 전제(Day11 등)이나 Findable은 **Clerk 인증 + Neon+Prisma**. Supabase 실습은 Findable 스택으로 치환해 적용.
**경계 넘어서**: Day20 이후에도 재검토→백로그→반영→검증 사이클 유지. 데모데이(10월)·이후 개발에 계속.
- 각 Day 완료 시: `docs/00_Index.md` 링크 + 학습노트 갱신 + 필요 시 메모리 업데이트.
