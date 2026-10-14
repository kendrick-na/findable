import { isIP } from "node:net";
import { log } from "@repo/observability/log";
import { keys } from "./keys";
import { isVercelPreview } from "./preview-guard";
import {
  assertPublicUrl,
  isPrivateAddress,
  normalizePublicUrl,
} from "./public-url-security";

/**
 * 글자가 거의 없는 사이트(JS 로 그리는 SPA)를 브라우저로 그려 HTML 을 얻는다(2026-10-14).
 *
 * - 질문 제안용 사이트 읽기(`site-profile.ts`)가 일반 읽기로 글자를 못 얻었을 때만 부른다. 평소엔 호출되지 않는다.
 * - 이미 PDF 리포트가 쓰는 크롬(`pdf-generator.ts` 의 `getBrowser`: @sparticuz/chromium + puppeteer-core)을 그대로 쓴다 — 새 패키지 없음.
 * - **기본 off**(`SITE_RENDER_ENABLED=true` 일 때만). Vercel Preview 에서는 켜져 있어도 실행하지 않는다.
 * - 이미지·미디어·폰트는 받지 않고(속도·원가), 사설망·로컬 주소로 가는 요청은 차단한다.
 * - 실패·시간 초과는 null — 질문 제안을 막지 않는다.
 */

const RENDER_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1500;
const BLOCKED_RESOURCES = new Set(["image", "media", "font"]);
const USER_AGENT =
  "FindableMeasurementBot/1.0 (+https://www.findable.co.kr/ko/contact)";

export function isSiteRenderEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return keys().SITE_RENDER_ENABLED === true && !isVercelPreview(env);
}

/** 요청 주소가 사설망·로컬이면 true(브라우저가 내부망을 찌르지 못하게). */
export function isBlockedRequestUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return url.protocol !== "data:" && url.protocol !== "blob:";
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host.endsWith(".local") ||
      (isIP(host) !== 0 && isPrivateAddress(host))
    );
  } catch {
    return true;
  }
}

/** 사이트를 브라우저로 그린 뒤의 HTML. 꺼져 있거나 실패하면 null. */
export async function renderSiteHtml(domain: string): Promise<string | null> {
  if (!isSiteRenderEnabled()) {
    return null;
  }
  let browser: Awaited<
    ReturnType<typeof import("./pdf-generator")["getBrowser"]>
  > | null = null;
  try {
    const url = normalizePublicUrl(domain);
    await assertPublicUrl(url);
    const { getBrowser } = await import("./pdf-generator");
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (
        BLOCKED_RESOURCES.has(request.resourceType()) ||
        isBlockedRequestUrl(request.url())
      ) {
        request.abort().catch(() => undefined);
      } else {
        request.continue().catch(() => undefined);
      }
    });
    await page.goto(url.toString(), {
      timeout: RENDER_TIMEOUT_MS,
      waitUntil: "networkidle2",
    });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    return await page.content();
  } catch (error) {
    log.warn("audit.site_render.failed", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
