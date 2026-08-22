# 🔑 소셜 로그인 — ✅ 해결됨 (2026-07-29)

> 작성 2026-07-24 · **해결 2026-07-29**. 호출: "파인더블 소셜 로그인 이어가자"
> 앱=app.findable.co.kr(Vercel 프로젝트 `findable-app`, apps/app). 로그인 UI=packages/auth/components/.

---

## ✅ 최종 해결 (2026-07-29) — 이게 정답
**로그인 완전 정상. 실사용자(nayoy2@gmail.com) 구글 로그인·세션·재방문 확인.**

### 진짜 근본 원인 (429 가설은 ❌ 틀렸음)
- 아래 "429 한도" 가설은 **오진이었다.** 인스턴스는 이미 Production이었고 429도 아니었음.
- 진짜 원인 = **커스텀 로그인 코드가 실험/Future API(`signIn.sso`/`signIn.password`/`signIn.finalize`, 수동 `clerk.handleRedirectCallback`)를 씀.** 그런데 실제 로드되는 clerk-js는 6.x(`@clerk/nextjs@7`이 `@clerk/react@^6.12.8`을 의존 → clerk-js 6.25.10 로드가 **정상**. react@7 라인은 존재하지 않음). 6.x는 그 실험 API를 미지원 → `sign_ins` 400·`session_exists`·`state_token_already_used`·"Oops, something went wrong".
- 진단 근거: Clerk **Logs**의 `oauth_callback.failed`, sign_ins 400 응답 본문 `code: "session_exists"`.

### 해결 방법 = Clerk 표준 컴포넌트로 전면 교체 (커스텀 누더기 폐기)
- `sign-in.tsx` → 표준 `<SignIn/>` (소셜버튼은 Clerk 대시보드 SSO 설정대로 위젯 자동렌더)
- `sign-up.tsx` → 표준 `<SignUp/>`
- `sso-callback.tsx` → 표준 `<AuthenticateWithRedirectCallback/>`
- `(unauthenticated)/layout.tsx` → 서버 `auth()` 가드: 로그인돼 있으면 `/`로 redirect(중복 로그인 시도로 인한 `session_exists` 400 차단)
- `shared.tsx`(커스텀 버튼 스타일) 삭제. 브랜드 외관은 `provider.tsx`의 `appearance`가 위젯에 주입.
- 전 앱 tsc 0·lint 통과·app 프로덕션 배포 완료.

### ⚠️ 다음 세션 교훈
- **커스텀 Clerk 흐름(useSignIn/useSignUp + signIn.sso/finalize) 다시 만들지 말 것.** 로드되는 clerk-js 버전과 안 맞아 깨진다. **항상 표준 `<SignIn/>`/`<SignUp/>` 컴포넌트 사용.**
- 소셜 버튼이 위젯에 안 보이면 = Clerk 대시보드 **SSO Connections** 설정 문제(코드 아님).

---

## 🗄️ (구) 429 가설 — 오진 기록 (참고용, 실행 금지)
아래 내용은 2026-07-24 작성 당시 가설이며 **틀렸다.** 프로덕션 전환·CNAME 등은 이미 돼 있었고 원인이 아니었다. 이력 보존용.

## ⭐ (구) 한 줄 결론
**소셜 로그인 코드는 다 고쳤음. 마지막 남은 근본 원인 = Clerk "개발(development) 인스턴스"의 요청 한도(429). → 프로덕션 인스턴스로 전환하면 끝. 무료 가능.**

---

## 지금 상태 (무엇이 되고 무엇이 안 되나)
- ✅ 브랜드 로그인 UI (구글·카카오·네이버 버튼 + 이메일/비번) 라이브 정상 렌더
- ✅ 크롬에서 버튼 눌림 → 구글 로그인 → 콜백 도착까지 성공 확인됨
- ⚠️ **429 (Too Many Requests)** — 개발 인스턴스 한도 초과로 sign_ins 요청이 막힘. 됐다 안 됐다 하는 원인. **코드로 못 고침.**
- ⚠️ Arc 브라우저는 자체 광고차단으로 버튼 무반응 → **크롬 쓰면 됨** (브라우저 문제, 코드 아님)

