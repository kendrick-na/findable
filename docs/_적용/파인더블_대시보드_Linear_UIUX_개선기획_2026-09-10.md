# 파인더블 대시보드 Linear UI/UX 개선 기획

> 작성일: 2026-09-10  
> 대상: `apps/app` 로그인 후 공통 셸과 대시보드 홈  
> 상태: 구현 전 검토안  
> 핵심 제약: **기능·데이터·라우팅·권한·측정 로직을 변경하지 않는다.**

## 0. 결론

기획서를 먼저 쓰는 것이 맞다. 다만 새 제품 기획서가 아니라 **기능 동결형 UI 리팩터링 명세**면 충분하다.

현재 파인더블은 이미 Linear 계열의 기반을 갖고 있다.

- `#010102` 캔버스, 단계형 다크 표면, hairline border, Geist/Pretendard 조합이 있다.
- 사이드바 접기, 모바일 하단 탭, 브랜드 전환, KPI 드릴스루, 기간 필터, 빈 상태, 로딩 상태가 구현돼 있다.
- `Design System Linear.md`와 Findable 전용 토큰이 이미 저장소에 있다.

따라서 전면 재설계나 기능 재구축은 필요 없다. 목표는 **Linear를 복제하는 것**이 아니라, 현재 기능을 그대로 둔 채 다음 차이를 닫는 것이다.

1. 모든 영역이 카드로 보이는 반복감을 줄인다.
2. 화면마다 흩어진 위계를 하나의 작업공간 문법으로 통일한다.
3. 장식보다 데이터, 상태, 다음 행동이 먼저 읽히게 만든다.
4. Findable의 오렌지 브랜드는 유지하고 Linear의 절제·밀도·정밀함만 가져온다.

## 1. 이번 감사의 근거와 한계

### 확인한 것

- 현재 대시보드 홈과 공통 셸 소스
- 전역 디자인 토큰과 공용 컴포넌트
- 저장된 PC·모바일 Storybook 캡처
- 기존 UI/UX 감사·재설계 문서
- Git 브랜치·커밋·Vercel 배포 가드

### 아직 확인하지 않은 것

- 로그인된 프로덕션 전체 화면의 2026-09-10 실시간 캡처
- 실제 고객 데이터가 긴 경우의 전체 페이지 스크롤 체감
- Vercel 대시보드의 과거 배포 승격·롤백 이벤트 로그

즉, 아래 평가는 **현재 코드와 저장된 렌더 결과 기준**이다. 구현 승인 후 Preview에서 로그인 세션으로 최종 시각 검증해야 한다.

## 2. 현재 상태 요약

| 영역 | 현재 상태 | 판정 |
|---|---|---|
| 컬러·표면 | Linear형 near-black과 4단계 surface가 있음 | 좋음, 유지 |
| 브랜드 | Linear 보라 대신 Findable 오렌지를 단일 액센트로 사용 | 좋음, 유지 |
| 타이포그래피 | Geist/Pretendard, 수치 tabular 사용 | 좋음, 세부 위계 보정 |
| 카드 | 거의 모든 콘텐츠가 둥근 외곽선 카드 | **과다** |
| 정보 위계 | 제목·상태·브랜드·회차 정보가 여러 블록으로 분산 | **개선 필요** |
| CTA | 같은 `findable-btn-primary`라도 실제 캡처에서 주 행동이 회색 버튼처럼 보임 | **우선 수정** |
| 차트 | 데이터는 좋지만 큰 면적 채움과 전체 카드 외곽선이 무거움 | 개선 필요 |
| 사이드바 | 기능은 풍부하나 그룹과 잠금 항목이 많아 시각 밀도가 높음 | 시각 정돈 필요 |
| 모바일 빈 상태 | 설명은 충실하지만 카드 3개와 여백 때문에 첫 행동까지 길다 | 개선 필요 |
| 상태 설계 | 빈/로딩/실패/부분 성공이 이미 구분됨 | 좋음, 유지 |
| 접근성 | reduced-motion, 한국어 줄바꿈, 아이콘 체계가 있음 | 좋음, 추가 점검 |

한 줄 판정: **색은 Linear인데, 레이아웃 문법은 아직 ‘카드형 SaaS 대시보드’에 더 가깝다.**

## 3. 현재 좋은 점 — 반드시 보존

### 3-1. 기능과 정보 구조

