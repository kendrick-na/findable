import "server-only";

import { inspectCrux } from "./crux";
import { evaluateSiteReadiness } from "./evaluate";
import { buildFindings, evaluateCrawledPage } from "./page-evaluate";
import { applyCruxFieldData, inspectPageSpeed } from "./pagespeed";
import { assertPublicUrl, normalizeTargetUrl } from "./security";
import type { SiteReadinessReport } from "./types";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_CRAWL_PAGES = 10;
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot"];
const USER_AGENT =
  "FindableReadinessBot/1.0 (+https://www.findable.co.kr/ko/contact)";
const LINE_RE = /\r?\n/;
const COMMENT_RE = /#.*$/;
const SITEMAP_DIRECTIVE_RE = /^sitemap\s*:/i;
const SITEMAP_XML_RE = /<(urlset|sitemapindex)\b/i;
const SITEMAP_INDEX_RE = /<sitemapindex\b/i;
const ROBOTS_SPECIAL_RE = /[.+?^${}()|[\]\\]/g;
const TRAILING_SLASH_RE = /\/$/;

interface PublicFetchResult {
  finalUrl: URL;
  responseBytes: number;
  status: number;
  text: string;
  totalResponseMs: number;
  ttfbMs: number;
  xRobotsTag: string | null;
}

interface RobotsGroup {
  agents: string[];
  rules: Array<{ directive: "allow" | "disallow"; path: string }>;
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function requestPublicUrl(
  url: URL,
  requireHtml: boolean
): Promise<{ response: Response; ttfbMs: number }> {
  await assertPublicUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: requireHtml
          ? "text/html,application/xhtml+xml"
          : "text/plain,text/xml,application/xml,text/html;q=0.5",
        "user-agent": USER_AGENT,
      },
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      response,
      ttfbMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("FETCH_TIMEOUT");
    }
    throw new Error("FETCH_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPublicText(
  initialUrl: URL,
  options: { requireHtml?: boolean } = {}
): Promise<PublicFetchResult> {
  let current = new URL(initialUrl);
  const startedAt = performance.now();
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const { response, ttfbMs } = await requestPublicUrl(
      current,
      options.requireHtml ?? false
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error("REDIRECT_FAILED");
      }
      current = new URL(location, current);
      continue;
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (options.requireHtml && !contentType.includes("text/html")) {
      throw new Error("NOT_HTML");
    }
    const text = await readLimitedText(response);
    return {
      finalUrl: current,
      responseBytes: new TextEncoder().encode(text).byteLength,
      status: response.status,
      text,
      totalResponseMs: Math.round(performance.now() - startedAt),
      ttfbMs,
      xRobotsTag: response.headers.get("x-robots-tag"),
    };
  }
  throw new Error("REDIRECT_FAILED");
}

