# 화면 검증 절차 (로컬에서 눈으로 보기)

> 세션N-6에서 확보한 경로. 세션N-5는 이걸 "불가능"으로 결론냈으나 **원인 진단이 틀렸던 것**이다.
> UI를 고쳤으면 **배포 전에 반드시 눈으로 볼 것.** 코드만 믿으면 이번 세션처럼 거짓 숫자가 살아남는다.

## 1. web(무료진단·랜딩) — 가장 쉬움

```bash
cd apps/web && VERCEL=1 bun --bun next dev -p 3001
```
- 🔴 **`VERCEL=1` 필수**: 없으면 `packages/database`가 WebSocket 경로를 쓰고
  **Bun에서 Neon 핸드셰이크가 깨진다**(`Unexpected server response: 101` → API 500).
  프로덕션은 원래 정상이므로 **코드를 수정하지 말 것.**
- 결과페이지 URL: `http://localhost:3001/ko/audit/<jobId>`
  (307 리다이렉트로 로케일이 벗겨지는 게 정상 — `rewriteDefault` 전략)

## 2. app(로그인 후 대시보드) — 로그인이 막힘

```bash
# ① Clerk·DB 키를 web → app 으로 복사 (값은 apps/web/.env.local 에 실재)
#    CLERK_SECRET_KEY · NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY · DATABASE_URL
# ② app/.env.local 의 **빈 문자열 키를 주석처리** (zod .optional()이 ""를 거부해 부팅 실패)
# ③ 기동
cd apps/app && VERCEL=1 bun --bun next dev -p 3002
```

🔴 **로그인 자동화는 불가**: 가입 화면에 **Cloudflare Turnstile**(봇 검사)이 있다.
🔴 **DB는 프로덕션인데 Clerk 키는 dev 인스턴스**(`pk_test`) → **org id가 안 맞아 Tracking 경로가 빈다**
   (대시보드 1차 소스가 Tracking이므로 AuditJob 폴백만 렌더된다).

→ **우회법**: `(authenticated)` 그룹 **밖**에 임시 라우트를 만들어 실제 컴포넌트에 실제 DB 데이터를 넣는다.
   Clerk를 타지 않으므로 화면이 그대로 보인다. **확인 후 반드시 삭제.**
   ⚠️ 새 최상위 라우트는 **dev 서버 재기동 필요**(Turbopack이 즉시 인식 못 함).
   ⚠️ `_` 로 시작하는 폴더명은 Next.js가 private로 보고 **라우팅하지 않는다**(404).

```tsx
// apps/app/app/tmp-preview-check/page.tsx  ← 확인 후 삭제
import { database } from "@repo/database";
import { DashboardKpis } from "../(authenticated)/components/dashboard-kpis";
import { buildDashboardData } from "../(authenticated)/lib/dashboard-data";

export const dynamic = "force-dynamic";

const Preview = async () => {
  const jobs = await database.auditJob.findMany({
    where: { email: "<사용자 이메일>" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return <DashboardKpis data={buildDashboardData(jobs)} />;
};
export default Preview;
```

## 3. 스크린샷 찍기

```bash
python3 scripts/화면검증/screenshot_ko.py "http://localhost:3001/ko/audit/<jobId>" 출력이름
python3 scripts/화면검증/screenshot.py    "http://localhost:3002/tmp-preview-check" 이름 390   # 모바일
```
- `screenshot_ko.py` = **한국어 강제**(`locale=ko-KR` + `x-vercel-ip-country: KR`).
  ⚠️ 이게 없으면 localhost는 IP 헤더가 없어 `Accept-Language` 폴백 → **영어로 뜬다.**
- 출력: 전체 높이(px)·본문 글자수·h1~h3 구조 + full-page PNG
- ⚠️ `networkidle` 은 **절대 쓰지 말 것** — dev 서버 HMR 소켓 때문에 영원히 안 온다.
  `domcontentloaded` + 고정 대기로 할 것(스크립트에 반영됨).

## 4. 눈으로 볼 때 특히 확인할 것 (이번 세션에 실제로 걸린 것들)

- **같은 값이 여러 곳에서 일치하나** — "AI 몇 곳이 아나"가 제목·KPI·진실거울에서 3개로 갈렸던 전례
- **한글 줄바꿈** — `keep-all` 없으면 "아/직", "있습/니다"로 음절이 쪼개진다
- **모바일 390px 오버플로** — 한국어 힌트가 길어 좁은 폭에서 넘친다(`min-w-0` 확인)
- **콘솔 에러 0** — 단 `Clerk: Failed to load Clerk JS`는 headless 환경의 외부 CDN 차단이라 무관
- 🔬 **스크린샷 눈대중을 단정하지 말 것** — 이번에 "선이 절반에서 끊긴다"고 판단했으나
  SVG path 좌표를 재보니 **전폭 정상**이었다(평평한 구간이 배경과 대비가 낮아 안 보인 것).
  의심되면 `page.locator("path.recharts-curve").get_attribute("d")` 로 좌표를 직접 읽어라.
