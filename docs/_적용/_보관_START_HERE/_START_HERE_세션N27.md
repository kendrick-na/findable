# 🧭 START HERE — 세션 N-27 (2026-08-13 세션N-26 인계)

> ⚠️ **이 파일 + `_투두_단일진실_N25.md` 두 개만 열면 된다.**
> ⛔ `_START_HERE_세션N26` 이하 전부 폐기.
> 🔴 이번 세션의 남은 일은 **UI/UX 감사 결과 실행**이다(아래 §3). 코드 결함 트랙은 소진됐다.

---

## 0. ⚡ 새 세션 첫 3분

```bash
cd /Users/easymilli/Downloads/바이브코딩/Findable
git log --oneline -1        # b30f6dd 이면 인계 시점 그대로
git status --short          # ⚠️ packages/payments/ 4건은 **다른 세션 것** — 건드리지 말 것
cd apps/app && npx vitest run   # 309/309 여야 정상
```

**현재 상태**: 테스트 **309/309** · web·app tsc **0** · 세션N-26 커밋 **11건 전부 배포·라이브 확인**

---

## 1. 👤 대표님이 승인한 것 (그대로 실행할 것)

> 원문: *"제안 a,b 2개다 하자. 다만 b는 관리자 계정 변경이 아니라 **추가**."*

| 안 | 내용 | 크기 | 누가 |
|---|---|:--:|---|
| **A** | **`/admin/audits` 관리자 진단 목록 화면 신설** | **M** | 나 |
| ✅ **B** | 🔴 지시 오류 — **Clerk `publicMetadata.role`** 이 정답(아래 §B) | S | 👤 **완료됨** |

### 🔴 A 를 만들 때 반드시 지킬 것
- **이메일은 마스킹**(`maskEmail`) — 운영자라도 **필요 최소한**만 본다.
  (세션N-26 이 서버측 소유자 판별을 넣은 것과 같은 원칙)
- `isAdmin()` 게이트 필수(`@repo/auth/admin` · `/admin/ops` 와 같은 방식)
- 보여줄 것: 도메인 · 이메일(마스킹) · 상태 · 점수 · **결과 링크**(jobId)
- ⚠️ **새 판정 규칙을 만들지 말 것** — 기존 `admin/ops` 패턴 재사용

### ✅ B — **이 지시는 틀렸었다. 세션N-27 이 정정하고 완료 확인함**

> ⛔ 아래 원문은 **틀린 지시**다(기록 보존용). `FINDABLE_ADMIN_EMAILS` 는
> **사용량 티어**(진단 무제한)일 뿐, 관리자 화면과 **무관**하다.
> ~~현재 프로덕션 FINDABLE_ADMIN_EMAILS 에 콤마로 덧붙인다 → Vercel 재배포~~

**정답 = Clerk 대시보드 → Users → 계정 → Metadata → Public metadata**
```json
{ "role": "admin" }
```
- 진실은 `packages/auth/admin.ts` → `hasAdminRole()` = `publicMetadata.role === "admin"`
- ⭐ **재배포 불필요** — Clerk metadata 는 서버가 매 요청 읽는다(로그아웃→재로그인이면 반영)
- ⚠️ 소문자 정확히. `Admin`·`ADMIN`·앞뒤 공백은 **막힌다**(테스트로 고정)
- ✅ **실제로는 이미 되어 있었다**: `nayoy2@gmail.com` = `{"plan":"growth","role":"admin"}`

---

## 2. 🔬 왜 A 가 필요한가 (실측 근거 — 재조사 금지)

```
DB 에 완료된 진단 83건이 있다 (랜딩 LIVE 카운터가 auditJob.count 로 읽는 실수치)
결과 페이지는 jobId 만 알면 볼 수 있다 (설계상 비로그인 허용 · route.ts:3 주석)
그런데 **jobId 목록을 보여주는 화면이 없다**
→ 운영자가 "우리 고객이 뭘 측정했나"를 볼 방법이 제품에 없다
```

