# Findable audit 원가 분석 (AI Gateway 크레딧)

> 2026-07-27. 계기: AI Gateway 무료크레딧 소진("depleted") 메일 + "몇 번 돌릴 수 있나 / 최저원가 경로" 질문.
> **이 문서는 분석만. 코드 미적용**(사용자 지시 "지금은 적용말고 분석만"). 적용 시 각 레버별 확인 후.
> 데이터 = Vercel AI Gateway Generations 로그 실측(2026-07-27) + 코드 확인.

---

## 1. audit 1건 콜 구성 (코드 확정)

`runner.ts`가 audit 잡마다 실행하는 것:

| 구성 | 콜 수 | 모델 | 크레딧 대상 |
|---|---|---|---|
| **본체(글로벌)** | 4엔진 × 4프롬프트 = **16콜** | gpt-5.4·claude-sonnet-4.6·perplexity/sonar·gemini-2.5-flash | ✅ Gateway |
| **본체(한국)** | 3엔진 (hyperclova·naver·daum) | 직접 API | ❌ 별도(크레딧 무관) |
| **CrewAI** | **4콜** (민지·Alex·수진 병렬 3 + 준호 1) | 전부 claude-sonnet-4.6 | ✅ Gateway |

- CrewAI는 `runner.ts:197`에서 **audit마다 자동 await 실행**. `crewResult` Json에 4에이전트 리포트 저장.
- ⚠️ agents.ts에 `MODEL_FAST=claude-haiku-4.5` **상수는 정의됐으나 미사용**(4에이전트 다 MODEL_DEFAULT=sonnet).

## 2. 실측 원가 (Generations 로그)

| 구성 | 콜 | 콜당 실측 | 소계 |
|---|---|---|---|
| perplexity/sonar | 4 | ~$0.0056 | $0.022 |
| openai/gpt-5.4 | 4 | ~$0.0086 | $0.034 |
| google/gemini-2.5-flash | 4 | ~$0.0072 | $0.029 |
| claude-sonnet(본체 짧은) | 4 | ~$0.008 | $0.032 |
| **본체 소계** | 16 | | **~$0.12** |
| **CrewAI claude-sonnet(긴호출)** | 4 | $0.04~0.09 (입력8~9.6K·출력2~3.9K토큰, 40초~1분19초) | **~$0.25** |
| **audit 1건 합계** | 20 | | **~$0.37** |

- **CrewAI가 총비용의 약 67%.**
- 무료크레딧 $5[추정] 가정 → **약 13건**이면 소진. (오늘 P0+P1 검증 4~5회로 depleted 설명됨)

## 3. 핵심 제약 — 본체 4엔진 모델은 못 바꿈

Findable = "**그 특정 AI(ChatGPT·Claude·Perplexity·Gemini)가 내 브랜드를 아는가**" 측정 서비스.
→ 본체 4엔진 모델을 llama/저가로 바꾸면 **측정 대상 자체가 달라짐**(ChatGPT 측정이 아니게 됨). **본체는 정품 고정 필수.**
→ 바꿀 수 있는 건 **CrewAI(내부 분석 리포트, 측정 아님)뿐.** 여기서만 haiku·저가경로 가능.

## 4. 절감 레버 (임팩트순)

| 레버 | 방법 | 절감 | 크레딧수명 | 측정품질 | 구현 |
|---|---|---|---|---|---|
| 🥇 CrewAI 분리 | runner.ts:197 자동실행 제거 → on-demand 버튼(네이버 브리핑처럼) | $0.37→$0.12 (67%↓) | 13건→**40건(3배)** | 영향0 | 코드, 인프라 이미 있음(crewStatus) |
| 🥈 CrewAI haiku | agents.ts MODEL_DEFAULT→MODEL_FAST(이미 정의) | Crew $0.25→~$0.05[추정] | ~2배 | 내부리포트라 감내 | 코드 1줄급 |
| 🥉 rate-limit 도메인월1회 | route.ts 이메일+도메인24h → 도메인 기준 월1회 | 남용방지·원가통제 | — | — | 정책, 사용자결정 |

- 🥇+🥈 병행: 무료진단 건당 **$0.12**, 크레딧수명 **40건+**.

## 5. 무료 사용량 정책 (사용자 방향="아주무료=월1회급, 하루1회도 많다")

| 티어 | 조건 | 한도 | 근거 |
|---|---|---|---|
| 비로그인 | 이메일만 | 도메인당 평생/월 1회 | 리드수집. 재진단은 로그인 유도 |
| 이메일 인증 | 확인 | 월 1~2회 | 현행 "24h 1회"는 과함→월단위 조임 |
| 로그인(무료플랜) | 계정 | 월 2~3회 | 대시보드 이력 유인 |
| 유료(insider/pro) | 결제 | 일단위/무제한 | 원가 회수 지점 |

