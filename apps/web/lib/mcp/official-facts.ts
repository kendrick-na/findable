// 공식 사실·AI 크롤러 점검 — AI 엔진에 질의하지 않는다(원가 0). 공개 페이지만 읽는다.
//
// 보안: 사설 주소 차단(`assertPublicUrl`)을 **리다이렉트마다** 다시 건다(SSRF).
// 읽는 양·시간 상한을 둔다(응답 512KB, 리다이렉트 3회, **점검 전체 8초 deadline 하나**).
// deadline 은 점검 시작 때 한 번 만들고 4개 경로·모든 리다이렉트 단계·DNS·TLS·헤더·본문 읽기가 함께 쓴다(단계마다 새 시간 없음).
// 기본 fetchImpl 은 연결 주소 고정(DNS 핀) fetch(`pinned-fetch.ts`) — 검사한 IP 로만 연결해 DNS 재바인딩 창을 닫는다.
// 시험·호출자는 fetchImpl 을 주입해 바꿀 수 있다(주입 구조 유지).

import {
  assertPublicUrl,
  normalizePublicUrl,
} from "@repo/audit/public-url-security";

import { FACTS_LIMITS_KO } from "./messages";
import { pinnedFetch, untilAborted } from "./pinned-fetch";

const MAX_BYTES = 512 * 1024;
const DEADLINE_MS = 8000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "FindableBot/1.0 (+https://findable.co.kr)";

const LINE_BREAK_RE = /\r?\n/;
const HTML_START_RE = /^\s*<(!doctype|html)/i;
const SITEMAP_RE = /<(urlset|sitemapindex)/i;
const JSON_LD_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** 주요 AI 크롤러 — robots.txt 에서 막혔는지 본다. */
export const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
] as const;

export interface FactItem {
  detail: string;
  key: "llms_txt" | "robots_ai_crawlers" | "json_ld" | "sitemap";
  status: string;
  [extra: string]: unknown;
}

export interface OfficialFactsResult {
  checked_at: string;
  checked_url: string;
  items: FactItem[];
  limits_ko: string;
  summary_ko: string;
}

type Fetched =
  | { ok: true; status: number; text: string }
  | { ok: false; reason: "timeout" | "network" | "blocked" };

export type FetchLike = typeof fetch;

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(Buffer.from(value));
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks).subarray(0, MAX_BYTES)
  );
}

function failureReason(error: unknown): "timeout" | "network" {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError"
    ? "timeout"
    : "network";
}

function nextRedirectTarget(current: URL, location: string): URL | null {
  try {
    return normalizePublicUrl(new URL(location, current).toString());
  } catch {
    return null;
  }
}

/**
 * 읽지 않을 본문은 바로 버린다(404·500·3xx 등). 버리지 않으면 요청별 연결(Agent·소켓)과 deadline 감시가
 * 본문이 끝나거나 deadline 이 올 때까지 남는다(느린·끝나지 않는 본문이면 deadline 까지 누수).
 */
function discardBody(response: Response): void {
  // 기다리지 않는다: cancel 은 호출 즉시 정리(소켓·Agent 닫기·감시 해제)를 시작하고,
  // 복제(tee)된 본문은 모든 갈래가 취소될 때까지 Promise 가 끝나지 않을 수 있다.
  response.body?.cancel().catch(() => undefined);
}

/** 리다이렉트가 아닌 응답: 본문을 상한까지 읽는다. 읽다 deadline 이 지나거나 끊기면 「확인 불가」(점검 전체를 깨뜨리지 않는다). */
async function finalResult(response: Response): Promise<Fetched> {
  if (!response.ok) {
    discardBody(response);
    return { ok: true, status: response.status, text: "" };
  }
  try {
    const text = await readLimited(response);
    return { ok: true, status: response.status, text };
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
}

async function safeGet(
  startUrl: URL,
  fetchImpl: FetchLike,
  deadline: AbortSignal
): Promise<Fetched> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      await untilAborted(assertPublicUrl(current), deadline);
    } catch (error) {
      return deadline.aborted
        ? { ok: false, reason: failureReason(error) }
        : { ok: false, reason: "blocked" };
    }
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        redirect: "manual",
        signal: deadline,
      });
    } catch (error) {
      return { ok: false, reason: failureReason(error) };
    }
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (!isRedirect) {
      return await finalResult(response);
    }
    // 3xx 본문은 쓰지 않는다 — 다음 단계로 가기 전에(또는 끝내기 전에) 연결을 닫는다.
    discardBody(response);
    if (!location) {
      return { ok: true, status: response.status, text: "" };
    }
    const target = nextRedirectTarget(current, location);
    if (!target) {
      return { ok: false, reason: "blocked" };
    }
    current = target;
  }
  return { ok: false, reason: "network" };
}

interface RobotsGroup {
  agents: string[];
  disallowAll: boolean;
}

function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(LINE_BREAK_RE)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    const idx = line.indexOf(":");
    if (idx < 0) {
      continue;
    }
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!(current && lastWasAgent)) {
        current = { agents: [], disallowAll: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "disallow" && value === "/" && current) {
      current.disallowAll = true;
    }
  }
  return groups;
}

/** robots.txt 에서 AI 크롤러별 전체 차단(`Disallow: /`) 여부를 판정한다. 단순 파서(그룹 단위). */
export function blockedAiCrawlers(robotsTxt: string): string[] {
  const groups = parseRobotsGroups(robotsTxt);
  const wildcardBlocked = groups.some(
    (g) => g.disallowAll && g.agents.includes("*")
  );
  return AI_CRAWLERS.filter((crawler) => {
    const name = crawler.toLowerCase();
    const specific = groups.filter((g) => g.agents.includes(name));
    return specific.length > 0
      ? specific.some((g) => g.disallowAll)
      : wildcardBlocked;
  });
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) {
      collectTypes(n, out);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  const t = record["@type"];
  const types = Array.isArray(t) ? t : [t];
  for (const x of types) {
    if (typeof x === "string") {
      out.add(x);
    }
  }
  for (const v of Object.values(record)) {
    collectTypes(v, out);
  }
}

