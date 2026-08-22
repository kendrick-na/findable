// 네이버 콜백 후 Clerk 가 내려주는 **오류 코드**를 잡는다.
// 문구("email address is taken")는 표시용이고, 코드가 원인을 가른다:
//   oauth_identification_claimed → 연결 거부(검증 미인정)
//   form_identifier_exists       → 새 가입 시도 중 중복
import { chromium } from "playwright";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

const api = [];
p.on("response", async (r) => {
  const u = r.url();
  if (!u.includes("clerk.findable.co.kr/v1/")) {
    return;
  }
  if (r.status() < 400) {
    return;
  }
  let body = "";
  try {
    body = (await r.text()).slice(0, 700);
  } catch {}
  api.push({ status: r.status(), url: u.replace(/\?.*/, "").slice(-70), body });
});

await p.goto("https://app.findable.co.kr/sign-in", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await p.waitForTimeout(5000);
await p.locator('button:has-text("Naver")').first().click();
console.log("네이버 페이지 도달 — 여기서 수동 로그인 없이는 콜백을 못 탄다.");
await p.waitForTimeout(8000);
console.log("현재:", p.url().slice(0, 90));
console.log("\n=== Clerk API 오류 응답 ===");
console.log(
  api.length ? JSON.stringify(api, null, 2) : "(콜백 전이라 없음 — 예상됨)"
);
await b.close();