export function parseRobotsGroups(robots: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsGroup["rules"] = [];
  let hasRules = false;

  const flush = (): void => {
    if (agents.length > 0) {
      groups.push({ agents, rules });
    }
    agents = [];
    rules = [];
    hasRules = false;
  };

  for (const rawLine of robots.split(LINE_RE)) {
    const line = rawLine.replace(COMMENT_RE, "").trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (hasRules) {
        flush();
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if ((key === "allow" || key === "disallow") && agents.length > 0) {
      hasRules = true;
      rules.push({ directive: key, path: value });
    }
  }
  flush();
  return groups;
}

function robotsRuleMatches(rulePath: string, targetPath: string): boolean {
  if (!rulePath) {
    return false;
  }
  const anchored = rulePath.endsWith("$");
  const rawPattern = anchored ? rulePath.slice(0, -1) : rulePath;
  const pattern = rawPattern
    .replace(ROBOTS_SPECIAL_RE, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(targetPath);
}

export function isBotBlocked(
  robots: string,
  bot: string,
  targetPath = "/"
): boolean {
  const groups = parseRobotsGroups(robots);
  const normalized = bot.toLowerCase();
  const exact = groups.filter((group) => group.agents.includes(normalized));
  const applicable =
    exact.length > 0
      ? exact
      : groups.filter((group) => group.agents.includes("*"));
  const matchingRules = applicable.flatMap((group) =>
    group.rules.filter((rule) => robotsRuleMatches(rule.path, targetPath))
  );
  const longest = Math.max(
    0,
    ...matchingRules.map((rule) => rule.path.replaceAll("*", "").length)
  );
  const winningRules = matchingRules.filter(
    (rule) => rule.path.replaceAll("*", "").length === longest
  );
  if (winningRules.some((rule) => rule.directive === "allow")) {
    return false;
  }
  return winningRules.some((rule) => rule.directive === "disallow");
}

function sitemapUrls(robots: string, origin: string): URL[] {
  const urls = robots
    .split(LINE_RE)
    .map((line) => line.replace(COMMENT_RE, "").trim())
    .filter((line) => SITEMAP_DIRECTIVE_RE.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .flatMap((value) => {
      try {
        const url = new URL(value, origin);
        return url.origin === origin ? [url] : [];
      } catch {
        return [];
      }
    });
  return urls.length > 0 ? urls : [new URL("/sitemap.xml", origin)];
}

export function extractSitemapLocations(xml: string, origin: string): URL[] {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .flatMap((match) => {
      try {
        const url = new URL(match[1]?.trim() ?? "", origin);
        return url.origin === origin ? [url] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 1000);
}

async function inspectRobots(origin: string): Promise<{
  aiBotsEvidence: string;
  aiBotsStatus: "pass" | "warning" | "fail";
  robotsEvidence: string;
  robotsStatus: "pass" | "warning" | "fail";
  robotsText: string;
}> {
  try {
    const result = await fetchPublicText(new URL("/robots.txt", origin));
    if (result.status === 404) {
      return {
        robotsEvidence: "robots.txt not found · default access",
        robotsStatus: "warning",
        aiBotsEvidence: AI_BOTS.map((bot) => `${bot}=default`).join(" · "),
        aiBotsStatus: "warning",
        robotsText: "",
      };
    }
    if (result.status < 200 || result.status >= 300) {
      return {
        robotsEvidence: `HTTP ${result.status}`,
        robotsStatus: "fail",
        aiBotsEvidence: "not verified",
        aiBotsStatus: "warning",
        robotsText: "",
      };
    }
    const botStates = AI_BOTS.map((bot) => ({
      bot,
      blocked: isBotBlocked(result.text, bot),
    }));
    const blockedCount = botStates.filter((state) => state.blocked).length;
    let aiBotsStatus: "pass" | "warning" | "fail" = "warning";
    if (blockedCount === 0) {
      aiBotsStatus = "pass";
    } else if (blockedCount === botStates.length) {
      aiBotsStatus = "fail";
    }
    return {
      robotsEvidence: `HTTP ${result.status} · ${result.text.length} chars`,
      robotsStatus: "pass",
      aiBotsEvidence: botStates
        .map((state) => `${state.bot}=${state.blocked ? "blocked" : "allowed"}`)
        .join(" · "),
      aiBotsStatus,
      robotsText: result.text,
    };
  } catch {
    return {
      robotsEvidence: "request failed",
      robotsStatus: "warning",
      aiBotsEvidence: "not verified",
      aiBotsStatus: "warning",
      robotsText: "",
    };
  }
}

async function inspectSitemap(
  origin: string,
  robots: string
): Promise<{
  evidence: string;
  status: "pass" | "warning" | "fail";
  urls: URL[];
}> {
  const candidates = sitemapUrls(robots, origin).slice(0, 3);
  for (const candidate of candidates) {
    try {
      const result = await fetchPublicText(candidate);
      const isXml = SITEMAP_XML_RE.test(result.text);
      if (result.status >= 200 && result.status < 300 && isXml) {
        let urls = extractSitemapLocations(result.text, origin);
        if (SITEMAP_INDEX_RE.test(result.text)) {
          const nestedResults = await Promise.all(
            urls.slice(0, 3).map(async (nested) => {
              try {
                const child = await fetchPublicText(nested);
                return child.status >= 200 && child.status < 300
                  ? extractSitemapLocations(child.text, origin)
                  : [];
              } catch {
                return [];
              }
            })
          );
          urls = nestedResults.flat().slice(0, 1000);
        }
        return {
          evidence: `${result.finalUrl.toString()} · ${urls.length} URLs`,
          status: "pass",
          urls,
        };
      }
    } catch {
      // Try the next same-origin sitemap candidate.
    }
  }
  return { evidence: "not found or invalid", status: "warning", urls: [] };
}

async function inspectLlmsTxt(origin: string): Promise<string> {
  try {
    const result = await fetchPublicText(new URL("/llms.txt", origin));
    return result.status >= 200 && result.status < 300
      ? `found · ${result.text.length} chars · informational only`
      : `HTTP ${result.status} · informational only`;
  } catch {
    return "not verified · informational only";
  }
}

export async function scanSiteReadiness(
  rawUrl: string
): Promise<SiteReadinessReport> {
  const target = normalizeTargetUrl(rawUrl);
  const main = await fetchPublicText(target, { requireHtml: true });
  const origin = main.finalUrl.origin;
  const robots = await inspectRobots(origin);
  const [sitemap, llmsTxtEvidence, pageSpeedResult, crux] = await Promise.all([
    inspectSitemap(origin, robots.robotsText),
    inspectLlmsTxt(origin),
    inspectPageSpeed(main.finalUrl.toString()),
    inspectCrux(main.finalUrl.toString()),
  ]);
  const pageSpeed = applyCruxFieldData(pageSpeedResult, crux);

  const mainPage = evaluateCrawledPage({
    finalUrl: main.finalUrl.toString(),
    html: main.text,
    responseBytes: main.responseBytes,
    statusCode: main.status,
    totalResponseMs: main.totalResponseMs,
    ttfbMs: main.ttfbMs,
    url: target.toString(),
    xRobotsTag: main.xRobotsTag,
  });
  const mainComparable = main.finalUrl
    .toString()
    .replace(TRAILING_SLASH_RE, "");
  const discoveredTargets = [
    ...mainPage.internalLinks,
    ...sitemap.urls.map(String),
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value) => new URL(value))
    .filter(
      (url) => url.toString().replace(TRAILING_SLASH_RE, "") !== mainComparable
    );
  const crawlTargets = discoveredTargets.slice(0, MAX_CRAWL_PAGES - 1);
  const crawledPages = await Promise.all(
    crawlTargets.map(async (url) => {
      try {
        const result = await fetchPublicText(url, { requireHtml: true });
        return evaluateCrawledPage({
          finalUrl: result.finalUrl.toString(),
          html: result.text,
          responseBytes: result.responseBytes,
          statusCode: result.status,
          totalResponseMs: result.totalResponseMs,
          ttfbMs: result.ttfbMs,
          url: url.toString(),
          xRobotsTag: result.xRobotsTag,
        });
      } catch (error) {
        return evaluateCrawledPage({
          errorCode: error instanceof Error ? error.message : "FETCH_FAILED",
          finalUrl: url.toString(),
          html: "",
          responseBytes: 0,
          statusCode: 0,
          totalResponseMs: 0,
          ttfbMs: 0,
          url: url.toString(),
        });
      }
    })
  );
  const pages = [mainPage, ...crawledPages];

  const report = evaluateSiteReadiness({
    targetUrl: target.toString(),
    finalUrl: main.finalUrl.toString(),
    html: main.text,
    statusCode: main.status,
    robotsEvidence: robots.robotsEvidence,
    robotsStatus: robots.robotsStatus,
    aiBotsEvidence: robots.aiBotsEvidence,
    aiBotsStatus: robots.aiBotsStatus,
    sitemapEvidence: sitemap.evidence,
    sitemapStatus: sitemap.status,
    llmsTxtEvidence,
  });
  return {
    ...report,
    version: 3,
    performance: {
      pageSpeed,
      responseBytes: main.responseBytes,
      totalResponseMs: main.totalResponseMs,
      ttfbMs: main.ttfbMs,
    },
    crawl: {
      audited: pages.length,
      discovered: discoveredTargets.length + 1,
      limit: MAX_CRAWL_PAGES,
      pages,
    },
    findings: buildFindings(pages),
  };
}
