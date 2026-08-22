# 토스 · Apple · Linear · Stripe · Polaris — UX 문법 원본

> ⚠️ **재리서치 금지.** 2026-08-06 세션N-4.
> 🎯 **이 파일은 Findable 전용이 아니다** — 놀맵·혜빈 SNS·이터널 등 **모든 한국어 UI 작업에 재사용**.
> 핵심 결론: **토스는 "쉬운 말"을 감(vibe)이 아니라 강제되는 문법 규칙으로 코드화했다.**

---

## 1. 🔴 토스 — 앱인토스 소비자 UX 가이드 (**심사 탈락 기준 = 강제 규칙**)

📕 [Apps in Toss Consumer UX Guide](https://developers-apps-in-toss.toss.im/design/consumer-ux-guide.md) (**토스 공식 개발자센터**)
> **이게 가장 실무 적용성이 높다** — 미니앱 심사에서 실제로 탈락시키는 기준이다.

### 1-1. 말투·문법
| 규칙 | 내용 |
|---|---|
| **말투** | **"해요체"(informal polite) exclusively** — 전체 텍스트에서 해요체로 통일 강제 |
| **능동태 우선** | 수동태는 **서비스 종료·영향 고지·사용자 안심시키는 경우만** 예외 허용 |
| **긍정 프레이밍** | *"기대할 수 있어요"*(가능) 식으로 쓰고, *"안 돼요"*(불가) 표현은 **법적으로 강제되는 경우만** 예외 |
| **격식 제거** | *"~시"*, *"계시다"* 같은 존칭 접사 제거 → *"있다"*로 · *"께"* 대신 ***"에게"*** 사용 |
| **한자어 동사화** | **명사 나열 지양**, 한자어 명사를 가능하면 **동사형으로 전환** |

### 1-2. 🔴 다크패턴 5종 금지 (심사 탈락 사유)
1. 진입 즉시 **전체화면 바텀시트**
2. 뒤로가기 시 **이탈 차단 시트**
3. **거부 경로 없는 CTA만 제공**
4. **예기치 않은 광고 삽입**
5. **모호한 CTA 문구**

### 1-3. 그래픽 규율
- 아이콘 **24~40px**
- **화면당 큰 그래픽 1개만**
- 🔴 **부정적/애원조 감정 표현 그래픽 금지** ← 0점 고객이 많은 제품에 결정적
- **장식 효과·파티클 애니메이션 금지**
- **에러 아이콘은 실제 에러에만** 사용(상태 표시 남용 금지)

---

## 2. 토스 8가지 라이팅 원칙 (공식)

📕 [토스의 8가지 라이팅 원칙들](https://toss.tech/article/8-writing-principles-of-toss) (**공식 기술 블로그**)

5개 코어밸류(**Clear** 명확한 · **Concise** 간결한 · **Casual** 친근한 · **Respect** 존중하는 · **Emotional** 공감하는) 아래 8개 원칙. 각 원칙은 **화면 검토용 질문 형태**:

| # | 원칙 | 원문 |
|---|---|---|
| 1 | **Predictable hint** | *"다음 화면을 예상할 수 있는 문장을 씁니다."* |
| 2 | **Weed cutting** (잡초 뽑기) | *"토스에서는 **넣든 빼든 의사 전달에 영향이 없는 단어**를 잡초라고 불러요."* (예: '혹시'가 잡초로 판정된 사례) |
| 3 | **Remove empty sentences** | *"화면 안의 잡초, 즉 **의미 없는 문장**을 뽑는 거예요."* |
| 4 | **Focus on key message** | *"사용자가 **이미 알고 있는 정보는 과감하게 생략**하고, 지금 꼭 확인해야 하는 내용만 추려서 전달하는 게 중요해요."* |
| 5 | 🔴 **Easy to speak** | *"**일상에서 구두로 쓰이지 않는 단어**나 **금융, IT 업계에서만 쓰이는 전문 용어**를 최대한 줄여야 해요."* |
| 6 | **Suggest over force** | *"권유와 강요는 다릅니다. **스스로에게 선택권이 있다는 점**을 느낄 수 있게, 사용자를 존중하는 문장을 써야 해요."* |
| 7 | **Universal words** | *"연령, 교육 수준 및 종사 업계에 따라 이해도가 다른 용어를 지양하고, **정보 진입 장벽을 높이는 단어**는 쉽게 바꿔야 해요."* |
| 8 | 🎯 **Find hidden emotion** | *"필요한 정보를 정확하게 전달하는 것도 중요하지만, **그 정보를 전달받는 순간 사용자의 마음이 어떨지** 생각해보면 전혀 다른 커뮤니케이션을 할 수도 있어요."* |

**8번 실제 사례**: 대출 완납 알림을 **단순 잔액 변경이 아니라 "갚느라 고생 많으셨다"는 감정적 인정**으로 전환

🎯 **핵심 구조**: 프린시플(추상)과 가이드라인(구체)을 **구분**한다.
- "간결하게 쓴다" = **프린시플**
- "'혹시'는 의미 없는 단어다" = **가이드라인**
→ **A/B 테스트로 검증된 승리 전략을 규칙으로 굳힌 것**이라고 명시

---

## 3. 🔴 토스 에러 메시지 시스템 — "Navigating error"

📕 [가이드라인을 시스템으로 만드는 법](https://toss.tech/article/introducing-toss-error-message-system) (**공식**)

> 🎯 **핵심 철학 = "Navigating error"** — 에러 메시지의 역할은 **무엇이 잘못됐는지 보고하는 게 아니라 다음 화면으로 안내하는 것**

**Findable의 "0점" 화면이 정확히 이 문제다.** 지금은 *"AI가 당신을 모릅니다"*라고 **보고**만 한다.

**시스템화 2축**:
1. **개발자용 에러 메시지 라이브러리** — 코드에서 바로 호출
2. **디자이너용 "Framer-ing"** — Framer 안에서 메시지 템플릿 검색·삽입

---

## 4. 토스 UX 라이터 인터뷰 (공식)

📕 [토스가 금융을 더 쉽게 만드는 또 하나의 방법, UX Writing](https://toss.im/tossfeed/article/uxwriter-interview)

UX 라이터 김자유:
> *"**금융은 용어부터 너무 어려워서 손해보는 경우가 많잖아요**"* — **Zero Jargon**이 미션

**Weed Cutting 실전 예**: *"확인할 수 있어요"* → **"확인하세요"** (불필요한 완곡 표현 제거)

🎯 **데이터 기반이되 윤리가 우선**:
> *"**클릭베이트가 통계적으로 더 잘 먹히지만** 토스 가치와 배치되면 안 쓴다"*

---

## 5. TDS (Toss Design System) 타이포그래피 — 공식 수치

📕 [TDS React Native Typography](https://tossmini-docs.toss.im/tds-react-native/foundation/typography/) (**공식**)

| 토큰 | 크기(px) | 줄높이 | 비율 | 용도 |
|---|---|---|---|---|
| Typography 1 | 30 | 40 | 1.33 | 매우 큰 헤딩 |
| Typography 2 | 26 | 35 | 1.35 | 큰 헤딩 |
| Typography 3 | 22 | 31 | 1.41 | 일반 헤딩 |
| Typography 4 | 20 | 29 | 1.45 | 작은 헤딩 |
| **Typography 5** | **17** | **25.5** | **1.50** | **본문** |
| Typography 6 | 15 | 22.5 | 1.50 | 작은 본문 |
| Typography 7 | 13 | 19.5 | 1.50 | 캡션 |

- Weight = **Light / Regular / Medium / Semibold / Bold 5단계**
- 접근성: iOS는 **100~310% 범위로 스케일**
- 🎯 **디자이너는 값을 하드코딩하지 않고 토큰만 사용** — 이게 일관성의 실질적 메커니즘

---

## 6. TDS 컴포넌트 철학 (공식)

📕 [토스 디자이너가 제품에만 집중할 수 있는 방법](https://toss.tech/article/toss-design-system)

- *"**레고 블록과 같은** 활용 가능한 TDS 컴포넌트들을 만들고"*
- **사용 데이터 분석으로 패턴 발견** — 예: 메뉴 아이템의 **50%가 체크 아이콘 사용** → 컴포넌트 진화
- 개선 후 디자이너 생산속도 **3~5배**(같은 시간에 30화면 → 90화면)
- 🎯 **시스템의 목적**:
  > *"**월요일은 제품을 만들고, 남은 화수목금은 사용자를 만날 수 있어요**"*
  = 반복 결정을 없애 **사용자 리서치 시간을 버는 것**

---

## 7. 토스 Simplicity 컨퍼런스 (공식)

📕 [toss.im/simplicity](https://toss.im/simplicity) · [Simplicity 4 제작기](https://toss.tech/article/simplicity_behind)

2021년부터 매년. 철학 = ***"누구나 직관적으로 이해할 수 있는 디자인"*(Simplicity)**
2026년 시즌4 주제 = **"Vision-Driven Design"**
🎯 **디자이너·리서처·라이터·엔지니어가 함께 발표** — UX가 한 직군 소관이 아니라 **전사 책임**이라는 조직 구조

---

## 8. 토스 제품 원칙 (3자 정리, 원문 인용 섞임)

📕 [토스의 제품 원칙, 제품 전략 그리고 UX 원칙](https://maily.so/eddy/posts/knrjvlp1rld)
⚠️ **3자 요약** — 토스 공식 발표를 정리한 것으로 원문 인용이 섞여 있음

| 원칙 | 내용 |
|---|---|
| 🎯 **One Thing per One Page** | 화면 하나는 **메시지 하나만** |
| **Tap & Scroll** | 핵심 플로우는 **탭과 스크롤만으로** |
| **Easy to Answer** | **3초 안에 답할 수 있는 질문만** 던진다 |
| **Value First, Cost Later** | 정보를 요구하기 **전에 혜택부터** 제시 |
| **No Ads Patterns** | 프로모션 스타일이 아니라 **기능으로 보이게** |
| **Minimum Features** | *"이 기능 없이는 '절대' 목표를 달성할 수 없는지 다시 한 번 생각한다"* |
| **Less Policy** | *"단순한 정책"* — 사용자가 **배워야 할 것을 최소화** |

### 10가지 UX 법칙으로 본 토스 (3자 분석, 참고용)
📕 [모비인사이드](https://www.mobiinside.co.kr/2023/03/29/toss-ux-2/) ⚠️ 법칙 자체는 일반 UX 이론, 토스 고유 아님
- **Doherty Threshold**(0.4초 내 피드백): 필요한 대기시간에는 **로딩 애니메이션을 넣어 체감 대기시간 관리**
- **Tesler's Law**: 계좌번호 입력시 **은행을 자동 추천**해 사용자 선택 부담을 시스템이 흡수

---

## 9. 🔴 토스 관련 확인 실패 / 부재

| 항목 | 상태 |
|---|---|
| **TDS 공개 레포·설치 가능 패키지** | ❌ **없음.** TDS는 "앱인토스" 미니앱 플랫폼 문서로만 참조 |
| **OpenToss** ([github.com/OpenToss](https://github.com/OpenToss)) | ⚠️ **3자·비공식** TDS SwiftUI 클론. **미완성·프로덕션 부적합.** 의존성으로 사용 불가 |
| **토스 브랜드 폰트** | ❌ "Toss Product Sans" 같은 오픈소스 폰트 **없음**. 제품 타이포는 Pretendard 또는 라이선스 폰트 추정(1차 확인 실패) |
| **토스 숫자·금액 표기 규칙** | ❌ 공식 문서 **못 찾음. 존재 여부 자체가 불확실** |
| **토스가 발행하는 유용한 OSS** | ✅ [es-hangul](https://github.com/toss/es-hangul)(~1.9k★, 활발) — 한글 **문자열** 처리(음절 분해/조립, **조사 을/를·이/가 받침 판별**, 초성 검색). CSS/타이포 도구 아님. [es-toolkit](https://github.com/toss)(11.3k★, lodash 대체) · suspensive · frontend-fundamentals |

---

## 10. Apple Human Interface Guidelines

📕 [developer.apple.com/design/human-interface-guidelines](https://developer.apple.com/design/human-interface-guidelines)
(원칙 인용은 iOS 7 UI Transition Guide 경유 확인)

### 3대 원칙
| 원칙 | 원문 |
|---|---|
| **Clarity** (명료성) | *"Text is legible at every size, icons are precise and lucid, **adornments are subtle and appropriate**, and a sharpened focus on functionality motivates the design."* |
| 🎯 **Deference** (겸양) | *"The UI helps users understand and interact with the content, but **never competes with it**."* → 대시보드 적용: **카드 테두리·그림자·장식보다 데이터 자체가 주인공** |
| **Depth** (깊이) | *"Visual layers and realistic motion heighten users' delight and understanding."* |

### 타이포그래피 위계
- San Francisco 패밀리 · **SF Pro Text(19pt 이하) / SF Pro Display(20pt 이상)** 구분 · Dynamic Type으로 사용자 제어 스케일링
- 핵심 원칙: *"maintaining the relative hierarchy and visual distinction of text elements by adjusting **font weight, size, and color**"*
- 🎯 **실무 해석**: 위계는 **굵기·크기를 먼저** 쓰고 **색은 최후 수단** — 이게 애플 스타일의 핵심

### ⚠️ 확인 실패
Apple 공식 **Depth / Color / Charting Data** 페이지는 본문 fetch 실패(제목만 확인).
1차 자료는 WWDC22 영상 — [Design an effective chart](https://developer.apple.com/videos/play/wwdc2022/110340/) · [Design app experiences with charts](https://developer.apple.com/videos/play/wwdc2022/110342/) — **영상이라 본문 인용 불가.** 수치가 중요하면 재방문 필요

---

## 11. Linear (공식 + 창업자 1차 발언)

📕 [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui) (**공식**)
📕 [Karri Saarinen X 스레드](https://x.com/karrisaarinen/status/1715085201653805116) (**공동창업자 1차**)
📕 [Figma Blog 인터뷰](https://www.figma.com/blog/the-linear-method-opinionated-software/) (3자 매체, 인용 다수)

- **타이포**: 헤딩에 **Inter Display** 도입(*"add more expression... while maintaining readability"*), 본문은 Inter 유지 — 헤딩과 본문을 **다른 굵기가 아니라 다른 서체 변형**으로 위계 분리
- **색상**: HSL → **LCH 컬러 스페이스** 전환 — *"perpetually uniform"* 지각 균일성. **테마당 변수 단 3개**(Base/Accent/Contrast)로 극단 축소
- 🎯 **디자인 철학**(창업자 1차): *"디자인은 참고자료일 뿐, 결과물이 아니다. **우리는 앱을 스크린샷하고 그 위에 디자인한다**"* — 디자인 파일이 아니라 **실제 코드가 진실**
- 🎯 **의견 있는 소프트웨어**: *"flexible하거나 무한히 customizable한 도구로는 **최적의 도구를 만들 수 없다**"* — 처음부터 워크플로우에 강한 관점을 갖고 표준·기본값 제공. **"한 가지 좋은 방법만 있도록"**

---

## 12. 🎯 Stripe — 색 예산과 신뢰 메커니즘

📕 [Stripe Dashboard Design Breakdown: Trust Through Clarity](https://www.925studios.co/blog/stripe-dashboard-design-breakdown)
⚠️ **3자 분석**(디자인 스튜디오)이나 구체 수치·인용 다수. Stripe 공식 디자인시스템은 비공개(Stripe Apps 컴포넌트만 공개)

### 🔴 색상 예산 — 가장 중요한 인용
> *"Stripe reserves color **exclusively for status signaling** rather than decoration."*
> *"**When every data point is coloured, colour loses meaning.** Stripe keeps the palette narrow so that a red indicator always means attention required, not just 'this is the red category.'"*

팔레트 = green(성공) / red(실패) / yellow(대기) **뿐**

### 타이포 위계
**6단계 크기·굵기로 색 없이 우선순위** 표현 — 주요 지표는 **최대 크기+최고 굵기**, 보조 수치는 중간 굵기+작은 크기, 라벨은 **가장 얇고 가장 작게**

### 정보 밀도
> *"**Show what the user needs to act, not everything that exists**"*

홈 화면은 **5개 핵심 지표만**(총거래액·순거래액·신규고객·성공결제·기간비교). 스파크라인은 **격자선·커스터마이징 없이 추세만**

### 🎯 신뢰 메커니즘 (Findable에 직접 필요)
| 장치 | 내용 |
|---|---|
| **에러 3요소** | 항상 **무엇이 일어났는지 · 왜 · 다음에 뭘 해야 하는지** |
| **기간 비교 필수** | 모든 지표를 **항상 이전 기간과 비교**해서 표시 — **맥락 없는 절대값 금지** |
| **마감 명시** | 분쟁 건은 *"**Respond by [구체적 날짜]**"* |

### 네비게이션 라벨
🎯 **시스템 구조가 아니라 사용자 의도** 기준: *"Chargeback Events"* ❌ → **"Disputes"** ○

---

## 13. Vercel / Geist

📕 [Geist 공식 소개](https://vercel.com/geist/introduction) · [Vercel Design System Breakdown](https://oh-my-design.kr/design-systems/vercel) (3자)

- 공식: *"high contrast, accessible color system"* · Geist Sans/Mono · **Materials**(radii/fills/strokes/shadows 프리셋) · Grid. **철학적 서술은 짧음**
- 3자 분석: **순수 블랙(#000000)/화이트(#FFFFFF) 중심**, 컬러는 **상태 표시(에러·경고·링크)에만** 예외적 사용.
  Geist Sans는 기하학적이나 본문 크기에서도 따뜻하게 읽히도록 **살짝 좁은 자간**.
  큰 헤드라인(48~64px)은 **-0.04em 자간 + 1.15 줄높이**로 응축된 임팩트
  ⚠️ **한글엔 이 자간 적용 금지**

---

## 14. 🎯 Shopify Polaris — 빈 상태 (공식)

📕 [Polaris Empty State](https://polaris-react.shopify.com/components/layout-and-structure/empty-state) (**공식**)

- **목적**: 리스트·테이블·차트에 보여줄 항목이 없을 때. **페이지 전체가 빌 때만** 쓰고 개별 요소엔 안 씀
- 🎯 **제목은 행동 지향형**: ✅ *"Create orders and send invoices"* / ❌ *"Orders and invoices"*
- 🎯 **어조는 격려형**: *"merchants가 **기능을 안 써봤다고 실패자처럼 느끼게 하지 말 것**"*
- 🎯 **버튼 동사는 강하게**: ✅ *"Activate Apple Pay"*, *"Create order"* / ❌ *"Try"*, *"New"* 같은 약한 동사
- **스캔 가능하게**: *"Add menu item"*이 맞고 *"Add a menu item"*은 틀림(**관사 생략**)
- 일러스트는 장식용이라 **스크린리더는 건너뜀**(alt 빈 값)

---

## 15. Airbnb DLS

📕 [Airbnb Design Language System 분석](https://www.designsystems.one/design-systems/airbnb-design) (3자 정리, 공식 DLS는 비공개 내부 시스템)

4대 원칙: **Unified**(*"각 조각은 전체의 일부이며 시스템 전체에 긍정적으로 기여해야 한다"*) · **Universal**(*"우리 제품과 비주얼 언어는 환영하고 접근 가능해야 한다"*) · **Iconic** · **Conversational**
레이아웃 = **8px 기준 그리드**(4px/8px 배수)
데이터 표시 철학: *"photography is the hero, copy is restrained, and the system stays out of the way"*
→ ⚠️ 사진 중심 서비스 특유 원칙이라 **데이터 대시보드 적용성은 낮음**

---

## 16. 한국 B2B — 뱅크샐러드

📕 [Banksalad Product Language를 소개합니다](https://blog.banksalad.com/tech/banksalad-product-language-ios/) (**공식 기술 블로그**)

핵심 문제의식:
> *"**Communication cost is most expensive.** Code and Show first, argue after that."*

디자이너·개발자(iOS/Android/Web)·기획자가 **같은 UI 요소를 다르게 부르고 다른 추상화 레벨로 이해하는 문제**를 해결하려 만든 시스템

⚠️ **"말그릇 가이드"**(UX 라이팅 원칙)는 존재가 확인되나 **구체 규칙 원문 미확보**
⚠️ **채널톡** — 공개 디자인 시스템 문서 **못 찾음**

---

## 🎯 종합: 한국어 B2B 데이터 대시보드에 즉시 적용할 규칙

| 영역 | 적용 규칙 | 출처 |
|---|---|---|
| **어조** | **해요체 통일**, 능동태 우선, 긍정 프레이밍(*"~할 수 있어요"*) | 토스 소비자 UX 가이드 |
| **문구 다이어트** | **화면당 메시지 1개**, '잡초 단어' 제거, 이미 아는 정보 생략 | 토스 8원칙 |
| **전문용어 번역** | 한자어 명사→동사화, 업계 전문용어 제거, **구두로 말해도 자연스러운 문장** | 토스 8원칙(Easy to speak) |
| **타이포 위계** | **색이 아니라 굵기+크기**로 위계, **토큰화**(하드코딩 금지) | Apple HIG · TDS · Stripe |
| **색상 예산** | 색은 **상태(성공/실패/대기)에만**, 나머지는 뉴트럴 | Stripe · Vercel Geist |
| **신뢰 구축** | 지표는 **항상 이전 기간과 비교**, 에러는 **무엇/왜/다음행동 3요소** | Stripe |
| **빈 상태** | **행동지향 제목**, 실패감 주지 않는 격려형 어조, **강한 동사 CTA** | Shopify Polaris |
| **에러·0점** | **"Navigating"** — 보고가 아니라 **다음 화면 안내** | 토스 에러 시스템 |
| **다크패턴 금지** | 전체화면 강제 시트, **탈출로 없는 CTA**, 모호한 버튼 문구 금지 | 토스 소비자 UX 가이드 |
| **감정 인정** | *"그 정보를 받는 순간 사용자의 마음이 어떨지"* 생각 | 토스 8원칙 #8 |
| **시스템 철학** | 디자인은 참고자료, **실제 앱이 진실**. 강한 관점으로 선택지를 줄인다 | Linear |
| **본문 타이포** | **17px / 줄높이 1.5** (한글 실측) | TDS Typography 5 |
