// 네이버 버튼을 눌렀을 때 실제 이동 경로를 추적한다.
// 판정: nid.naver.com 으로 가는가(정상) / 안 가고 바로 에러인가(원인)
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b
  .newContext({ viewport: { width: 1280, height: 900 } })
  .then((c) => c.newPage());

const hops = [];
p.on("framenavigated", (f) => {
  if (f === p.mainFrame()) {
    hops.push(f.url());
  }
});

await p.goto("https://app.findable.co.kr/sign-in", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await p.waitForTimeout(6000);

console.log("네이버 버튼 클릭...");
await p.locator('button:has-text("Naver")').first().click();
await p.waitForTimeout(12_000);

console.log("\n=== 이동 경로 ===");
for (const h of hops) {
  console.log(" →", h.length > 130 ? h.slice(0, 130) + "…" : h);
}
console.log("\n최종 URL:", p.url());
const naverReached = hops.some(
  (h) => h.includes("nid.naver.com") || h.includes("naver.com")
);
console.log(
  naverReached
    ? "✅ 네이버 인증 페이지에 도달함"
    : "🔴 **네이버에 가지도 않았다**"
);
const body = (
  await p
    .locator("body")
    .innerText()
    .catch(() => "")
).trim();
console.log("본문:", body.slice(0, 200).replace(/\n+/g, " | "));
await p.screenshot({ path: "_naver_flow.png", fullPage: true });
await b.close();