- 대시보드 → 브랜드·측정 → 질문 → 이력 → 분석 → 실행의 기존 링크와 라우트
- 조직/브랜드 범위, 플랜 잠금, 관리자 노출 조건
- KPI의 계산식·라벨·이전 측정 비교·드릴스루 목적지
- 측정 중/실패/응답 없음/신규 사용자의 각 상태
- 추세 기간 선택, 주석, 빈 차트 CTA
- 질문별 성과, 진실의 거울, 시스템 상태, 심층 분석
- 모바일 하단 탭과 사이드바 열기 동작
- 온보딩 투어의 anchor ID

### 3-2. 브랜드 자산

- near-black 캔버스와 Findable 오렌지
- Geist + Pretendard 조합
- Lucide 단일 아이콘 계열
- 과장된 글로우보다 hairline 중심인 앱 카드

## 4. 지금 별로인 점

### P0. 주 CTA가 주 행동처럼 보이지 않는다

`findable-btn-primary`는 gradient와 shadow만 정의하고 명시적인 오렌지 배경·전경색을 보장하지 않는다. 저장된 모바일 빈 상태 캡처에서도 “브랜드 등록하고 측정 시작”이 회색 버튼처럼 보여 보조 행동과 차이가 약하다.

영향:

- 사용자가 어디서 시작해야 하는지 즉시 판단하기 어렵다.
- Findable의 단일 오렌지 액센트 원칙이 핵심 전환 지점에서 끊긴다.
- 같은 클래스가 링크와 버튼에 쓰일 때 부모 스타일에 따라 결과가 달라질 수 있다.

### P0. 카드가 너무 많아 모든 정보가 같은 중요도로 보인다

KPI, 회차 문맥, 시스템 상태, 다음 행동, 심층 분석, 추세, 질문 목록, 진실의 거울이 대부분 동일한 둥근 외곽선과 유사한 패딩을 쓴다.

영향:

- 사용자가 “현재 상태 → 중요한 변화 → 다음 행동” 순서를 스캔하기 어렵다.
- 스크롤이 길수록 섹션 간 의미 차이보다 카드 외곽선만 반복된다.
- Linear 특유의 평평하고 연결된 작업공간보다 위젯 모음처럼 느껴진다.

### P1. 상단 문맥이 분산돼 있다

브레드크럼/헤더 지표, 페이지 제목, 브랜드 선택, 최신 측정 회차, 측정 시작 CTA가 서로 다른 줄과 블록에 놓인다.

영향:

- “어느 브랜드의 어느 회차를 보고 있는가”가 한눈에 묶이지 않는다.
- 상단에서 이미 아는 정보를 읽는 데 세로 공간을 많이 쓴다.
- 실제 데이터까지 도달하는 시간이 길어진다.

### P1. 공통 셸과 Findable 앱 표면의 색 체계가 완전히 같은 시스템이 아니다

Findable 전용 토큰은 near-black/오렌지인데 공용 shadcn `dark` 토큰은 중성 회색/보라 chart 계열이다. 사이드바와 기본 Button, 앱 콘텐츠가 서로 다른 토큰 계층을 사용할 수 있다.

영향:

- 같은 화면에서도 사이드바, 기본 컨트롤, Findable 카드의 검정 농도와 hover가 미묘하게 다르다.
- 새 컴포넌트를 추가할 때 어느 토큰을 써야 하는지 불명확하다.

### P1. 사이드바가 기능 목록으로 먼저 읽힌다

그룹은 나뉘어 있지만 항목 수와 잠금 아이콘이 많고, 현재 위치 표시가 오렌지 배경과 텍스트 중심이라 길게 스캔해야 한다.

영향:

- 자주 쓰는 핵심 동선과 보조/계정/관리 동선의 차이가 약하다.
- 접힌 상태와 펼친 상태 사이의 브랜드 경험이 다르다.

기능을 없애거나 숨기는 것이 아니라 **간격, 그룹 라벨, active rail, 아이콘 대비**로 우선순위를 명확히 해야 한다.

### P1. 데이터 화면의 시각적 밀도 조절이 약하다

- KPI 카드 높이에 비해 실제 정보량이 적은 상태가 있다.
- 추세 차트의 면 채움이 강해 선과 변화량보다 배경 덩어리가 먼저 보인다.
- 질문별 목록과 진실의 거울은 행 단위 정보는 좋지만 섹션 전체 폭과 외곽선이 반복된다.