- ⚠️ **남용 방지 핵심**: 현행 "이메일+도메인 24h"는 **이메일 무한생성으로 뚫림**. 진짜 방어 = **도메인 기준 카운터**(같은 회사 여러 이메일 우회 차단) + 로그인 게이트.
- 일 원가상한: $5·건당$0.12 → **하루 ~40건**. 도메인당 월1회면 하루 40개 신규도메인 = 초기 콜드영업 충분.

## 6. 확정 단가 (웹리서치 2026-07)

- **Vercel AI Gateway 무료크레딧 = 월 $5, 30일마다 자동 리셋**(크레딧 미구매 시). 구매하면 무료 영구소멸→pay-as-you-go. 마크업 0. (costbench·instagit 확인)
- **Claude 단가**: Sonnet 4.6 = 입력$3/출력$15 per 1M. **Haiku 4.5 = 입력$1/출력$5 = Sonnet의 정확히 1/3.** (finout·cloudzero·metacto 확인)
- 추가 레버: **prompt caching 캐시입력 90%↓** / batch 50%↓(단 batch는 실시간X→audit 부적합).
- ⚠️ BYOK 우회 불가 확정: paid tier 전용, 크레딧0이면 막힘.
- OpenRouter/Groq 등 대안: 본체는 상용모델 측정이라 대체불가(§3). CrewAI만 대체가능하나 Gateway haiku로 충분→별도 이전 불필요.

## 7. 시나리오별 원가·횟수 (확정 수치)

| 시나리오 | 본체16콜 | CrewAI | audit 1건 | 무료$5로 |
|---|---|---|---|---|
| **현행**(Crew 자동+sonnet) | $0.12 | $0.25 | **$0.37** | **~13번** |
| Crew haiku(자동유지) | $0.12 | $0.083 | $0.20 | ~25번 |
| **Crew 분리**(본체만) | $0.12 | $0(버튼시만) | **$0.12** | **~41번(3배)** |

- **크레딧은 매월 $5 자동 리셋** → 충전 불필요. 리셋 기다리면 다음 달 다시 13~41번.

## 8. 전략 확정 (2026-07-27, 파트너 진입 대응) ★

> **맥락 전환**: "나 혼자 테스트"→**"KAIST 오버엣지 파트너 5~20명이 자주 측정"**. 무료 조이기(X)→
> **"파트너 안 끊기고 측정 + 원가 감당 + 심층은 유료로 돈"** 구조로 전환.
> 최우선 = **파트너 앞 429(측정끊김) 방지** = 신뢰붕괴 최악. 원가절감이 곧 안정성.

### 핵심 전략 한 줄
무료측정은 **CrewAI 빼서 가볍고 안정**(건당 $0.12), 심층분석(CrewAI 4에이전트)은 **유료 차등**. 승인 파트너는 **일 1회** 게이트로 관대하되 남용 차단.

### 티어 매트릭스
| | 비승인 리드 | **승인 파트너(무료)** | 유료(pro) |
|---|---|---|---|
| 측정(본체 7엔진) | 도메인당 월 1회 | **일 1회** | 무제한 |
| 매출번역·경쟁벤치 | ✅ teaser | ✅ | ✅ |
| **CrewAI 심층 4에이전트** | ❌ | 🔒버튼→유료유도 | ✅(haiku) |
| before/after 이력 | ❌ | 최근 3개 | 무제한 |
| 건당 원가 | $0.12 | $0.12 | $0.12+haiku심층 |

### "일 1회" 선택 근거(숫자)
- 무료 $5 = Crew분리 후 월 41건 천장. 파트너 20명 × **실사용 ~2회**(GEO는 주1~2회 확인이 자연스러움, 매일 안 봄) = 월 40건 → **무료 감당**.
- 일 1회 = 체감 관대(안정·신뢰) + 실사용 낮음(원가OK) + 스팸차단 + 매일/심층 필요시 유료유도. 주3회는 파트너 늘면 부족, 무제한은 429 폭주위험.

### 3중 맞물림
1. **원가·안정**: CrewAI 분리→$0.12→파트너20명 무료$5 감당→429 안 남(파트너 앞 신뢰).
2. **남용방지**: 승인 아이디 일1회 게이트(insider 플랜 연동).
3. **유료전환**: 시뮬이 원한 "가치증명"(심층4에이전트)을 유료 미끼로. 무료엔 🔒버튼만.

