/*
 * 스토리를 **실제로 렌더해서 스크린샷을 찍는다** — 배포 없이 눈으로 보는 자리.
 *
 * 🔴 이 저장소 규율: "빌드 통과"는 검증이 아니다. 화면은 **눈으로 봐야** 한다
 *   (뮤테이션 23종 통과했는데 스샷 찍자 버그 3건 나온 이력).
 * 🔴 모바일(390)·PC(1440) **두 폭 모두** 찍는다(모바일에서 막대가 0px 로 찌그러진 사고 2회).
 *
 * 사용:
 *   npx storybook build --quiet          # storybook-static 생성
 *   node scripts/shoot-stories.mjs       # 정적 파일을 직접 열어 촬영
 */

import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/*
 * 🔴 `playwright-core` 를 쓴다 — `@playwright/test` 가 아니다.
 *   `@playwright/test`(와 `@clerk/testing`)는 **Next 의 optional peer** 라,
 *   설치하면 pnpm 이 `next@16.1.6(...@playwright+test...)` 라는 **두 번째 복사본**을 만든다.
 *   그러면 `packages/internationalization` 과 `apps/web` 이 서로 다른 `NextRequest`
 *   타입을 보게 돼 **web tsc 가 깨진다**(실측: TS2322). 같은 뿌리로
 *   `ops-alert.test.ts` 4건도 깨졌다(sentry 복사본 분열 → vi.mock 빗나감).
 *   → 브라우저 구동만 필요하므로 peer 관계가 없는 `playwright-core` 로 충분하다.
 */
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const staticDir = join(root, "storybook-static");
const outDir = join(root, "screenshots");

if (!existsSync(join(staticDir, "index.json"))) {
  console.error(
    "storybook-static/index.json 이 없다. 먼저 `npx storybook build`."
  );
  process.exit(1);
}

const index = JSON.parse(readFileSync(join(staticDir, "index.json"), "utf8"));
const stories = Object.values(index.entries ?? {}).filter(
  (e) => e.type === "story"
);

if (stories.length === 0) {
  console.error("스토리가 0개다.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

/*
 * 🔴 `file://` 로 열면 **화면이 통째로 빈다.** 크롬이 CORS 로 스크립트를 전부 막는다
 *   (`Cross origin requests are only supported for protocol schemes: ... http, https`).
 *   ⚠️ 그런데 **스크린샷은 정상적으로 찍힌다** — 새하얀 PNG 가. 파일 개수만 세면
 *   "촬영 14장 성공" 으로 보인다. 실제로 이 함정에 한 번 빠졌고, PNG 를 **눈으로 열어보고서야**
 *   알았다. → 정적 서버를 띄워 **http 로** 연다.
 */
/** 상위 경로 탈출(`../`)을 걷어낸다 — 정적 서버가 저장소 밖 파일을 내주지 않게. */
const TRAVERSAL_RE = /^(\.\.[/\\])+/;

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const target = join(staticDir, normalize(path).replace(TRAVERSAL_RE, ""));
  const file =
    existsSync(target) && statSync(target).isDirectory()
      ? join(target, "index.html")
      : target;
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});

await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "pc", width: 1440, height: 900 },
];

const browser = await chromium.launch();
let shot = 0;
const failures = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  // 콘솔 에러는 화면이 멀쩡해 보여도 잡아야 한다.
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  for (const story of stories) {
    errors.length = 0;
    const url = `${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // 렌더 완료 신호: #storybook-root 에 자식이 생길 때까지.
    let rendered = true;
    await page
      .waitForFunction(
        () =>
          (document.querySelector("#storybook-root")?.childElementCount ?? 0) >
          0,
        { timeout: 15_000 }
      )
      .catch(() => {
        rendered = false;
        failures.push(`${story.id} (${vp.name}) 렌더 안 됨`);
      });

    /*
     * 🔴 **빈 화면 가드.** 렌더가 안 돼도 스크린샷은 찍히고 파일 개수는 늘어난다
     *   → "성공" 처럼 보인다. 글자 수로 실제 내용이 있는지 확인한다.
     *   (이 저장소 규율: 통과 신호를 믿지 말 것.)
     */
    const textLen = await page.evaluate(
      () =>
        (document.querySelector("#storybook-root")?.innerText ?? "").trim()
          .length
    );
    if (rendered && textLen === 0) {
      failures.push(`${story.id} (${vp.name}) 🔴 빈 화면(글자 0자)`);
    }

    const file = join(outDir, `${story.id}__${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shot++;
    if (errors.length > 0) {
      failures.push(`${story.id} (${vp.name}) 콘솔에러: ${errors[0]}`);
    }
  }
  await ctx.close();
}

await browser.close();
server.close();

console.log(`촬영 ${shot}장 → ${outDir}`);
if (failures.length > 0) {
  console.error(`\n🔴 문제 ${failures.length}건:`);
  for (const f of failures) {
    console.error("  -", f);
  }
  process.exit(1);
}
console.log("렌더 실패·콘솔에러 0건");