- `/admin/ops` 는 **집계 숫자만**(count·groupBy 6곳). 개별 진단 조회 **0건**
- admin 폴더 전체에 `auditJob.findMany` **0건**(grep 실측)
- 👤 대표님 판단: *"우리가 운영자인데 고객들이 측정한 데이터는 원래 볼 수 있어야 하는 거 아닌가"* → **맞다. 권한 문제가 아니라 화면이 없는 것.**

🔬 세션N-26 이 실데이터를 본 경로 = 소스에 하드코딩된 데모 jobId
`apps/web/app/[locale]/synergy/page.tsx:59` → `/ko/audit/57fbfad0-2ba1-47b8-b2d9-fa6e5f4e36b7`
(메디큐브 실제 진단 · 완전한 데이터 · **결과 페이지 감사에 이걸 쓸 것**)

---

## 3. 🎨 UI/UX 감사 결과 — **실행 대기 9건 (전부 S)**

> 🔴 **근거는 전부 실측이다. 재감사하지 말고 바로 고칠 것.**
> 도구: `~/.claude/skills/ui-ux-quality/scripts/{measure,a11y,align,squint}.mjs`
> ⚠️ playwright 가 필요하므로 **Findable 폴더에서** 실행한다.

> ⚠️ 번호는 **투두 단일진실 §2-B 의 U1~U9 와 같은 것**이다(두 문서 대조용).

| # | 할 일 | 근거(실측) | 영향 |
|:--:|---|---|---|
| **U1** | `text-zinc-500` → `zinc-400` | **4.32:1 → 8.14:1** (AA 4.5 미달) | 결과페이지 **51곳** · 파일 내 40회 사용 |
| **U2** | `--findable-ink-tertiary` `#62666d` → **`#72767d`** | **3.62:1 → 4.57:1** | web+app **76곳** · `/billing` 11곳 |
| **U3** | 모바일 메뉴 버튼 `aria-label` | axe **critical** | 스크린리더가 *"버튼"* 으로만 읽음 |
| **U4** | 엔진 라벨 **3쌍 겹침** | 랜딩 y≈7208 · 한 줄 7개 | **모든 모바일 방문자** |
| **U5** | `SelectTrigger` 에 `w-full` | 200% 확대 **246>195px** | WCAG 1.4.10 |
| **U6** | 이메일 `break-all` | 대시보드 200% **263>195px** | WCAG 1.4.10 |
| **U7** | `prefers-reduced-motion` 대응 | 코드 전체 **0건** | 전정장애 |
| **U8** | 한글 음수 자간 15곳 | 랜딩11 + 결과4 | 메모리 규칙 위반 |
| **U9** | `/webhooks` · `search.tsx` 삭제 | 링크 **0건** · import **0건** | ROT |

⭐ **U1+U2 만으로 대비 위반 127곳이 해결된다.** 여기부터 할 것.

### 🔴 정확한 위치
- **U1** `apps/web/app/[locale]/audit/[jobId]/components/audit-result.tsx` (40회)
- **U2** `packages/design-system/styles/globals.css:25`
- **U3** `apps/web/app/[locale]/components/header/index.tsx:148` (아이콘만 있는 Button)
- **U5** `apps/web/app/[locale]/audit/components/audit-form.tsx:185` `<SelectTrigger id="audit-language">`
  (원인 = design-system `select.tsx` 기본값 `w-fit` + `whitespace-nowrap`)
- **U6** 대시보드 홈 소유권 안내의 이메일 `<span>`
- **U9** `apps/app/app/(authenticated)/webhooks/` · `components/search.tsx` + `search/page.tsx`