### 실행 순서 (코드는 사용자 승인 후)
| 순위 | 할 일 | 성격 | 효과 |
|---|---|---|---|
| 🥇 | CrewAI 무료측정서 분리(on-demand 버튼) | Claude 코드 | 원가67%↓·안정3배 |
| 🥈 | 승인아이디 일1회 게이트(insider plan 연동, route.ts) | Claude 코드 | 남용방지+차등 |
| 🥉 | 파트너=insider plan 부여 방식(수동 Clerk metadata / 자동) | **사용자 결정** | 승인제 운영 |
| 4 | CrewAI haiku 전환(유료 심층분석 마진) | Claude 코드 | 유료마진 |
| 5 | 크레딧 소진 전 경고 알림 | Claude 코드 | 파트너 앞 429 예방 |

### 인프라 재사용(이미 있음)
- plan 모델 free/insider/pro (`packages/auth/plan.ts`), Clerk publicMetadata, admin 화이트리스트.
- CrewAI 분리 인프라: `crewStatus` 필드 + 네이버 브리핑 on-demand 패턴 참고.
- rate-limit: `route.ts` 이메일+도메인24h → 도메인기준+플랜별 일/월 카운터로 확장.

### 남은 결정(사용자)
- 파트너에게 insider plan 부여를 수동(Clerk Users>Metadata `{"plan":"insider"}`)으로 할지, 초대코드/자동화할지.
- 유료 가격·심층분석 패키징(별건).

---

## 9. ✅ 실행 완료 상태 (2026-07-27 최종)

> **원가전략 전부 적용·배포·설화수 실측검증 완료. Vercel AI Gateway 크레딧 소모 = 0.**

### 엔진 라우팅 (본체 7엔진, 커밋 3c4c2fe·a6a9504·4e34cbd)
| 엔진 | 경로 | 지갑 | 상태 |
|---|---|---|---|
| chatgpt·claude | Letsur(gw.letsur.ai, OpenAI호환) | Letsur 16만원(~$110≈1000회) | ✅ |
| gemini | Google AI Studio 무료 | 하루 1,500회 무료 | ✅ |
| perplexity | 공식 API(api.perplexity.ai, `.chat()`) | 프로모션 $10(60일≈400회) | ✅ |
| hyperclova·naver·daum | 직접 API | 별도 | ✅ |
| **Vercel Gateway** | — | — | **$0 안 씀** |
- env: LETSUR_API_KEY·GOOGLE_API_KEY·PERPLEXITY_API_KEY 등록됨.
- ⚠️함정: createOpenAI 기본 provider()=/responses. Perplexity는 그 경로 없어 404→`.chat()` 필수. Letsur는 /responses 지원.
- ⚠️Gemini키=demo-lotteworld서 재사용(공유). 향후 Findable전용 무료키 발급 검토(유료Tier1 계정소속 가능성).
- **병목=Perplexity $10(≈400회)이 제일 먼저 마름.** 파트너20명×실사용~2회면 1~2달. 넘으면 Perplexity만 소액 재충전.

### 심층분석(CrewAI) 4겹 방어 (커밋 6c83fed·b80db60)
1. 분리: 무료측정 자동실행X → 버튼(on-demand)만
2. haiku: sonnet→claude-haiku-4.5(1/3 원가, agents.ts)
3. Letsur 라우팅: resolveCrewModel(Letsur haiku, Vercel 폴백)
4. 유료 게이트: crew route `canRunDeepAnalysis`(admin·partner만, 리드 403)
- 심층분석 원가 ~$0.25→~$0.083. usage-tier.ts 공용헬퍼(resolveTier·canRunDeepAnalysis).

### 사용량 게이트 (커밋 6c83fed)
- admin(FINDABLE_ADMIN_EMAILS): 무제한 / 승인 파트너(FINDABLE_PARTNER_EMAILS): audit 이메일기준 하루1회 / 일반 리드: 이메일+도메인 24h.

## 10. ⬜ 다음 세션 투두 (새 세션 "파인더블 이어가자")
1. 🔵**파트너 승인 방식 리서치·결정** — 현재 env 콤마리스트=임시방편. 대중적 방법=로그인+plan(insider). 딜레마: /audit 비로그인 진입. 옵션 A(대시보드 로그인후 측정) / B(/audit 선택적 로그인) / C(env유지). **호출 "파인더블 파트너 승인 이어가자".** 인프라 有: Clerk소셜·plan.ts·대시보드·usage-tier.ts.
2. 결정 후 `FINDABLE_PARTNER_EMAILS`에 실제 파트너 이메일 등록(또는 A/B 방식이면 그 구현).
3. (선택) Gemini Findable전용 무료키 발급 / Perplexity 소진 시 재충전 모니터링.
4. (선택) prompt caching으로 CrewAI 입력 90%↓ 추가 절감.
