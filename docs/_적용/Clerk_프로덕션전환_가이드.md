# Clerk 프로덕션 인스턴스 전환 가이드

> 작성 2026-07-23. 목적: app.findable.co.kr을 개발(development) Clerk 인스턴스 → **프로덕션(production)** 으로 전환.
> 배경: 소셜 로그인(구글·카카오·네이버) 실패 원인이 개발 인스턴스의 shared/pending 자격증명. 프로덕션은 본인 자격증명 필수라 어차피 전환하며 한 번에 제대로 설정.
> 역할: 코드/배포(③⑤)=Claude, 계정 작업(①②④)=사용자(대시보드·DNS·콘솔 접근 권한 필요).

---

## 진행 순서 (이 순서 지킬 것 — 어기면 로그인 끊김)

### ① Clerk 프로덕션 인스턴스 생성  [사용자]
1. Clerk 대시보드 우상단 **"Go to prod"** 클릭
2. "Create production instance" → 개발 설정을 복제할지 물으면 **복제(clone) 선택** (소셜 커넥션 틀 가져옴, 단 자격증명은 다시 넣어야 함)
3. 생성되면 상단이 🟢 **Production** 으로 바뀜

### ② 도메인 + DNS 인증  [사용자]
1. 프로덕션 인스턴스 → **Domains** (또는 전환 마법사가 안내)
2. Clerk이 요구하는 도메인 = 보통 `clerk.findable.co.kr` (Frontend API용 CNAME 등)
3. Clerk이 주는 **CNAME 레코드들**(clerk / accounts / clkmail 등 여러 개)을 → **도메인 등록업체(가비아·카페24·Cloudflare 등)** DNS에 그대로 추가
4. Clerk 화면에서 각 레코드 **"Verified"** 초록 뜰 때까지 대기 (DNS 전파 수분~수십분)
   - ⚠️ 이게 끝나야 프로덕션 로그인이 동작. 제일 오래 걸리는 단계.

### ③ 새 프로덕션 키를 Vercel에 반영  [Claude + 사용자]
1. [사용자] Clerk 프로덕션 → **API keys** 에서 복사:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_live_...`
   - `CLERK_SECRET_KEY` = `sk_live_...`
2. [Claude/사용자] Vercel `findable-app` 프로젝트 → Settings → Environment Variables → **Production** 스코프의 위 두 값을 새 live 키로 교체
   - ⚠️ Preview/Development 스코프 말고 **Production** 만.
3. (필요시) `CLERK_WEBHOOK_SECRET` 도 프로덕션 웹훅 재설정 시 갱신

### ④ 소셜 자격증명 3종 — 콘솔 + Clerk 양쪽  [사용자]
프로덕션 Redirect URI는 이제:
```
https://clerk.findable.co.kr/v1/oauth_callback
```
(정확한 값은 프로덕션 인스턴스가 알려주는 Frontend API 도메인 기준. Clerk 각 커넥션 화면에 "Redirect URI" 로 표시됨 → 그 값을 콘솔에 등록.)

- **카카오**: 콘솔 보안탭 Client Secret 발급(활성화 ON) → Clerk Kakao 커넥션에 Client ID(REST API 키)+Secret 입력·저장 → 콘솔 Redirect URI에 위 주소 등록
- **구글**: Google Cloud Console에서 OAuth 클라이언트 ID/Secret → Clerk Google 커넥션에 입력(프로덕션은 shared 안 됨) → 승인된 리디렉션 URI에 위 주소
- **네이버**: 콘솔 Client ID/Secret → Clerk Naver 커넥션 입력 → 콘솔 Callback URL에 위 주소
- 각 Clerk 커넥션 저장 후 **pending 없이 저장 완료** 확인

### ⑤ 재배포 + 검증  [Claude]
1. Vercel `findable-app` 프로덕션 재배포 (env 반영 위해)
2. 시크릿창으로 app.findable.co.kr/sign-in → 구글·카카오·네이버 각각 로그인 → 대시보드 복귀 확인

---

## 체크리스트
- [ ] ① prod 인스턴스 생성 (🟢 Production)
- [ ] ② DNS CNAME 추가 + 전부 Verified
- [ ] ③ Vercel Production env → pk_live/sk_live 교체
- [ ] ④ 카카오 ID+Secret+RedirectURI
- [ ] ④ 구글 ID+Secret+RedirectURI
- [ ] ④ 네이버 ID+Secret+CallbackURL
- [ ] ⑤ 재배포 + 3종 로그인 검증

## 주의
- DNS Verified 되기 전에 Vercel 키만 바꾸면 로그인 전면 끊김 → **② 완료 후 ③**.
- 되돌리려면 Vercel env를 다시 pk_test/sk_test로 넣고 재배포하면 개발 인스턴스로 복귀.
- 코드 변경은 없음(키·설정만). 코드는 dev/prod 동일하게 동작.
