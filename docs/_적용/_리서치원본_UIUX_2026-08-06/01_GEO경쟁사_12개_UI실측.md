# GEO/AEO 경쟁사 UI 실측 원본 (15개 툴)

> ⚠️ **재리서치 금지.** 2026-08-06 세션N-4에서 웹검색 예산 200회를 소진해 얻은 자료.
> 결정 요약은 `../UIUX_대개선_기획서_2026-08-06.md`. 이 파일은 **근거 원본**(라벨·수치·인용 원문).
> 표기: **VERIFIED** = 공식 페이지/문서 직접 확인 · **스니펫** = 검색 스니펫만(G2는 403 차단) · **INFERRED** = 3자 리뷰 추정

---

## 0. 교차 결론 (먼저 읽을 것)

### 히어로 KPI = 4개로 수렴 (사실상 카테고리 표준)
| 지표 | 채택 툴 |
|---|---|
| **Visibility %** | Profound·Peec·Rankscale·Evertune·Goodie·Trakkr·Gauge·Otterly·Athena — **전원** |
| **Position** (평균 순위) | Profound(5.1)·Peec·Evertune·Trakkr·Otterly(2.05) |
| **Sentiment** | Profound(GOOD/중립/BAD)·Peec(0~100)·Goodie·Gauge·Otterly |
| **0~100 점수** | Evertune "AI Brand Score"·Semrush "AI Visibility Score"·Rankscale |

⚠️ **Visibility ≠ SoV.** Visibility=몇 %의 답변에 등장 / SoV=경쟁사 대비 점유율. **업계는 둘을 따로 쓴다.**
⚠️ **전원이 순위를 병기한다** — Profound *"43.8%, 339위"*. 숫자만으론 좋은지 나쁜지 모른다.

### 0점 상태 = 이미 업계 관행 ("갭 프레이밍")
**최초 판단("경쟁사가 안 한다=차별화")은 오답.** Profound·Peec 2개만 보고 일반화한 실수.
| 툴 | 방식 |
|---|---|
| **Semrush** | **"Your brand not mentioned"** 태그 + **"Topic Opportunities"** |
| **AthenaHQ** | 갭을 **단일 원인 도메인까지 추적** ← **가장 구체적. 우리가 넘어야 할 기준선** |
| Otterly | 크롤가능성 체커 + 콘텐츠 감사 + "invisible 페이지를 AI 소스로" 브리프 |
| Goodie | "경쟁사는 인용되는데 당신이 안 보이는 토픽" |
| Gauge | Action Center — **임팩트/난이도 순 우선순위** |
| Trakkr | 엔진×포지션 **히트맵**(초록=강함/빨강=약함) |

### 🎯 진짜 공백 = 처방 (리뷰어 전체 합의)
> *"측정은 잘하는데 **무엇을 해야 할지는 안 알려준다**"*
> — Peec(*"모니터링 툴이지 최적화 툴이 아니다"*) · Ahrefs(*"데이터는 주는데 방향이 없다"*) ·
> Goodie(*"데이터만 보여주고 막막하게 남긴다"*) · Rankscale — **독립적으로 반복**

### 가격 게이팅 패턴 (전 툴 공통)
기본 티어 = ChatGPT·Perplexity·Gemini·Google AI Overviews / **상위 티어 = Claude·Grok·Meta·DeepSeek**

