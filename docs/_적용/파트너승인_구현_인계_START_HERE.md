# 🤝 파트너 승인 기능 — 구현 인계 (START HERE)

> 작성 2026-07-28. 호출: "파인더블 파트너 승인 이어가자"
> 기획 = `docs/_적용/파트너승인_기능_기획.md`. 이 문서 = 구현된 코드 + 남은 배포/설정.

---

## ⭐ 한 줄 결론
**코드는 다 짰다(tsc·lint 통과). 남은 건 계정/인프라 2가지 = ①DB 테이블 push ②내 계정에 admin role 부여. 그다음 배포·검증.**

---

## 무엇이 만들어졌나 (관리자=나만 전부 관리)

**게이트 3중**(클라이언트만 숨기는 함정 회피):
1. 사이드바 "관리자 › 파트너 승인" 메뉴 — admin 에게만 렌더 (layout 서버 판정)
2. `/admin/partners` 페이지 — 서버에서 `isAdmin()` 재확인, 아니면 404
3. 서버 액션 — `requireAdmin()` 첫 줄 게이트 (URL 직접 접근·API 우회해도 차단)

**추가/변경된 파일**:
- `packages/database/prisma/schema.prisma` — `PartnerApplication` 모델 + `PartnerApplicationStatus` enum (userId @unique = 1인 1건)
- `packages/auth/admin.ts` (신규) — `isAdmin()` / `requireAdmin()` 서버 헬퍼
- `packages/auth/plan.ts` — `PartnerStatus` 타입 + `hasPartnerAccess()` 추가
- `packages/design-system/components/ui/sonner.tsx` — `toast` re-export 추가(앱에서 import 위해)
- `apps/app/app/actions/partner/apply.ts` (신규) — 신청(self, pending upsert)
- `apps/app/app/actions/partner/decide.ts` (신규) — 승인/거절(admin 게이트 + 2단계 write)
- `apps/app/app/actions/partner/query.ts` (신규) — 내 상태 조회 + 관리자 목록(Clerk 이름/이메일 보강)
- `apps/app/app/(authenticated)/admin/partners/page.tsx` (신규) — 관리자 페이지(404 게이트)
- `apps/app/app/(authenticated)/admin/partners/partner-review-table.tsx` (신규) — 검토 테이블(탭 필터·낙관적·거절 다이얼로그)
- `apps/app/app/(authenticated)/components/partner-cta.tsx` + `partner-cta-client.tsx` (신규) — 사용자 신청 CTA(상태별 분기·신청 모달)
- `apps/app/app/(authenticated)/{layout,page,components/sidebar}.tsx` — CTA·admin 메뉴 연결

**핵심 설계**(기획 §4): DB=단일 진실. 승인 = ①DB write(status=approved) → ②Clerk `plan="insider"` push(멱등·3회 재시도, 실패해도 DB 유지 → 경고 반환).

---

## ▶️ 남은 일 (순서대로)

### 1. [Claude] DB 테이블 생성 — `prisma db push`
- ⚠️ 로컬에 `DATABASE_URL` 이 안 잡혀 이번 세션에선 push 실패했음.
- 방법 A(권장): 루트에서 Neon `DATABASE_URL` 이 로드되는 환경으로 실행.
  `cd packages/database && npx prisma db push`  (신규 테이블 추가라 기존 데이터 안전)
- 방법 B: Vercel env pull 후 실행 — `vercel env pull .env.local`(database 스코프) → push.
- 성공 확인: `npx prisma studio` 또는 Neon 콘솔에 `PartnerApplication` 테이블 존재.

### 2. [사용자] 내 계정에 admin role 부여 (1회)
- Clerk 대시보드 → Users → 내 계정 → **Metadata → Public** 에 아래 추가:
  ```json
  { "role": "admin" }
  ```
- ⚠️ 이미 `plan` 등 다른 키가 있으면 **합쳐서** 저장(덮어쓰기 말 것): `{ "plan": "...", "role": "admin" }`
- 저장 후 앱에서 로그아웃→재로그인(세션 클레임 갱신). → 사이드바에 "관리자" 그룹이 뜨면 성공.

### 3. [Claude] 배포 (findable-app)
- 루트에서: `cp .vercel/project.json .vercel/project.json.web-bak && cp apps/app/.vercel/project.json .vercel/project.json` → `vercel deploy --prod --yes` → 끝나면 `mv .vercel/project.json.web-bak .vercel/project.json` 복구.
- (상세 = `docs/_적용/_소셜로그인_인계_START_HERE.md` 배포 방법)

### 4. [Claude+사용자] E2E 검증 (크롬)
- 일반 유저(admin 아님)로: 대시보드에 "파트너로 신청하기" 카드 보임 → 신청 → "심사 중" 전환.
- 내 계정(admin)으로: 사이드바 "파트너 승인" → 신청 목록에 위 신청 보임 → [승인] → 토스트.
- 승인된 유저 재로그인 → insider 배지/접근 확인. (Clerk 캐시 반영 위해 재로그인 필요할 수 있음)
- 거절 → 신청자에게 사유 + "다시 신청하기" 보임.

---

## ⚠️ 주의 / 알아둘 것
- **plan 어휘 2종 분리**: DB `Plan` enum(free/starter/growth/scale/enterprise = 결제축)과 `plan.ts` Plan(free/insider/pro/enterprise = 앱 게이팅축)은 별개. 파트너 승인은 **게이팅축의 insider** 만 건드림. DB Plan enum 안 건드렸음.
- **insider 접근권 진실은 DB** = `PartnerApplication.status=approved`. Clerk `plan="insider"` 는 빠른 표시용 캐시. 캐시 드리프트 시 DB 가 정답.
- `docs/_적용/실행백로그.md` D14 P1 `[Clerk admin role 설정여부 확인필요]` → 이 기능이 role="admin" 방식으로 해소. (백로그 갱신 필요)
- 검증 명령: `apps/app` 에서 `npx tsc --noEmit`(0) · `npx ultracite fix apps/app/app`(0). ⚠️ design-system `resizable.tsx` 오류는 **기존 이슈**(내 변경 무관).
- 범위 밖(다음): 승인/거절 **알림 메일**(packages/notifications), 결제 연동.