### P2. 모바일 신규 사용자 화면이 지나치게 길다

설명 카드 + 3단계 카드 + CTA가 순서대로 모두 큰 블록이라 390px 폭에서 주 행동까지 여러 번 내려야 한다.

기능과 문구를 없애지 않고도 단계 카드를 compact step list로 바꾸고 CTA를 더 빨리 노출할 수 있다.

### P2. 강제 다크 모드와 모드 토글이 함께 있다

루트는 `forcedTheme="dark"`인데 사이드바 하단에는 `ModeToggle`이 남아 있다. 사용자가 눌러도 의미 있는 테마 변화가 없다면 기능처럼 보이는 비기능 제어다.

구현 전 실제 동작을 확인하고, 강제 다크가 제품 결정이라면 토글을 시각적으로 제거하는 편이 정직하다. 이 항목은 **기능 삭제가 아니라 작동하지 않는 표면 제거**로 별도 승인한다.

## 5. Linear처럼 만들 때 추가되는 것

새 비즈니스 기능은 추가하지 않는다. 다음은 **기존 기능을 더 잘 읽히게 하는 표현 계층**이다.

### 5-1. 통합 작업 헤더

한 줄 또는 두 줄 안에 다음 기존 정보를 묶는다.

- 페이지 이름
- 현재 브랜드
- 최신 측정 시각/회차
- 핵심 상태 지표
- 기존 “측정 시작” 행동

브랜드 전환과 측정 시작의 동작·URL은 그대로 유지한다.

### 5-2. Surface 역할 3종

| 역할 | 용도 | 표현 |
|---|---|---|
| Base | 페이지와 큰 섹션 | 외곽선 없음 |
| Section | 차트·목록·원문처럼 긴 데이터 | 얇은 top/bottom separator 중심 |
| Elevated | KPI, 경고, CTA처럼 강조할 소수 영역 | border + 약한 inner highlight |

현재처럼 모든 블록에 `findable-card`를 붙이지 않는다.

### 5-3. Section heading 규칙

모든 주요 섹션에 같은 구조를 적용한다.

- 12px eyebrow 또는 상태 라벨
- 16~18px 제목
- 한 줄 설명 또는 우측 메타/필터
- 내용과 제목 사이 16px, 섹션 사이 32px

### 5-4. Active rail과 조용한 사이드바

- 현재 메뉴 왼쪽에 2px active rail
- active 배경은 더 약하게, 텍스트와 아이콘 대비로 위치 표시
- 그룹 라벨의 대비와 간격 축소
- 잠금 아이콘은 유지하되 모든 잠금 항목이 먼저 튀지 않게 정돈
- 사이드바 기능·순서·URL은 유지

### 5-5. Dense KPI grid

- KPI 숫자와 변화량을 같은 baseline에 정렬
- 설명 문구는 1~2줄로 제한하되 전체 문장은 접근 가능하게 유지
- sparkline/stack bar의 높이와 위치 통일
- hover는 이동을 암시하는 카드에만 적용

### 5-6. 데이터 우선 차트

- 강한 면 채움 대신 낮은 opacity 또는 선 중심
- grid line을 더 약하게
- 현재값과 변화량은 차트 위 한 줄에 유지
- 기간 필터는 segmented control처럼 정돈하되 기존 상태·필터 로직 유지

### 5-7. 상태 배지 문법

측정 중, 완료, 실패, 데이터 없음, 잠금 상태를 색만이 아니라 아이콘/텍스트와 함께 동일한 크기·패딩으로 표현한다.

### 5-8. 150~200ms의 의미 있는 전환

- hover/focus/selected 상태에만 적용
- transform/opacity/color만 사용
- 기존 `prefers-reduced-motion` 처리 유지
- 데이터 로딩 시간이나 서버 동작은 변경하지 않음

## 6. 화면별 개선안

