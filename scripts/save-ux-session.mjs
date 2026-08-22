// 로그인 세션을 storageState 로 저장한다 — UI/UX 측정 도구가 로그인 뒤 화면을 재려면 필요.
//
// 🔴 왜 필요한가: `ui-ux-quality` 측정 4종은 로그인 벽을 넘지 못해 **대시보드가 계속
//   "검사된 적 없는 화면"** 으로 남아 있었다(세션N-28 에 처음 실측). 로그인 벽에 막힌
//   리다이렉트 페이지를 재고 "이상 없음"이라 보고할 위험도 있었다.
//
// 사용:
//   node scripts/save-ux-session.mjs                       # .env.local 의 계정으로 로그인
//   UX_STORAGE_STATE=<저장경로> node .../measure.mjs <URL>  # 저장된 세션으로 측정
//
// 🔒 비밀정보 규율:
//   · 자격증명은 `apps/app/.env.local`(git 제외) 또는 환경변수에서만 읽는다
//   · **비밀번호를 인자로 받지 않고, 어떤 값도 출력하지 않는다**(이메일은 마스킹)
//   · 저장 파일은 세션 쿠키를 담으므로 **저장소 밖**(/tmp)에 둔다
//   ⚠️ 이 스크립트는 `scripts/verify-app.py` 의 로그인 절차를 그대로 따른다
//      (Clerk 는 이메일 → 비밀번호 2단계 · 성공 판정은 **문구가 아니라 구조**로).

import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENV_FILE = path.join(ROOT, "apps/app/.env.local");
const OUT = process.env.UX_STORAGE_STATE || "/tmp/findable-ux-session.json";
const BASE = process.env.UX_BASE || "https://app.findable.co.kr";

function creds() {
  let email = process.env.FINDABLE_TEST_EMAIL || "";
  let pw = process.env.FINDABLE_TEST_PW || "";
  if (!(email && pw)) {
    try {
      for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
        const m = line.match(
          /^\s*(FINDABLE_TEST_EMAIL|FINDABLE_TEST_PW)\s*=\s*(.*)$/
        );
        if (!m) {
          continue;
        }
        const v = m[2].trim().replace(/^["']|["']$/g, "");
        if (m[1] === "FINDABLE_TEST_EMAIL") {
          email = email || v;
        } else {
          pw = pw || v;
        }
      }
    } catch {
      // .env.local 이 없으면 환경변수만 쓴다
    }
  }
  return { email, pw };
}

const mask = (e) => {
  const [id, dom] = e.split("@");
  return `${id.slice(0, 3)}***@${dom ?? ""}`;
};

const { email, pw } = creds();
if (!(email && pw)) {
  console.error(
    "🔴 검증 계정이 없다. apps/app/.env.local 의 FINDABLE_TEST_EMAIL / FINDABLE_TEST_PW 확인."
  );
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();

await page.goto(`${BASE}/sign-in`, {
  waitUntil: "networkidle",
  timeout: 120_000,
});
await page.fill('input[name="identifier"]', email);
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
if ((await page.locator('input[name="password"]').count()) > 0) {
  await page.fill('input[name="password"]', pw);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
}

// 🔴 성공 판정은 **구조**로 한다 — URL 은 리다이렉트가 늦어 오탐하고,
//   문구(`워크스페이스` 등)는 IA 개편 때 사라져 정상 배포를 실패로 만든 전례가 있다.
//
// ⚠️ 2026-08-14: 고정 대기 5초가 부족해 **정상 로그인을 실패로 판정**했다(오탐).
//   로그인은 멀쩡했고 앱 셸이 6~9초에 그려졌다. → 고정 대기 대신 **셸이 나타날 때까지 대기**.
//   (가드가 정당한 변경을 막은 4번째 사례 — 판정 기준이 아니라 **대기 방식**이 문제였다)
await page
  .locator("nav, aside, [data-sidebar]")
  .first()
  .waitFor({ state: "attached", timeout: 30_000 })
  .catch(() => {
    /* 없으면 아래 count 가 0 이라 실패로 떨어진다 */
  });

const shell = await page.locator("nav, aside, [data-sidebar]").count();
if (shell === 0) {
  await page.screenshot({ path: "/tmp/ux-session-login-failed.png" });
  console.error(
    "🔴 로그인 실패(앱 셸 없음). /tmp/ux-session-login-failed.png 확인"
  );
  await browser.close();
  process.exit(1);
}

await ctx.storageState({ path: OUT });
console.log(`✅ 세션 저장: ${OUT}  (${mask(email)})`);
console.log("   측정 예:");
console.log(
  `   UX_STORAGE_STATE=${OUT} node ~/.claude/skills/ui-ux-quality/scripts/measure.mjs ${BASE}/ both`
);
await browser.close();