### 디자인 레퍼런스 부재
Dribbble GEO 관련 샷 **1개**([Wavespace](https://dribbble.com/shots/27127363-AI-Search-Visibility-Platform)) · Behance **0** · Figma Community **0**.
→ **카테고리가 너무 새로워 베낄 디자인이 없다.**

---

## 1. Profound (tryprofound.com) — 카테고리 리더

**네비게이션 (VERIFIED)** — [features/answer-engine-insights](https://www.tryprofound.com/features/answer-engine-insights), [help.tryprofound.com](https://help.tryprofound.com/articles/6240000968-interpret-answer-engine-insights)
```
Monitor: Answer Engine Insights · Prompt Volumes · Shopping · Agent Analytics
Create:  Agents
Operate: Aim
+ Dashboards (드래그앤드롭 위젯 빌더, 이름 저장 가능)
```
Answer Engine Insights 내부: Visibility Score · Share of Voice · Average Position · Citations · Sentiment ·
**"Visibility Rankings By Topic"** · Opportunities · Relevant Prompts · **Query Fanouts** · Topics/Platforms 드롭다운

**KPI (VERIFIED)** — 각 지표를 **선그래프(추세+이전기간 비교 토글)** + **도넛/바(경쟁사 비교)** 양쪽으로 제공
| 지표 | 형식 실측값 |
|---|---|
| Visibility Score | **43.8%** + 순위 **339위** |
| Share of Voice | % + 순위 **344위** |
| Average Position | **5.1** |
| Citation Share/Rank | % + 순위 |
| Mentions | **1577 Mentions** (원시 카운트) |
| FactCheck | **61.2%** (주장 vs 정답 정확도) |
| Sentiment | GOOD / NEUTRAL / BAD 버킷 |

**차트**: 선(추세) · 도넛(SoV 경쟁사 분할) · 바(감성분포·인용도메인 순위) · 리더보드 표(토픽×브랜드) · **세계 히트맵(지역별 가시성)**

**0점 상태 (VERIFIED)**: **전용 화면 없음.** 같은 위젯에 나쁜 숫자를 그대로 표시 —
*"0.1%의 관련 AI 답변에 등장, 339위"* / *"share of voice 0%, 344위"* ([블로그](https://www.tryprofound.com/blog/how-to-track-your-visibility-in-ai-search))

**온보딩 (VERIFIED)**: "몇 분 내 설정·추적 시작". **업종 기반 추천 프롬프트 세트 자동 시딩**(편집·삭제 가능).
권장 워크플로 9단계: 프롬프트/토픽 식별 → 베이스라인 → 강한 토픽 필터 → 경쟁 벤치마크 → 인용 확인 → 감성 → Agent Analytics(크롤러) 설치 → GA 연결(매출 귀속) → 쇼핑/제품 뷰
+ **Profound University**(엔터프라이즈 4주 프로그램: 1주 인텐트/프롬프트 정의, 2주 로그소스 연결) — INFERRED

**AI 답변 표시 (VERIFIED)**: *"Answers straight from the source—**Other tools pull AI responses from the API. We capture directly from the browser.**"*
커버: ChatGPT·Perplexity·Claude·Gemini·Google AI Overviews·Copilot·Grok·DeepSeek
개별 프롬프트 클릭 → **"full responses"** = *"AI 엔진이 우리 브랜드를 정확히 어떻게 서술하는지"*. 브랜드명 하이라이트 여부는 미확인(INFERRED)

**내보내기 (VERIFIED)**: **원클릭 PDF** · **공개 링크 생성**(로그인 없이 열람) · 필터(날짜·토픽·태그·플랫폼·지역·페르소나)가 **세션 간 자동 저장**되고 export에 반영
Slack 전송·예약 메일은 **미확인**(없다는 뜻 아님)

**가격 (VERIFIED)** — [pricing](https://www.tryprofound.com/pricing)
| 티어 | 가격(연납) | 엔진 | 프롬프트 | 비고 |
|---|---|---|---|---|
| Starter | **$99/mo** | ChatGPT만 | 50 / 월1,500응답 | Agent 100크레딧, 1석, **export 없음** |
| Growth ⭐ | **$399/mo** | 3개(+Perplexity·AI Overviews) | 100 / 월9,000응답 | 400크레딧, 3석, CSV, 월3기사 |
| Enterprise | 커스텀 | **최대 9개**(+Gemini·Copilot·Grok·DeepSeek·Claude) | 커스텀 | Shopping·Prompt Volumes·Aim·API·SSO/SAML·전용Slack·24h SLA |

**리뷰 (스니펫 — G2 403 차단)** — [G2](https://www.g2.com/products/profound/reviews)
- 평점 **4.6/5, 845~1,123 리뷰** (74% 5★ / 23% 4★)
- 🔴 **핵심 인용**: *"a luxury car that was **amazing to drive** but had a few buttons and switches you didn't know what to do with."* (Profound University 이후 개선됐다고 덧붙임)
- 불만: *"steep learning curve due to the extensive features"* · *"data-heavy... overwhelming **without a dedicated analyst**"* · **신규 사용자 숙련 4~8주**
- ✅ **칭찬도 많음(내가 처음 놓친 부분)**: *"UI·UX가 꽤 좋고 상당히 직관적. **온보딩·지원이 필요 없었다**"* · *"디자인이 좋고 단순해서 금방 익혔다"*
- 반전 인용: *"insights... but **not so much that I get lost in the sauce** like I do when I use other products like SEMRush or Ahrefs"* (저신뢰 출처)

---

## 2. Peec AI (peec.ai) — "깨끗함" 포지션

**사이드바 (VERIFIED, 3개 독립 출처 교차)** — [docs.peec.ai](https://docs.peec.ai/understanding-your-performance), [Ethan Lazuk 가이드](https://ethanlazuk.com/blog/complete-guide-to-using-peec-ai-with-actionable-takeaways/), [Marketer Milk](https://www.marketermilk.com/blog/peec-ai-review)
```
Overview(Dashboard) · Prompts · Sources(→ Domains / URLs) ·
Competitors(Brands) · Query Fanouts · Tags · Topics
+ Gap Analysis · Crawlability · Insights & Performance Matrix
```

**KPI (VERIFIED)** — Overview "Brands" 비교표에 내 브랜드 + 상위 경쟁사 4지표 나란히
| 지표 | 정의 |
|---|---|
| **Visibility** | *"percentage of AI responses where your brand appears"* |
| **Share of Voice** | 추적 경쟁사 전체 대비 언급 점유율 |
| **Sentiment** | **0~100 스케일** — *"how positively AI platforms describe your brand"* |
| **Position** | 언급 시 평균 순위(낮을수록 좋음) |

홈 스크린샷 문구: *"Visibility trending up by **5.2%** this month"* + "Last 7 days" 기간 선택

**차트 (VERIFIED)**
- **Visibility Graph**: 선차트, 내 브랜드 vs **상위 6 경쟁사**, 일별, 기본 7일
- **Top Sources / Source Type**: 바차트 — Editorial·Corporate·UGC·Reference·Institutional·Competitor·Other
- **Top Domains 표**: Retrieved % · Retrieval Rate · Citation Rate · Type
- **Performance Matrix**: X/Y 커스터마이즈 산점도 — 토픽 × AI 모델 (프롬프트×모델 매트릭스)
- 🔴 **구체적 불만**: URLs 탭 선차트가 *"just **one confusing line**"* vs Domains 탭은 소스별 개별 라인 (Marketer Milk)
- **Volume bars**: 1~5 색상코드 바(beta) — *"very low"~"very high"*. **실제 검색량 숫자는 안 보여줌**(한계)

**핵심 인용 (VERIFIED)** — 프롬프트별 뷰
> *"active prompts view shows **position, sentiment, and visibility % per prompt** alongside competitor logos — so you can see at a glance **where you're winning and where you're not**"*

→ **이게 "밀리는 질문 리스트"다. 업계 1군은 이걸 메인에 둔다.**

**온보딩 (VERIFIED)** — [quickstart](https://docs.peec.ai/quickstart-guide)
1. 도메인/브랜드 추가 2. **프롬프트 — "Suggested" 탭(사이트에서 자동생성)** + 수동 Add, ~10개로 시작
3. 경쟁사 — 자동제안 또는 "+ Add Competitors". **정확한 브랜드명 쓰라고 경고**("HubSpot" not variants), alias 설정
4. Overview 확인(몇 분 내) 5. Sources 확인
- 모델 선택은 **별도 온보딩 단계 아님** — 설정 후 필터로 적용
- *"30분이면 다 이해. 복잡한 UI 헤매는 데 몇 주 걸리지 않음"* / 단 *"가이드 튜토리얼·인터랙티브 워크스루는 부족"*
- **CEO가 가입 후 개인 환영메일** 발송(Marketer Milk)

**AI 답변 표시 (VERIFIED)**: **"Recent Chats/Mentions"** = 실제 답변 카드(프롬프트 원문·포지션·감성점수·경쟁사 로고·타임스탬프).
프롬프트 클릭 → Overview 레이아웃 필터링 + **"Common terms"** 분석. **Query Fanouts**는 어느 모델이 각 배경질의를 생성했는지 표시(모델별 질의문+발생횟수)

**내보내기**: **CSV 원클릭**(Prompts) · **Looker Studio 연동**(Starter부터). **PDF·예약메일 없음**(미발견)

**가격 (VERIFIED, 단 출처 간 불일치)** — [TechCrunch $21M 투자](https://techcrunch.com/2025/11/17/as-consumers-ditch-google-for-chatgpt-peec-ai-raises-21m-to-help-brands-adapt/)
| 티어 | 가격 | 프롬프트 | 비고 |
|---|---|---|---|
| Starter | **€89/mo**(~$103) — TechCrunch는 €75/25프롬프트로 표기 | 25, 일별 | Looker Studio |
| Pro/Professional | **€199/mo**(~$230) — 다른 출처는 $249/150프롬프트 | 100~150, 일별 | 무제한 지역 |
⚠️ **가격 불일치 = 2026년 중 리프라이싱 추정. 인용 전 peec.ai/pricing 직접 확인**

**리뷰 (스니펫)** — [G2](https://www.g2.com/products/peec-ai/reviews) **5.0/5, ~37 리뷰**(표본 작음)
- *"I find Peec AI **easy to use and fairly straightforward**. It's the best tool for measuring how we show up in AI overviews"*
- *"clean and focused platform design"* · *"easy navigation from overview to deeper analysis"* · *"**the UI is the best on the market**"* · *"clarity and simplicity of the interface that are truly outstanding"*
- Marketer Milk(직접 확인): *"Clean, simple interface that **doesn't feel overwhelming**"* · *"Everything I need to quickly assess...is right there when I log in"* · *"**Within 30 minutes** of using the tool you'll understand all of its features"*
- 🔴 불만: *"**a monitoring tool rather than an optimization one**"* — *"shows where you're invisible... but doesn't help you fix it"* · 콘텐츠 갭 분석 없음 · *"'경쟁사가 인용되는 이유는...' 같은 추천이 없다"*
- 프롬프트 한도 불만: Professional 150개도 *"포괄적 추적엔 부족"*

---

## 3. Semrush AI Toolkit / AI Visibility Index

**네비 (VERIFIED)** — 왼쪽 nav **"AI"** 클릭해 확장. [KB 1496](https://www.semrush.com/kb/1496-getting-started-with-ai-visibility-toolkit), [KB 1493](https://www.semrush.com/kb/1493-ai-seo-toolkit)
```
Visibility Overview · Competitor Research(최대 4개) ·
Prompt Research("keyword research for AI") · Brand Performance ·
Prompt Tracking · AI Search Site Audit(Site Audit 내 "AI Search Health 위젯")
+ Insights · AI Strategic Opportunities · My Reports
```
Brand Performance 하위: **Share of Voice vs. Sentiment 차트** · **Perception Report**(감성 추세) · **Narrative Drivers**(Top Cited Domains + 영향력 질문) · **Questions Report**

**KPI (VERIFIED)** — [KB 1594](https://www.semrush.com/kb/1594-ai-seo-metrics), [KB 1596](https://www.semrush.com/kb/1596-visibility-overview-report)
- **AI Visibility Score**: **0~100** — *"a benchmark score (0–100) showing how often your brand appears in AI-generated answers compared to competitors"*
  집계 요소: 언급빈도 + 인용수 + 경쟁사 대비 SoV + 플랫폼 분포
- 3개 "trend lens" 탭: **Main Metrics**(Mentions·Cited Pages·Citations) / **Monthly Audience** / **AI Visibility**(플랫폼 비교)
- **Mentions** = *"total number of prompts in which a brand is included in AI responses"*
- **Citations** = *"number of AI responses that cite your domain as a source"*
- **Monthly Audience** = 브랜드 등장 질의의 추정 도달

**차트**: 선(1M 일별 / 6M 기본 / All time 월별) · LLM별 분포(Mentions↔Cited Pages 토글) · Mentions by Country · SoV vs Sentiment 콤보 ·
멀티탭 데이터표(Your Performing Topics / Topic Opportunities / Cited Sources / Source Opportunities / Cited Pages — Visibility·Your Mentions·AI Volume·Competitors Mentioned로 정렬)

**🔴 0점 상태 (VERIFIED — 업계에서 가장 명시적)**
- 답변 상세 모달에 **"Your brand not mentioned"** 태그를 **문자 그대로** 표시
- **"Topic Opportunities"** = 경쟁사는 언급·인용되는데 내 브랜드는 없는 프롬프트
- 동일 논리: **"Source Opportunities" / "Missing Sources" / "Missing Topics & Prompts"**
- [갭 찾기 블로그](https://www.semrush.com/blog/find-ai-visibility-gaps-with-semrush/)

**온보딩 (VERIFIED)** — [Academy](https://tr.semrush.com/academy/onboarding/ai-visibility-toolkit/) 3경로(라이브 1h / 영상 15min / 인증과정 1.5h)
6단계: ①툴킷 투어 ②AI 가시성 측정(프로젝트 생성·경쟁사 대비 점수) ③SoV·브랜드 인식 이해 ④프롬프트 리서치 ⑤3자 언급 기회 ⑥LLM 최적화 기회(사이트감사)
⚠️ 이건 **Academy 과정**이고 **인앱 위저드 확인 안 됨**

**내보내기 (VERIFIED)**: **PDF export 버튼(우상단)** — *"clean, shareable report in seconds"* · CSV · **공유 온라인 대시보드 링크(24/7)** · **예약 리포트(일/주/월 PDF 자동발송)** · **My Reports**(브랜드 템플릿, GA 연결시 AI 트래픽 위젯)

**가격 (VERIFIED)** — [pricing/ai](https://www.semrush.com/pricing/ai/)
**$99/month**(연납, 도메인당): 25 커스텀 프롬프트(일별) · Brand Performance 1도메인 · ChatGPT/Google AI/Gemini/Perplexity · 경쟁분석 · 프롬프트 리서치 · AI Site Audit · **일/주/월 갱신** · 300 리포트/일
애드온: 유저 +$45/mo · Lead Gen $90 · Base Report $10 · Pro Report $20
**Enterprise**: Grok·Claude 포함 전체 LLM, 세일즈 데모 게이트
+ **무료 [AI Search Visibility Checker](https://www.semrush.com/free-tools/ai-search-visibility-checker/)**(로그인 없음, 리드젠)

**리뷰**: G2 **4.5/5** / Capterra **4.6/5** (2,000+ 리뷰)
🔴 핵심 불만: *"the dashboard has become **even more crowded**"* (AI Toolkit 추가 이후) · *"**intimidating for beginners** who just want to do one specific task"* · *"so much packed in that **finding things becomes a job in itself**"*
= **기능 비대·네비게이션 과부하.** AI Toolkit을 이미 빽빽한 제품에 얹은 결과
✅ 반대 의견: 다수가 *"interface as intuitive"*, 금방 익숙해짐
[Founderpass 직접 리뷰](https://www.founderpass.com/reviews/my-review-of-the-semrush-ai-visibility-toolkit): **방법론 불투명**(*"질의 몇 개, 어떻게 골랐는지 설명이 모호"*) · 추천이 *"broad and could apply to many businesses"*(범용성 불만)
⚠️ Reddit 스레드는 **찾지 못함**(부재 확인 아님)

---

## 4. Ahrefs Brand Radar

**탭 (VERIFIED, 3출처 교차)** — [help](https://help.ahrefs.com/pt-BR/articles/11064852), [use cases](https://ahrefs.com/blog/brand-radar-use-cases/), [academy](https://ahrefs.com/academy/how-to-use-brand-radar/intro)
```
Overview · AI Visibility(AI Responses) · Search Demand ·
Web Visibility · Video Visibility · SERP Visibility
+ Cited Domains · Cited Pages
```
**Reddit·TikTok 추적 2026-01 추가** ([보도자료](https://www.businesswire.com/news/home/20260106995102/en/Ahrefs-Adds-YouTube-and-Reddit-Tracking-to-Brand-Radar)). *"Ahrefs' **fastest-growing product**"*, **독립 툴**(무료·유료 전체 사용자)

**KPI (VERIFIED)** — [방법론](https://ahrefs.com/blog/brand-radar-methodology/)
- **AI Share of Voice** (%) = *"the percentage of brand impressions out of the total impressions for responses that mention any tracked brand"*
- Mentions · Citations · **Estimated Impressions** = *"mentions weighted by Google search volume to model potential exposure"*
- 🎯 **"Found, but not cited"** — 답변에 **이름은 나오는데 하이퍼링크/인용이 없는** 상태
  → **훔칠 가치 있는 지표. 대부분 경쟁사가 이 둘을 구분하지 않는다.**

**차트**: 선(SoV·mentions·impressions 추세) · 플랫폼 비교 바 · 정렬 가능 표(Relevance 또는 Search Volume). **도넛 미확인**
[Looker Studio 커넥터](https://ahrefs.com/blog/new-features-apr-2026/): *"history charts for AI mentions, impressions, and AI Share of Voice, plus distributions across brands and platforms"*

**0점 상태**: **문자열/스크린샷 미발견.** SoV가 비율이라 0%/0으로 표시될 것으로 추정 — **Semrush와 달리 전용 empty-state 문서화 없음**(문서 공백)

**온보딩 (VERIFIED, 부분)**: **"no setup required"** — 프로젝트 생성 위저드 없이 *"millions of prompts and AI responses"*를 즉시 검색. 진입점 = *"search any brand or topic"*
+ 무료 [AI Visibility Checker](https://ahrefs.com/ai-visibility-checker)(로그인 없음)
인앱 튜토리얼 **미발견** → 검색 우선(search-first) 온보딩

**AI 답변 표시 (VERIFIED)**: **AI Responses** 탭 = 개별 AI 답변 + 트리거 질의, AI 인덱스별 필터
🎯 **중첩 불리언 필터**: `Query contains {brand}` · `Response contains {brand}` · `Citation contains {domain}` + AND/OR/NOT — **베낄 파워 기능**
🔴 [Canny 요청](https://ahrefs.canny.io/brand-radar): *"a **badge icon** that lives next to the LLMs"* — **어느 모델 버전인지 안 알려줌**(투명성 공백)
엔진: Google AI Overviews·AI Mode·ChatGPT·Perplexity·Gemini·Copilot·**Grok**(2026-04 추가). 🔴 **Claude 미추적**(다수 출처 확인)

**내보내기**: **API**(2026-04 한도 4배) · **Looker Studio 커넥터** · Report Builder 위젯. **PDF 미확인**

**가격 (VERIFIED)** — [brand-radar](https://ahrefs.com/brand-radar/)
| | 가격 |
|---|---|
| Select platforms | **$398/mo** |
| All platforms | **$699/mo** (6엔진 + 월 2,500 커스텀 프롬프트 체크) |
| + 기본 Ahrefs 구독 필수 | $129~449/mo |
| + YouTube/TikTok/Reddit 모듈 | **$199/mo** |
| **현실 총액** | **$828~1,148/mo** |
**"1 check" = 1프롬프트 × 1LLM × 1지역** (게이팅 단위 정의)
베타 무료 종료: *"That phase is over."* · ARR *"$1M every two weeks"*(집계 출처, 미검증)

**리뷰 (VERIFIED, 리뷰블로그가 깊음)**
- 🔴 *"you can only look at the top topics from **one AI platform at a time**. There's no option to select multiple AI tools."*
- 🔴 **엔티티 혼동**: 경쟁사 "Grin"을 일반 단어 "grin"과 혼동 → *"alligator vs. crocodile"* 같은 무관 토픽 노출. Semrush도 같은 문제
- 🔴 **데이터 신선도**: *"All AI chatbot data is updated **just once a month**"* (Google AI Overviews만 준실시간)
- 🔴 *"Brand Radar arms you with...data...But it **doesn't provide you with any direction to improve it**"*
- 🔴 매출 귀속 없음(GA4 미연동) · **97.5% 불일치** 사례(측정 신뢰 관련 인용가치 높음)
- Canny 불만: 날짜필터 UX(사용가능 범위를 UI가 안 보여줘 **추측**해야 함) · LLM 응답 대량 export 불가 · 비디오 매칭 부정확 · *"모든 기능이 유료화된다"* 불안
- [Profound 비교](https://www.tryprofound.com/blog/ahrefs-brand-radar-review): Ahrefs는 SEO팀 방향탐색엔 좋으나 *"not enough for AEO"*

**Semrush vs Ahrefs 종합** ([Layer3](https://www.layer3labs.io/comparisons/semrush-ai-visibility-vs-ahrefs-brand-radar), [Menra](https://www.menra.ai/vs/semrush-ai-toolkit-vs-ahrefs-brand-radar))
- Semrush 승: 가격($99 vs $828~1,148) · 프롬프트 유연성 · 기존 SEO 워크플로 통합
- Ahrefs 승: 엔진 폭 · 🎯 **"focused dashboard design" / "clean, standalone view"** — **메인 툴킷 nav에 안 밀어넣었기 때문**

---

## 5. Otterly.ai — 공개 문서 가장 충실

**구조 (VERIFIED)** — [otterly.ai](https://otterly.ai/), [features](https://otterly.ai/features), [help](https://help.otterly.ai/)
중심 = **"Brand Report"**. 기간 필터: Month to date / Last month / Last 14·30·60·90 days / Custom
Tag 필터: **All Tags · Branded · Non-Branded · Top-of-Funnel · Bottom-of-Funnel**
엔진 로고 필터 행: ChatGPT·Google AI Overview·Perplexity·Microsoft Copilot·Google AI Mode·Google Gemini·Claude API
좌측 사이드바 = Brand Report 목록 · 기어 아이콘 → "Brand details"

**KPI (VERIFIED)**
- **"Brand Mentions"** = **분수 표기** — *"3,181 / 410,785"* (내 언급 / 카테고리 전체)
- **"Average Brand Position"** = 소수 순위 — **"2.05"**
- 경쟁사 행이 두 지표 반복 (예: Nike 2,769 / 2.08)

**차트 (VERIFIED)**
- **"Brand Coverage Over Time"** 선차트 — "Me + Top 5 competitors" 토글
- **"Domain Coverage Over Time"** 선차트
- **Brand Sentiment** 색상코드 바(긍정/중립/부정)
- 🎯 **"Perception Map"** — **사분면 차트**(x=가시성, y=내러티브/감성 강도). 분면 라벨: **"Visible and Compelling" · "Good Story but Less Seen" · "Visible with a Weak Story"**. 경쟁사 점 클릭 → **battlecard**(순위·감성·인용페이지·추천) — 스니펫 확인, 중간 신뢰
- **"Top Prompts by Brand Mentions"** 순위 리스트

**0점 상태 (VERIFIED)**: *"If you're not being mentioned, your score will show it"* + 근본원인 도구 병치 —
**Crawlability Checker** · **Content Audit** · *"content briefs that turn **invisible pages into AI sources**"*
→ 부정 상태를 **즉시 처방과 페어링**(audit → brief → 재추적)

**온보딩 (VERIFIED)** — [getting-started](https://help.otterly.ai/getting-started): **4단계 AI 지원 설정** ①브랜드+브랜드명 변형 추가 ②자연어로 프롬프트 정의 ③엔진/시장 선택 ④첫 Brand Report 자동생성. **온보딩 콜 불필요**, 카드 없이 무료체험

**AI 답변 표시**: *"captures the **full text** of the AI response, not just a snippet"*. 모델별 드릴다운. 하이라이트 여부 미확인

**내보내기 (VERIFIED)**: **"Generate Report"** 버튼(우상단) → **PDF**, **"Document" 또는 "Presentation" 형식 선택**, 로고 업로드 옵션.
갱신: 주간(Starter) / 일간(Professional). 화이트라벨 없음 → **Looker Studio 커넥터**로 대체. PDF 커스텀 브랜딩은 Professional만

**가격 (VERIFIED, 직접 fetch)** — [pricing](https://otterly.ai/pricing)
| 티어 | 가격 | 프롬프트 | 비고 |
|---|---|---|---|
| Lite | **$29/mo** | 15 | 4엔진, 1,000 GEO URL 감사/월, 주3추천 |
| Standard ⭐ | **$189/mo** | 100 | 무제한 워크스페이스/추천, API·MCP 각 2,000req/월, Looker |
| Premium | **$489/mo** | 400 | 10,000 감사/월, API·MCP 각 5,000req |
| Enterprise | 커스텀 | 커스텀 | SSO, 전용지원 |
연납 15% off. 애드온: +100프롬프트 $99/mo · Claude/AI Mode/Gemini $9~439/mo

**리뷰 (스니펫)** — [G2](https://www.g2.com/products/otterlyai/reviews)
🔴 *"The UI is described as powerful, but it can feel **cluttered when users have a lot of prompts** and tracks going... **dashboard clutter is noted as the most common usability complaint**... at higher prompt volumes, the dashboard gets cluttered, and **sentiment tracking is underdeveloped**"*
✅ 소규모 셋업에선 *"clean UI/UX is praised"*. 종합: *"단일 브랜드 툴로는 편안하나 다수 클라이언트 콕핏으론 그저 okay"*
⚠️ Capterra 리스팅 못 찾음(URL이 무관 제품으로 리다이렉트)

---

## 6. AthenaHQ (athenahq.ai) — 🎯 0점 처리가 가장 구체적

**대시보드 (VERIFIED — 실측 스크린샷 리뷰)** — [nenawow 핸즈온](https://nenawow.com/blog/athenahq-review)
메인 대시보드 브랜드명 = **"Olympus"**
좌측 nav: **Olympus · Prompts · Sources · Content · Insights**
홈이 정적 그리드가 아니라 **대화형 질의 박스("Ask Athena")** 중심 + 4개 퀵액션:
*"how is my brand performing" · "compare my competitors" · "which sources cite me the most" · "what content should I create"*

**KPI (VERIFIED — 실제 공개 리포트 fetch)** — [docs.athenahq.ai 리포트](https://docs.athenahq.ai/guides/report-pitchId)
- **"Share of voice"** % — *"mentions the target brand received compared to all brands"*
- **"Brand mentions"** % — 언급한 AI 답변 비율
- **"Responses analyzed"** 카운트
- **"Models tested"** 개수+이름 — *"ChatGPT, Claude **+4 more**"*
실측 수치: **Mention Rate 44.4% · Absolute Mention Rate 26.7% · Citation Rate 16.7% · Share of Voice 27.6% · Responses Tracked 30**

**차트 (VERIFIED — 직접 fetch)**
- Share of voice — **도넛 + 순위 범례**
- AI model performance — **수평 바**(모델을 언급률 높은순)
- Brand traits — **레이더/스파이더**(긍정 vs 부정 속성, 경쟁사 대비. 데이터 있을 때만 표시)
- Competitive landscape — **수평 프로그레스 바**
- Top citation sources — **파비콘 + 언급수** 순위 리스트
- Responses 표 — Model / Mentioned(Yes/No 필) / Competitors Mentioned(로고+N배지) / Prompt / Response(잘림)

**🔴 0점 상태 (VERIFIED — 업계 최고 구체성)**
**"Topic-Level Breakdown"**에서 경쟁사 "SE Ranking"은 5개 발견 프롬프트에서 언급되는데 리뷰어 브랜드는 **0점**.
그리고 그 격차 전체를 **단일 인용 도메인 하나로 추적** — *"seranking.com이 30개 답변 중 **4개**에 인용됨"*
→ **"당신은 안 보입니다"를 "이 하나의 소스 때문에 안 보입니다"로 전환.** 우리가 넘어야 할 기준선.

**온보딩 (VERIFIED — 이례적으로 상세)**
①회사 이메일 가입(무료 도메인 불가, 화이트리스트는 없음) ②환영 화면 — 표시명 입력 + **"300 credits remaining"** 잔액 표시
③**AI가 도메인에서 회사 설명 자동 생성** → 확인/수정 ④**경쟁사 8개 자동 제안** 화면
⑤모델 선택/스케줄 — **모델별 크레딧 비용 표시**: *ChatGPT·AI Overview·Perplexity·Gemini·Copilot = 각 1크레딧* vs *Grok·Claude·DeepSeek = 각 5크레딧이며 잠김*

**AI 답변 표시 (VERIFIED)**: 마크다운 렌더 전문 + **브랜드/경쟁사명 시각적 하이라이트**. 클릭 → 메타데이터(모델·날짜·순위).
Google AI Overview 답변엔 접이식 추가 섹션: **"Organic Results" · "People Also Ask" · "Related Searches"**

**내보내기 (VERIFIED)**: **공개 공유 링크**(복사 버튼 · "Powered by AthenaHQ" 표기 · 생성일 스탬프) — **리드젠 아티팩트로 기능**(공개툴 생성시 "See pricing"/"Book a demo" CTA 배너).
Enterprise: CSV · BI 연동 · 임원/보드용 대시보드. 예약메일 미발견

**가격 (VERIFIED, 단 불일치)**
| 티어 | 가격 | 비고 |
|---|---|---|
| Essential | **무료** ($25 크레딧 / 300크레딧) | 5모델, 무제한 팀원, 콘텐츠 추천 |
| Starter | **$295/mo** ([Cintra](https://cintra.run/blog/athena-hq-review)) ↔ **$95/mo, 3,600크레딧** ([nenawow](https://nenawow.com/blog/athenahq-review)) | 9모델, API 애드온, CSV, 자기학습 콘텐츠 에이전트 |
| Enterprise | 커스텀 | Knowledge Base · **"Oracle"**(불일치 탐지) · **ACE**(Athena Citation Engine) · SSO · 감사로그 · 멀티지역/언어 |
⚠️ **Starter 가격 2배 차이 — 반드시 직접 확인**
게이팅: **Insights 탭에 자물쇠 아이콘** · "Prompt Volume"·"Oracle"은 Enterprise 전용 **Beta**

**리뷰 (스니펫)**: G2 **4.6/5, 32 리뷰**. *"Olympus는 **mid-market에서 가장 잘 설계됨**"* · *"easy to use, intuitive, clean interface"*
🔴 불만: *"**Prompt volume data isn't as visible**"* · 스타트업 특유 버그 · 범용 아웃리치 초안 · 셀프서브 제한 · 벤치마킹 깊이
🔴 **가장 반복되는 불만 = 크레딧 소진 예측 불가** — *"여러 프롬프트를 여러 엔진에 동시 켰다가 첫 주에 한 달 할당량을 다 태움"*

---

## 7. Scrunch AI (scrunch.com)

**3대 축 (VERIFIED)** — [scrunch.com](https://scrunch.com/)
**"Monitoring"**(LLM 브랜드 노출) · **"Insights"**(AI 해석 이해) · **"Agent Experience Platform(AXP)"**(크롤러에 AI 최적화 콘텐츠 제공)

**KPI**: 단일 히어로 없음. 첫 로그인시 **"Competitive Presence"** 헤드라인 + 언급빈도·SoV·감성.
한 출처는 **"AI search activity"(토픽 총 프롬프트량) vs "brand presence"(내 SoV)** 를 나란히 배치한다고 서술

**차트**: *"Prompt analytics with trends, citations, competitors, and rankings"*.
🎯 차별점 = **"AI traffic"** — **AI 봇/크롤러 방문 실시간 피드** + 트래픽 추세 (서버로그 분석에 가까움. 다른 3툴은 답변 텍스트만)

**0점 상태 (VERIFIED)**: *"share of voice comparisons that show your mention frequency versus competitors across tracked prompts, **identifying when competitors dominate specific prompt categories where you're invisible**"*
+ AXP를 처방으로, **"error detection"**(*"spot when AI bots can't crawl your site"*)을 근본원인 진단으로

**온보딩**: 상세 미문서화. 7일 무료체험 / 데모 예약.
🔴 콜드스타트 불만: *"첫 로그인시 대시보드가 **'Competitive Presence' 같은 지표를 맥락 없이** 제시하고, 초기 데이터 표현이 즉각적 인사이트를 얻기에 **명확성이 부족**"*

**내보내기**: **Data API** 언급. PDF/예약메일 미확인

**가격 (VERIFIED — Capterra 직접)** — [Capterra](https://www.capterra.com/p/10030499/Scrunch-AI/)
**Core $250/month 정액**(5석 포함) · 추가 유저 $25/user/mo (또는 5석 $75/mo) · Enterprise 커스텀
⚠️ Capterra 리뷰 **0건** ("Based on 0 user reviews")

**리뷰 (스니펫)**: G2 — *"monitoring capabilities for being **clean and readable**"*.
강한 추천: *"AI 검색 가시성 툴 **10개를 테스트했는데 Scrunch가 압도적으로 최고**... super easy to use and very intuitive"*
🔴 불만 군집: 가격 · 설정 노력 · 리포팅 유연성 · **콘텐츠 업데이트 실행은 별도 워크플로 필요**

---

## 8. Daydream (withdaydream.com) — 🔴 셀프서브 아님

**구조적 발견 (VERIFIED)** — [tryanalyze 리뷰](https://www.tryanalyze.ai/blog/daydream-ai-review) ※경쟁사 작성이라 프레이밍은 적대적, 단 리테이너 모델 주장은 사실 서술
> *"You **do not log in and run reports**. You hire Daydream the way you would hire a **fractional SEO team**, and they operate inside your growth org."*

무료체험 없음, 공개 가격표 없음. **최소 리테이너 $15,000/month** · 복잡 프로그램 $25K~60K/mo · 일회성 진단 $10K~25K · 프로젝트 $30K~250K

**클라이언트 리포트 탭 (VERIFIED)** — `yourcompany.daydream.report` 패턴
```
Overview     — "your visibility, and how strongly AI recommends you"
Prompts      — "every buyer question, and how visible you are in each"
Competitors  — "the brands AI names in your category, ranked"
Citations    — "the domains and pages the engines cite"
```
**KPI**: 명명된 점수 없이 정성적 — *"how strongly AI recommends you"*. 케이스스터디 수치("170 keywords", "9x organic clicks")는 마케팅 증거

🎯 **Scrunch AI와 데이터 파트너십** — *"through a partnership with Scrunch AI, all Daydream clients benefit from AI search monitoring"* ([journal](https://journal.withdaydream.com/p/llm-optimization-for-all-daydream-clients))
→ **벤치마크 4툴 중 2개가 기술적으로 연결됨**

**온보딩**: 업무 이메일 + 웹사이트 URL 폼 → *"System queuing dashboard creation **by the team**"* — 휴먼 인더 루프
**리뷰**: G2 *"not enough reviews... to provide buying insight"*. Capterra 없음

---

## 9. Trakkr (trakkr.ai) — 🎯 질문형 라벨

**4대 신호 (VERIFIED)** — [대시보드 가이드](https://trakkr.ai/guides/ai-search-monitoring-dashboard)
```
Citations   → "where do I appear?"      (어디에 등장하나?)
Rankings    → "what's my position?"     (내 위치는?)
Perception  → "what does AI say about me?" (AI가 나를 어떻게 말하나?)
Crawler health → "can AI find my content?" (AI가 내 콘텐츠를 찾을 수 있나?)
```
→ **지표명 대신 질문을 쓴다. 비개발자에게 직관적. Findable에 차용 확정.**
지표: net citation change · position distribution(% #1 / top-3 / mentioned / **absent**) · brand-descriptor frequency · crawler visits/week

**차트 (VERIFIED)**: **"cross-model comparison view"** = 모든 AI 모델의 브랜드 포지션을 **격자로 나란히**, **초록=강함 / 빨강=약함** — **히트맵 매트릭스**(선차트 아님). Trakkr의 시그니처 비주얼

**가격 (VERIFIED)** — [pricing](https://trakkr.ai/pricing)
Free $0 · **Growth $79/mo**(브랜드 오너, 3석) · **Scale $399/mo**(에이전시, 10브랜드, 무제한석, 클라이언트 접근+API)
14일 무료체험(Growth 전체) → 미결제시 추적 중단. 전 티어 5엔진(ChatGPT·Perplexity·Gemini·AI Mode·AI Overviews), **Claude/Grok/Meta/DeepSeek는 상위**. 하위 티어 브랜드당 50프롬프트

**"Actions"**: 가시성 데이터에서 프롬프트별 최적화 과제 자동 생성(INFERRED, UI 미확인)
⚠️ Product Hunt·G2·Reddit UX 논의 **못 찾음**

---

## 10. Gauge (withgauge.com) — YC 투자

**네비 (VERIFIED)** — [withgauge.com](https://www.withgauge.com/)
Features 서브메뉴: **Agents · Prompt tracking · Action Center · Content engine · ChatGPT Ads · Ask Gauge · Sentiment Analysis · Agency Mode**

**KPI (VERIFIED)**: **Mention Rate** (% 추적 답변 중 언급) · **Citation Rate** (% 웹사이트 인용) · **Referral Traffic** (AI 소스→특정 URL 직접 트래픽량) · **Visibility %** (카테고리 내 경쟁 점유율 — 실측: *"Vellum at 40.3%," "LedgerUp at 33%"*)

🎯 **"Action Center" (VERIFIED)**: 콘텐츠 문제 식별 → **임팩트/난이도 순 우선순위 추천** → *"어떤 답변 패턴이 가장 적격한 잠재고객을 만드는지"* 기반 타깃 질문 제시
**"Content Engine"**: *"AI 플랫폼이 실제로 인용하는 것에 근거한"* 데이터 기반 기사 자동생성 · 최고 임팩트 갭에서 콘텐츠 캘린더 · 브리프/아웃라인/전문
**"Ask Gauge"**: 가시성 데이터 분석 + 콘텐츠 전략 추천하는 에이전틱 어시스턴트 = **온보딩/가이드 레이어**

**가격 (VERIFIED)**: Starter **$99/mo**(ChatGPT만, 일 100프롬프트) → Growth **$599/mo** ⭐(6엔진, 일 600프롬프트, 월 18 AI기사, 10석) → Enterprise 커스텀(**Claude·Grok 여기서만**)
⚠️ 마케팅 문구에 *"Claude Code"*가 추적 채널로 등장 — 카피 아티팩트 의심, 독립 확인 필요

---

## 11. Goodie AI (higoodie.com)

**(VERIFIED)** — [ai-visibility-monitoring](https://higoodie.com/features/ai-visibility-monitoring)
11개 AI 엔진. 통합 대시보드(ChatGPT·Gemini·Claude·Perplexity 등) + 브랜드 언급 알림 + 감성 분석.
**지역·언어·페르소나·토픽 카테고리별 세그먼트**
KPI: AI visibility score · AI mention tracking · AI traffic attribution · AI crawler analytics

**0점 상태 (INFERRED)**: *"경쟁사는 인용되는데 **당신이 안 보이는 토픽**"* · *"경쟁사를 인용하고 당신은 빼는 프롬프트"* 추적 — 갭 탐색 기능으로 프레이밍

**가격**: Explorer(셀프서브) **$399/month**부터, 무료체험 + 30일 환불보장. Pro·Enterprise는 데모

**리뷰 (VERIFIED)** — [Surferstack](https://surferstack.com/goodie-ai)
✅ *"clean, modern interface"* · *"straightforward and **not cluttered**"* · *"easy to navigate"*
🔴 일관된 비판: **모니터링 전용** — AI 크롤러 로그 없음 · 콘텐츠 갭 분석 없음 · 프롬프트 인텔리전스 없음 · 최적화 도구 없음 → *"**shows you data but leaves you stuck without actionable insights**"*

---

## 12. Evertune (evertune.ai)

**탭 (VERIFIED)** — [ai-brand-index](https://www.evertune.ai/products/ai-brand-index)
**Explore · Measure · Act · Advertise · Methodology**

**KPI (VERIFIED)**: **"AI Brand Score"** = 통합 **0~100** 가시성 지표 · **"Visibility Score"** = 브랜드 언급 답변 % · **"Average Position"**

**리포트 4종 (VERIFIED)** — [7 features](https://www.evertune.ai/resources/insights-on-ai/7-features-that-make-evertune-the-fastest-way-to-start-tracking-ai-brand-visibility)
**Word Association**(AI가 브랜드에 연결하는 용어) · **AI Brand Index**(비보조 인지 유발 확률) · **Consumer Preferences**(속성별 추천) · **Content Analytics**(AI 인용에 영향 주는 도메인)
+ 감성/프레이밍 분석 · 경쟁 벤치마킹 · 쇼핑 인텔리전스

엔진: ChatGPT·Gemini·Claude·Meta·AI Overviews·Perplexity·Copilot
⚠️ 스크린샷·차트 타입 **미확인**(마케팅 페이지가 리포트 *내용*만 개념 서술). 가격 비공개(데모 게이트)
⚠️ **이름 충돌 주의**: 기타 브릿지 하드웨어 브랜드 "Evertune"이 검색을 오염시킴

---

## 13. Rankscale (rankscale.ai)

**(VERIFIED)** — [brand-visibility-dashboard](https://rankscale.ai/features/brand-visibility-dashboard)
데이터 표 컬럼: **Search Term & Topic | AI Engine | Region(국기 이모지) | Visibility | Schedule | Updated | Status**
Visibility 형식: **"95.0% Found (24h)"** (실측: 95.0·88.0·82.0·78.0·71.0·75.0·69.0)
빈도 표기: *"Daily · 24 runs"* / *"Weekly · 16 runs"* · 상대 타임스탬프 *"1 hour ago"*
통합 "Visibility Score" + 감성·언급·인용·포지션·탐지율·top-3 가시성(엔진/토픽/날짜 필터)
차트: **"Brand Performance Over Time"** — 동일 프롬프트 조건에서 경쟁사 대비 추세
엔진: **17+** (ChatGPT·Perplexity·Google AI Mode·Claude·Gemini·DeepSeek·Grok·Copilot·Mistral)

**온보딩**: 웹사이트 분석 → 브랜드 프로필 생성 → 설정 → 검색어 생성 → 인용/감성 도구. 2026-04에 "Getting Started" 가이드 추가(INFERRED)
**내보내기**: 대시보드 스크린샷 또는 PDF(브랜드 전체 또는 단일 프롬프트)

**가격 (INFERRED)** — [OMR](https://omr.com/en/reviews/product/rankscale-ai/pricing) 등
**크레딧 기반** 4티어: Essentials $20/mo(사실상 사용가능 크레딧 0=플레이스홀더) · **Pro $99/mo**(25 브랜드 대시보드) · Growth · Enterprise. 연납 15% off, 미사용 크레딧 이월(상한). 전 티어 17+엔진, 7일 체험

**리뷰 (INFERRED)**: *"clean," "intuitive," "복잡한 데이터인데도 이해하기 쉬움"*
🔴 비판: 학습곡선/"technical feel" · **키워드×LLM 조합 대량편집이 어수선하고 오류 유발** · **크레딧 가격 모델이 "혼란스럽다"**(행동별 크레딧 비용이 달라서)

---

## 14. BrandLight (brandlight.ai) — 자료 빈약

**(INFERRED — 출처가 전부 자사 콘텐츠 네트워크)** — [sat.brandlight.ai](https://sat.brandlight.ai/articles/geo-ai-visibility-platform-shows-ai-reach-and-kpis)
AI Overviews + ChatGPT 프롬프트 정렬 + 지식그래프 일관성을 한 대시보드에 집계. 5엔진.
CSV·JSON export, 팀 공유. 일간 알림 갱신 + 주간 전략 업데이트. 33개 언어·140개국.
Enterprise: 멀티도메인 · SOC 2 Type II · GDPR · SSO · CMS/BI 연동
가격(INFERRED): Entry ~$199/mo, Activation ~$750/mo
⚠️ **출처 충돌**: 한쪽은 *"무료체험·프리미엄·샌드박스 없이 완전 세일즈 게이트"*, 다른 쪽은 *"2025년에 무료 버전 존재"* → **셀프서브 가용성 불확실**
⚠️ 독립 스크린샷·G2/Capterra·Product Hunt **전무**

---

## 15. Bluefish AI (bluefishai.com) — 완전 불투명

**(VERIFIED)** — [solutions](https://www.bluefishai.com/solutions)
엔터프라이즈 전용 "agentic marketing platform", Fortune 500 타깃(확인 고객: **Adidas, Tishman Speyer**)
5개 제품 축(2026-05 기준): AI Monitoring · GEO Optimization · GEO Measurement · AI Commerce · AI Accuracy
기능 카테고리: AI Visibility · AI Content Optimization · AI Brand Safety · AI Commerce
4개 바이어 역할 타깃: 검색팀 · 콘텐츠팀 · 브랜드팀 · PR팀

🔴 **공개 UI 정보 전무**: nav 라벨 · KPI · 차트 · AI 답변 표시 · 가격 **전부 비공개**. Product Hunt 없음. 스크린샷·UX 리뷰 검색 결과 0
→ **일반적 GEO 툴 패턴이 적용된다고 가정하지 말 것**

---

## 조사 공백 (정직 표기)

- **G2 직접 fetch = 전부 403 차단** → 모든 G2 인용은 검색 스니펫 기반(1차 fetch 아님). Profound "고급차" 인용은 2회 독립 검색이 동일 문구로 수렴해 신뢰도 있으나 날짜·작성자 정확 확인 불가
- **Reddit 스레드 = 15개 툴 전체에서 발견 실패**(여러 쿼리 변형 시도). 부재 확인 아님 — 니치 B2B라 논의량 자체가 적을 가능성
- Product Hunt 리스팅은 있으나 **코멘트 본문 회수 불가**
- Trakkr "Actions" 탭 스크린샷·레이아웃 미발견
- Evertune 대시보드 스크린샷·차트 타입 미발견
- Otterly Capterra 리스팅 못 찾음 / Scrunch Capterra 리뷰 0건 / Knowatoa Capterra 리스팅 없음
- **Knowatoa**: [AI Search Console](https://knowatoa.com/features/ai-search-console) — "15+ AI Bot Types"(GPTBot·Claude-Web·PerplexityBot·GoogleOther) 크롤 접근 실시간 테스트·robots.txt 분석·알림·예약리포트. 가격 Free $0(10질문·ChatGPT만) → Premium $99(30질문) → Pro $249(300질문) → Agency $749(1,500질문) + 일회성 $299 온보딩 웨비나. 대시보드 상세는 저신뢰 INFERRED