| 화면/영역 | 유지 | 개선 | 추가하지 않는 것 |
|---|---|---|---|
| 공통 헤더 | 브레드크럼, locale, AI 등장률 | sticky hairline, 문맥 통합, 높이 축소 | 새 검색/명령 기능 |
| 사이드바 | 모든 링크, 그룹, 잠금, 조직/계정 | active rail, 색 토큰 통합, 밀도 정리 | 메뉴 삭제·라우트 변경 |
| 대시보드 상단 | 제목, 브랜드 전환, 회차, 측정 CTA | 한 작업 헤더로 재배치 | 데이터 재조회 |
| KPI | 세 지표, 계산, 링크, 비교 | 높이·baseline·border 위계 통일 | 점수 계산 변경 |
| 시스템 상태 | readiness와 출처 상태 | 2열 compact status row | 검사 항목 추가 |
| 지금 할 일 | 기존 `/actions` 진입 | P0 강조 surface, 한 문장 위계 강화 | 새 액션 생성 로직 |
| 심층 분석 | 트리거와 결과 | 상태 배지와 CTA 정렬 | API/비용/게이트 변경 |
| 추세 | 기간, 주석, 두 series | 선 중심·범례/필터 정돈 | 집계 방식 변경 |
| 질문별 성과 | 질문·순위·비율 | table-like row, column alignment | 정렬/필터 기능 추가 |
| 진실의 거울 | AI 원문·상태 | 외곽 카드 중첩 축소, row 구분 | 원문 가공 |
| 신규 빈 상태 | 설명, 이메일 안내, 3단계, 2 CTA | compact step list, CTA 조기 노출 | 온보딩 절차 변경 |
| 모바일 | 하단 탭, 더보기 | 16px gutter, sticky 문맥, touch 44px | 탭 목적지 변경 |

## 7. 디자인 방향

### 가져올 Linear 문법

- near-black 위의 미세한 surface 차이
- 1px hairline과 절제된 radius
- 한 화면에 하나의 강한 primary action
- 데이터와 키보드 작업을 방해하지 않는 짧은 motion
- 정보가 많은데도 정돈돼 보이는 baseline과 spacing
- hover보다 selected/current state를 더 명확히 하는 방식

### 그대로 복제하지 않을 것

- Linear 보라색: Findable 오렌지를 유지한다.
- 영문 중심의 극단적으로 작은 글자: 한국어 가독성을 위해 본문 14px, 모바일 핵심 본문 16px 원칙을 둔다.
- 기능에 없는 command palette, search, inbox 패턴
- 브랜드와 맞지 않는 과도한 블러·글로우

### 제안 토큰

기존 값을 최대한 재사용하고 역할만 정리한다.

| 토큰 | 제안 |
|---|---|
| Canvas | `#010102` 유지 |
| Surface base | `#090A0B` |
| Surface raised | `#0F1011` 유지 |
| Surface hover | `#141516` 유지 |
| Hairline | `#23252A` 유지 |
| Hairline strong | `#34343A` 유지 |
| Primary | `#FF7A4D` 유지 |
| Ink | `#F7F8F8` 유지 |
| Ink subtle | `#8A8F98` 유지 |
| Radius | section 8px, elevated 10px, pill만 full |
| Motion | 160ms hover, 200ms selected, ease-out |

## 8. 기능 불변 계약

### 변경 허용

- CSS 변수와 Tailwind class
- padding, gap, grid, typography, border, background, shadow
- 시맨틱 wrapper와 heading level 정리
- 기존 컴포넌트 내부의 표현 순서
- `aria-label`, focus ring, touch target 보강
- 기존 데이터를 다른 시각 계층으로 표현

### 변경 금지

- Prisma/schema/migration
- server action, API route, cron, webhook
- 측정·점수·랭킹·감성 계산
- DB query와 캐시 전략
- 권한, 플랜, 잠금 판정
- 라우트, 링크 목적지, query parameter
- analytics event 이름과 발생 조건
- 로딩·오류·빈 상태의 분기 조건
- 온보딩 tour anchor ID

### 기능 불변 검증

1. 변경 전 대상 테스트 목록과 결과를 기록한다.
2. UI 변경 후 같은 테스트를 다시 실행한다.
3. route/link/action 문자열 diff가 없는지 확인한다.
4. PC 1440, tablet 768, mobile 390에서 핵심 상태를 캡처 비교한다.
5. keyboard tab, focus ring, reduced motion을 확인한다.
6. 기능 코드 diff가 발생하면 UI 커밋에서 제거한다.

## 9. 구현 순서

### Phase 0 — 배포 격리

- 현재 dirty 작업 폴더에서 구현·배포하지 않는다.
- 최신 `origin/main` 기반 별도 worktree/브랜치를 만든다.
- 브랜치 예: `design/app-linear-shell-2026-09`
- 기존 미커밋 변경은 소유자가 정리하기 전까지 건드리지 않는다.

### Phase 1 — 토큰과 셸