/** HTML 안의 JSON-LD(`application/ld+json`)에서 @type 목록을 뽑는다. */
export function jsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  for (const match of html.matchAll(JSON_LD_RE)) {
    try {
      collectTypes(JSON.parse(match[1] ?? ""), types);
    } catch {
      // 깨진 JSON-LD 는 "없음"으로 취급한다.
    }
  }
  return [...types];
}

function llmsItem(llms: Fetched): FactItem {
  if (!llms.ok) {
    return {
      key: "llms_txt",
      status: "error",
      detail: "llms.txt 를 확인하지 못했습니다(응답 없음).",
    };
  }
  // 소프트 404(HTML 오류 페이지)를 llms.txt 로 오인하지 않는다.
  const real =
    llms.status === 200 && llms.text.trim() && !HTML_START_RE.test(llms.text);
  return real
    ? { key: "llms_txt", status: "found", detail: "llms.txt 가 있습니다." }
    : {
        key: "llms_txt",
        status: "missing",
        detail: "llms.txt 를 찾지 못했습니다.",
      };
}

function robotsStatus(blockedCount: number): string {
  if (blockedCount === AI_CRAWLERS.length) {
    return "blocked";
  }
  return blockedCount > 0 ? "partially_blocked" : "allowed";
}

function robotsItem(robots: Fetched): FactItem {
  if (robots.ok && robots.status === 200 && robots.text.trim()) {
    const blocked = blockedAiCrawlers(robots.text);
    return {
      key: "robots_ai_crawlers",
      status: robotsStatus(blocked.length),
      blocked_agents: blocked,
      detail: blocked.length
        ? `robots.txt 에서 AI 크롤러 ${blocked.length}종을 막고 있습니다.`
        : "robots.txt 가 주요 AI 크롤러를 막지 않습니다.",
    };
  }
  if (robots.ok && (robots.status === 404 || robots.status === 410)) {
    return {
      key: "robots_ai_crawlers",
      status: "allowed",
      blocked_agents: [],
      detail: "robots.txt 가 없어 AI 크롤러를 막지 않습니다.",
    };
  }
  // 모르면 unknown — 막혔다고 단정하지 않는다.
  return {
    key: "robots_ai_crawlers",
    status: "unknown",
    blocked_agents: [],
    detail: "robots.txt 를 확인하지 못했습니다.",
  };
}

function jsonLdItem(home: Fetched): FactItem {
  if (!(home.ok && home.status === 200)) {
    return {
      key: "json_ld",
      status: "error",
      types: [],
      detail: "첫 화면을 확인하지 못했습니다.",
    };
  }
  const types = jsonLdTypes(home.text);
  return {
    key: "json_ld",
    status: types.length ? "found" : "missing",
    types,
    detail: types.length
      ? `첫 화면에 구조화 데이터(${types.slice(0, 5).join(", ")})가 있습니다.`
      : "첫 화면에 구조화 데이터(JSON-LD)가 없습니다.",
  };
}

function sitemapItem(sitemap: Fetched): FactItem {
  if (!sitemap.ok) {
    return {
      key: "sitemap",
      status: "error",
      detail: "sitemap.xml 을 확인하지 못했습니다.",
    };
  }
  return sitemap.status === 200 && SITEMAP_RE.test(sitemap.text)
    ? { key: "sitemap", status: "found", detail: "sitemap.xml 이 있습니다." }
    : {
        key: "sitemap",
        status: "missing",
        detail: "sitemap.xml 을 찾지 못했습니다.",
      };
}

export async function checkOfficialFacts(
  rawUrl: string,
  fetchImpl: FetchLike = pinnedFetch,
  now: () => Date = () => new Date(),
  deadlineMs: number = DEADLINE_MS
): Promise<OfficialFactsResult> {
  // 입력 검증 오류(URL_*)는 호출자가 mapUrlError 로 변환한다.
  const base = normalizePublicUrl(rawUrl);
  // 점검 전체에 하나의 deadline — 아래 모든 단계가 이 signal 을 같이 쓴다.
  const deadline = AbortSignal.timeout(deadlineMs);
  try {
    await untilAborted(assertPublicUrl(base), deadline);
  } catch (error) {
    // 첫 주소 확인이 deadline 안에 끝나지 않으면 DNS 실패로 본다(그 밖의 URL_* 오류는 그대로).
    throw deadline.aborted ? new Error("URL_DNS") : error;
  }
  const origin = base.origin;

  const [home, llms, robots, sitemap] = await Promise.all([
    safeGet(new URL("/", origin), fetchImpl, deadline),
    safeGet(new URL("/llms.txt", origin), fetchImpl, deadline),
    safeGet(new URL("/robots.txt", origin), fetchImpl, deadline),
    safeGet(new URL("/sitemap.xml", origin), fetchImpl, deadline),
  ]);

  const items = [
    llmsItem(llms),
    robotsItem(robots),
    jsonLdItem(home),
    sitemapItem(sitemap),
  ];
  const good = items.filter(
    (i) => i.status === "found" || i.status === "allowed"
  ).length;
  return {
    checked_url: origin,
    checked_at: now().toISOString(),
    items,
    summary_ko: `4개 항목 중 ${good}개가 양호합니다. 확인하지 못한 항목은 '없음'이 아니라 '확인 불가'로 표시했습니다.`,
    limits_ko: FACTS_LIMITS_KO,
  };
}