### 🔬 착수 후 검증법 (전/후 숫자를 남길 것)
```bash
cd /Users/easymilli/Downloads/바이브코딩/Findable   # playwright 가 여기 있다
node ~/.claude/skills/ui-ux-quality/scripts/a11y.mjs <URL> mobile      # 대비 위반 수
node ~/.claude/skills/ui-ux-quality/scripts/measure.mjs <URL> mobile   # 음수 자간·화면 수
```
- 결과페이지 실데이터 URL = `/ko/audit/57fbfad0-2ba1-47b8-b2d9-fa6e5f4e36b7`
- 🔴 **U1 전 51곳 → 후 0곳**, **U2 전 web1·app11곳 → 후 0곳** 이 목표치다

---

## 4. ⛔ 하지 말 것 (감사에서 **기각**한 것)

| 항목 | 왜 기각인가 |
|---|---|
| 🔴 **정렬 8종·간격 25종 전면 정리** | 좌측선 일부(65/89/81px)는 **아이콘 목록의 의도된 들여쓰기**. 스킬도 *"판정은 사람이 한다"*. **1~3px 근사 불일치만** 고칠 것 |
| 🔴 **엔진 카드 3개가 "중복"이라고 고치기** | **오진**이다. 그 제품은 엔진별 답을 비교하는 도구라 **닮은 것이 결과**다(`audit-loop.md` 경고 그대로) |
| 🔴 **랜딩 11.7화면을 "너무 길다"고 줄이기** | `criteria.md`: 화면 수는 **실격 기준이 아니라 질문을 여는 숫자**. Stripe=24.1화면. GEO 는 낯선 개념이라 길이가 정당 |
| **대비 1.06:1 "로고"** | **오탐** — axe 가 투명 배경을 흰색으로 오인 |
| **"라벨 없는 입력"** | **오탐** — Radix 의 1×1px `aria-hidden` select |
| **"빈 구간 2.6화면"** | **내 도구의 아티팩트** — `IntersectionObserver` reveal 때문에 fullPage 캡처에서만 비어 보인다. 실제 스크롤하면 정상 |
| **결과페이지 탭 잘림** | **오탐** — 가로스크롤 정상 동작 |

---

## 5. ✅ 세션N-26 이 한 일 (커밋 11건 · 전부 배포)

| # | 무엇 | 커밋 |
|:--:|---|---|
| 1 | **429 "문의해 주세요"에 실제 문의 링크** | `b7d890b` |
| 2 | 🔒 **공유링크 이메일 노출** — 서버측 소유자 판별 | `3633629` |
| 3 | **요금제 「현재」 배지** — 추천플랜 결제자가 못 보던 것 | `f46d6bc` |
| 4 | 🆕 **가입·결제 고객에게 「가입하세요」** 뜨던 것 | `75438e1` |
| 5 | 🆕 **메일 발송 실패해도 "곧 보내드려요"** | `4760a39` |

⭐ **#4·#5 는 투두리스트에 없던 결함**이다. 둘 다 같은 렌즈로 나왔다 —
**"화면이 약속한 것을 제품이 실제로 지키는가"**. 목록을 따르는 것보다 **의심하는 것**이 값을 냈다.

---

## 6. 🎓 세션N-26 이 배운 것 (같은 실수 반복 금지)

1. 🔴🔴 **가드를 새로 짜면 반드시 뮤테이션을 돌린다.** 이번에 **2번 뚫렸다**:
   ①정규식 블록주석 제거가 **40,570자**(실제 코드 대부분)를 삼켜 **빈 문자열을 검사**하고 있었다
   ②*"형태"* 로 판정하니 **다른 형태의 되돌림이 통과** → *"어디에 있는가"* 로 교체
   → **통과는 증거가 아니다.**
2. 🔴 **스킬을 쓸 땐 참조 파일을 다 읽는다.** 16개 중 2개만 읽고 감사했다가
   👤 에게 *"스킬 전체 반영한 결과 맞아?"* 를 들었다. `ia.md` 를 **화면 감사 전에** 읽어야 했다.