- app에서 shadcn 토큰과 Findable 토큰의 역할을 정렬
- header/sidebar/inset/background만 변경
- 대시보드 내부 컴포넌트는 아직 변경하지 않음

### Phase 2 — 대시보드 상단과 KPI

- 작업 헤더 통합
- CTA 대비 보정
- KPI 밀도와 baseline 정리

### Phase 3 — 긴 데이터 섹션

- 시스템 상태, 다음 행동, 심층 분석
- 추세 차트
- 질문별 성과와 진실의 거울
- 카드 중첩과 외곽선 반복 축소

### Phase 4 — 빈 상태와 모바일

- 신규 사용자 step list compact화
- 모바일 gutter, touch target, sticky 요소 검증

### Phase 5 — Preview 검증

- 기능 테스트·typecheck
- Storybook 캡처 전후 비교
- 로그인된 Vercel Preview 스모크 테스트
- 승인 전 production 승격 금지

## 10. 롤백 반복 방지 계획

### 지금 확인된 위험

2026-09-10 로컬 상태:

- 현재 브랜치: `feature/login-branding-2026-07`
- 로컬 HEAD: `0ea50e9`
- 원격 같은 브랜치보다 **27커밋 뒤**
- `origin/main`보다 **36커밋 뒤**
- 미커밋 파일 **64개**: tracked 수정 29개 + untracked 35개
- 로컬 `main`도 `origin/main`보다 크게 뒤처져 있음
- root와 `apps/web`은 Vercel `findable`, `apps/app`은 별도 `findable-app` 프로젝트에 연결됨

이 상태에서 현재 브랜치를 production에 올리거나 오래된 브랜치를 main에 병합하면 최신 기능이 이전 내용으로 덮이는 현상이 재현될 수 있다.

### 원인 판정

로컬 증거만으로 과거 Vercel 이벤트의 단일 원인을 확정할 수는 없다. 다만 재발 가능한 경로는 명확하다.

1. 오래된 feature/local main에서 배포
2. 최신 main에 오래된 파일 상태를 merge/cherry-pick
3. Vercel에서 과거 READY 배포를 production으로 승격
4. `findable`과 `findable-app` 프로젝트를 혼동해 잘못된 루트 디렉터리 배포

현재 코드에는 production이 GitHub `main`에서 온 경우만 허용하는 `verify-production-source.js` 가 있어 1번 위험을 줄인다. 하지만 오래된 내용이 main에 들어가면 가드는 통과하므로 **브랜치 기준점과 diff 검증이 추가로 필요**하다.

### 이번 UI 작업의 안전 규칙

1. 최신 `origin/main`에서 시작한다.
2. UI 전용 브랜치에는 UI 파일과 이 문서만 포함한다.
3. 커밋을 `shell`, `dashboard`, `mobile`처럼 작게 나눈다.
4. Preview URL에서 승인받기 전 production 배포하지 않는다.
5. Preview가 가리키는 commit SHA와 PR HEAD SHA가 같은지 확인한다.
6. production은 GitHub main merge 1회로만 진행한다.
7. 배포 후 app URL에서 핵심 5경로를 스모크 테스트한다.
8. 문제 시 “이전 버전 아무거나”가 아니라 직전 승인 SHA로만 되돌린다.
9. Vercel Instant Rollback 후에도 main을 해당 상태와 일치시키는 revert commit을 남긴다.
10. 릴리스 노트에 배포 SHA, Preview URL, 승인 캡처, 롤백 SHA를 기록한다.

### 배포 직전 중단 조건

아래 중 하나라도 해당하면 배포하지 않는다.

- `git status --porcelain`이 비어 있지 않음
- 작업 브랜치가 최신 `origin/main`을 포함하지 않음
- UI 범위 밖 파일 diff가 있음
- 기존 테스트가 변경 전보다 더 실패함
- Preview commit SHA와 PR HEAD가 다름
- `findable-app`이 아닌 다른 Vercel 프로젝트를 보고 있음
- 로그인/브랜드 전환/측정 시작/대시보드 링크 중 하나라도 스모크 실패

## 11. 완료 기준