## 디버깅으로 이미 해결한 것들 (다시 만지지 말 것)
1. 카카오 Client Secret pending → Clerk에 입력함 (KOE010 해결)
2. sso-callback 옛날 Clerk 화면 튕김 → 우리 라우트로 고정
3. 로그인 후 `/sign-in/tasks` 멈춤 → Clerk Organizations "Membership required + Create first organization automatically" 설정함
4. 버튼 무반응 → Arc/uBlock 차단이었음 (크롬에서 정상)
5. 콜백 멈춤 → `HandleSSOCallback` 컴포넌트가 이 Clerk 버전서 미작동 → `clerk.handleRedirectCallback` 직접 호출로 교체 (sso-callback.tsx)
6. redirectUrl 절대경로화, useSignIn/useSignUp의 signIn undefined 가드(ready), 버튼 disabled 가드

## 코드 현황 (건드리지 말 것 — 다 배포됨)
- `packages/auth/components/sign-in.tsx` — 신형 Future API(signIn.password/sso/finalize), ready 가드, 에러 화면표시
- `packages/auth/components/sign-up.tsx` — signUp.password/verifications.sendEmailCode/verifyEmailCode/finalize
- `packages/auth/components/sso-callback.tsx` — clerk.handleRedirectCallback 직접, 실패시 세션 있으면 / 로
- `packages/auth/components/shared.tsx` — 브랜드 스타일·OAuth 마크
- `apps/app/app/(unauthenticated)/{layout,sign-in,sign-up,sso-callback}` — 브랜드 레이아웃·라우트
- 의존성 추가됨: packages/auth에 `next@16.1.6`, `@clerk/react@^6.4.6`
- ⚠️ git: `feature/login-branding-2026-07` 브랜치에 로그인 커밋 1개(4ee9188) 했으나 이후 수정들(sso-callback 여러 번 등)은 **미커밋**. 로컬→vercel 직접배포만.

---

## ▶️ 다음 세션 할 일 = Clerk 프로덕션 전환 (429 근본 해결, 무료)

**순서 (계정작업=사용자, 코드·배포=Claude):**

1. **[사용자] Clerk prod 인스턴스 생성**
   - Clerk 대시보드 상단 "Development ∨" 드롭다운 → **Create production instance** → 개발설정 복제(clone) 선택
   - ⚠️ Clerk 무료 플랜에서 프로덕션 인스턴스 **무료** (MAU 1만까지). 이전 세션서 "Pro 필요"라 한 건 오안내.

2. **[사용자] 가비아 DNS에 CNAME 추가** (findable.co.kr 네임서버 = 가비아 확인됨)
   - Clerk이 주는 CNAME들(clerk / accounts / clkmail / clk._domainkey 등)을 가비아 DNS관리에 입력
   - Clerk 화면에서 전부 "Verified" 초록 뜰 때까지 대기(10~30분). 이게 제일 오래 걸림.

3. **[사용자] 소셜 자격증명 3종 재입력** (개발 시크릿은 prod로 복사 안 됨)
   - prod redirect URI = `https://clerk.findable.co.kr/v1/oauth_callback` (실제값은 prod 인스턴스가 표시)
   - 카카오: REST API키(`410b2b26...`)+Secret / 콘솔 Redirect URI에 위 주소
   - 구글: Client ID/Secret / 승인된 리디렉션 URI에 위 주소 (prod는 shared 안 됨)
   - 네이버: Client ID(`a1B2ojye...`)/Secret / Callback URL에 위 주소
   - Clerk 각 커넥션 slug는 `kakao`/`naver` 유지(코드가 oauth_custom_kakao/naver 씀)

4. **[Claude] Vercel findable-app Production env 교체**
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = pk_live_..., `CLERK_SECRET_KEY` = sk_live_... (prod API keys에서)
   - Production 스코프만. 그다음 재배포.

5. **[Claude+사용자] 검증**: 크롬 시크릿창 → 구글/카카오/네이버 각각 → 대시보드 진입 확인.

**상세 가이드**: `docs/_적용/Clerk_프로덕션전환_가이드.md`, `docs/_적용/소셜로그인_설정가이드.md`

## 배포 방법 (findable-app)
루트에서: `cp .vercel/project.json .vercel/project.json.web-bak && cp apps/app/.vercel/project.json .vercel/project.json` → `vercel deploy --prod --yes` → 끝나면 `mv .vercel/project.json.web-bak .vercel/project.json` 복구.
검증: apps/app에서 `npx tsc --noEmit` 0, `npx ultracite fix`. ⚠️로컬 tsc 통과해도 빌드가 더 엄격(신형/구형 Clerk 오버로드)하니 배포로 최종확인.