3. 🔴 **11.8화면짜리를 첫 화면만 보고 판정하지 않는다.** squint 는 구간으로 나눠 내고,
   **본 장 수를 보고에 쓴다**(*"8장 중 8장"*).
4. ⭐ **"못 한다"고 말하기 전에 해본다.** 스크린리더를 *"자동화 불가"* 라 했는데
   `page.locator('body').ariaSnapshot()` 으로 **스크린리더가 읽는 트리를 그대로** 볼 수 있었다.
   키보드 워크스루·색맹(grayscale)도 전부 자동화됐다.
5. ⭐ **숫자를 셀 때 무엇끼리 비교하는지 본다.** 라벨 겹침을 처음 *"10쌍"* 이라 셌는데
   **다른 줄에 있는 라벨끼리** 비교한 오류였다. 같은 줄로 묶으니 **3쌍**.

---

## 7. ⚠️ 함정 (계속 유효)

- 🔴🔴 **엔진 수 재조사 금지** — 본류=**7** · 영어만=**4** · 8=브리핑 별도
- 🔴 **BotID 가 curl 을 차단한다** → 진단 생성은 **브라우저로만**
- 🔴 **`apps/web` 에 테스트 러너 없음** → 고정할 로직은 `packages/` 로 빼고 `apps/app` 에서
- 🔴 **`apps/api` 는 죽은 앱** — 새 코드 넣으면 실행되지 않는다
- 🔴 **DB 직접 조회 막힘**(한글 NFD + Prisma CJS) → 라이브 API 나 화면으로 확인
- 🔴 **biome: 복잡도 20 · 중첩 삼항 금지 · 정규식은 최상위 상수 · `/**` 대신 `/*`**
- ⚠️ biome 이 **대괄호 경로**(`[jobId]`)를 직접 못 읽는다 → 상위 디렉터리로 lint
- 🔴 로컬 build 는 **`VERCEL=1`**
- ⭐ **배포**: web = `npx vercel --prod --yes --scope nayoy2-7791s-projects`(루트)
  / app = `VERCEL_PROJECT_ID=prj_krY2Z1RCQUymaENTPtkUK51rbjOA VERCEL_ORG_ID=team_Hf0ltKNpfGZ7j88gcouH57LK` 를 앞에 붙여 **루트에서** 실행
  (⚠️ `project.json` swap 불필요 — 이 방법이 더 안전하다. 세션N-26 확립)
- ⭐ **UI/UX 감사 로그인**: `apps/app/.env.local` 의 `FINDABLE_TEST_EMAIL`/`FINDABLE_TEST_PW`
  로 Clerk 로그인 후 `storageState` 저장 → 대시보드 측정 가능(세션N-26 실증).
  🔴 단 그 계정은 **`nayoy2+qa@`(별칭)** 라 **측정 이력 0건**이다 — `+alias` 는 다른 사람으로 판정된다

---

## 8. 🔴 다음 세션이 잊으면 안 되는 것

> **① 다음 착수 = §3 UI/UX 9건**(U1·U2 먼저 — 대비 127곳). 그다음 §1 의 **A**
> **② §4 는 기각 목록이다.** 되살리지 말 것(오진·오탐 근거 있음)
> **③ B 는 👤 대표님 몫** — 관리자 계정 **추가**(변경 아님). 기존 `kend***@indigochild.kr` 유지
> **④ 가드 새로 만들면 뮤테이션 필수.** 세션N-26 은 2번 뚫렸다
> **⑤ ⚠️ `packages/payments/` 는 다른 세션 작업 중** — 건드리지 말 것
> **⑥ 🔴 회사 병목은 여전히 P0 실고객·유통이다.** UI/UX 9건은 전부 S 라 지금 하는 것이지,
>    이걸로 매출이 생기지 않는다. 감사가 그걸 가리지 않게 할 것(`audit-loop.md` 4절)