| 기준 | 목표 |
|---|---|
| 기능 diff | 0 |
| API/DB/권한/계산 변경 | 0 |
| 라우트 목적지 변경 | 0 |
| 주요 화면의 elevated card 수 | 현재 대비 30~50% 감소 |
| 상단에서 첫 KPI까지 거리 | 현재 대비 감소 |
| primary CTA 식별 | PC·모바일에서 3초 안에 식별 가능 |
| 본문 대비 | WCAG AA 4.5:1 이상 |
| touch target | 최소 44×44px |
| 반응형 | 390/768/1440px 가로 스크롤 0 |
| 모션 | reduced-motion에서 의미 손실 0 |
| 배포 | 승인된 Preview SHA와 production SHA 일치 |

## 12. 승인 권고안

추천 범위는 **A안: 셸 + 대시보드 홈의 시각 리팩터링**이다.

- 포함: 공통 헤더, 사이드바, 콘텐츠 배경, 대시보드 상단, KPI, 차트, 목록, 빈 상태, 모바일
- 제외: 다른 기능 페이지의 내부 레이아웃, 신규 기능, 정보 구조 변경, 라이트 모드 신설
- 방식: 기존 기능 컴포넌트를 유지하고 class/token/semantic wrapper 중심으로 변경
- 배포: clean worktree → Preview → 승인 → main 1회 승격

이 범위가 가장 안전한 이유는 사용자가 매일 보는 전체 인상을 바꾸면서도 데이터·동작·배포 표면을 최소화하기 때문이다.

## 13. Linear 공식 자료·오픈소스 조사

### 공식 자료에서 확인한 설계 원칙

- [A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh): 2026 refresh는 작업 콘텐츠가 먼저 보이도록 사이드바를 더 어둡게 하고, 아이콘 사용과 크기를 줄이며, 불필요한 border/separator를 줄인다고 설명한다.
- [UI refresh changelog](https://linear.app/changelog/2026-03-12-ui-refresh): header, navigation, view control의 일관성·스캔성·집중도를 개선한 공식 변경 기록이다.
- [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui): 2024 재설계에서도 sidebar, tabs, headers, panels의 시각적 잡음을 줄이고 정렬·위계·밀도를 높였다. 내비게이션 동작 변경은 위험과 범위 증가 때문에 미루고 순수 visual redesign에 집중했으며, feature flag → private beta → 점진 배포 순서를 사용했다.

이 원칙은 Findable의 제약과도 맞는다. **기능을 바꾸지 않고 global chrome과 visual hierarchy부터 바꾸는 것**이 Linear가 실제로 사용한 방식이다.

### 공개된 것과 공개되지 않은 것

- Linear production 앱의 UI 컴포넌트·전체 디자인 시스템 소스는 공식 오픈소스로 확인되지 않았다.
- [공식 `linear/linear` GitHub 저장소](https://github.com/linear/linear)는 MIT이지만 공개 범위는 SDK, import 도구, GraphQL codegen 플러그인이다. 실제 앱 UI 소스가 아니다.
- Linear 공식 문서는 [linear.style](https://linear.style)를 70개 이상의 오픈소스 커스텀 테마 모음으로 안내한다. 이는 색상 테마 자료이지 대시보드 컴포넌트 라이브러리가 아니다.
- [soul-design-md의 Linear DESIGN.md](https://github.com/soulcore-dev/soul-design-md/blob/main/designs/linear/DESIGN.md) 같은 제3자 분석 자료는 존재하지만 Linear 공식 배포물이 아니다. 참고 자료로만 사용하고 공식 글·실제 화면과 대조해야 한다.

### 현재 로컬 자료와 스킬

- 저장소 루트의 `Design System Linear.md`는 `f045cb9` 커밋에서 프로젝트와 함께 들어온 로컬 참고 문서다. Git 이력만으로 공식 출처를 입증할 수 없어 공식 문서로 취급하지 않는다.
- 설치된 스킬 중 Linear 전용 스킬은 없다.
- 이번 감사에는 `frontend-design`, `ui-ux-pro-max`, `webapp-testing`, `systematic-debugging`을 사용한다. Linear의 시각 원칙은 공식 자료에서 가져오고, 스킬은 접근성·반응형·검증 절차에 사용한다.

### 적용 원칙

1. 공식 글의 구조 원칙을 우선한다.
2. 공식 화면과 changelog로 현재 UI를 확인한다.
3. 로컬/제3자 토큰 문서는 보조 자료로만 사용한다.
4. Linear 상표·로고·고유 아이콘을 복제하지 않는다.
5. Findable 브랜드와 기능을 유지하면서 밀도·위계·정렬·경계선 문법만 가져온다.
