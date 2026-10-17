// 공식 사실·AI 크롤러 점검 — AI 엔진에 질의하지 않는다(원가 0). 공개 페이지만 읽는다.
//
// 보안: 사설 주소 차단(`assertPublicUrl`)을 **리다이렉트마다** 다시 건다(SSRF).
// 읽는 양·시간 상한을 둔다(응답 512KB, 요청당 5초, 리다이렉트 3회).

import {
  assertPublicUrl,
  normalizePublicUrl,
} from "@repo/audit/public-url-security";

import { FACTS_LIMITS_KO } from "./messages";

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "FindableBot/1.0 (+https://findable.co.kr)";

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

export type FactStatus = "found" | "missing" | "error";

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
  | { ok: true; status: number; text: string; finalUrl: string }
  | { ok: false; reason: "timeout" | "network" | "blocked" };

export type FetchLike = typeof fetch;

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES)
  );
}

async function safeGet(startUrl: URL, fetchImpl: FetchLike): Promise<Fetched> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      await assertPublicUrl(current);
    } catch {
      return { ok: false, reason: "blocked" };
    }
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return {
        ok: false,
        reason:
          name === "TimeoutError" || name === "AbortError"
            ? "timeout"
            : "network",
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          ok: true,
          status: response.status,
          text: "",
          finalUrl: current.toString(),
        };
      }
      try {
        current = normalizePublicUrl(new URL(location, current).toString());
      } catch {
        return { ok: false, reason: "blocked" };
      }
      continue;
    }
    const text = response.ok ? await readLimited(response) : "";
    return {
      ok: true,
      status: response.status,
      text,
      finalUrl: current.toString(),
    };
  }
  return { ok: false, reason: "network" };
}

/** robots.txt 에서 AI 크롤러별 전체 차단(`Disallow: /`) 여부를 판정한다. 단순 파서(그룹 단위). */
export function blockedAiCrawlers(robotsTxt: string): string[] {
  const groups: Array<{ agents: string[]; disallowAll: boolean }> = [];
  let current: { agents: string[]; disallowAll: boolean } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) {
      continue;
    }
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
    } else {
      lastWasAgent = false;
      if (field === "disallow" && value === "/" && current) {
        current.disallowAll = true;
      }
    }
  }
  const blocked = new Set<string>();
  const wildcardBlocked = groups.some(
    (g) => g.disallowAll && g.agents.includes("*")
  );
  for (const crawler of AI_CRAWLERS) {
    const name = crawler.toLowerCase();
    const specific = groups.filter((g) => g.agents.includes(name));
    if (specific.length > 0) {
      if (specific.some((g) => g.disallowAll)) {
        blocked.add(crawler);
      }
    } else if (wildcardBlocked) {
      blocked.add(crawler);
    }
  }
  return [...blocked];
}

/** HTML 안의 JSON-LD(`application/ld+json`)에서 @type 목록을 뽑는다. */
export function jsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const n of node) {
            walk(n);
          }
        } else if (node && typeof node === "object") {
          const t = (node as Record<string, unknown>)["@type"];
          if (typeof t === "string") {
            types.add(t);
          } else if (Array.isArray(t)) {
            for (const x of t) {
              if (typeof x === "string") {
                types.add(x);
              }
            }
          }
          for (const v of Object.values(node as Record<string, unknown>)) {
            walk(v);
          }
        }
      };
      walk(JSON.parse(match[1] ?? ""));
    } catch {
      // 깨진 JSON-LD 는 "없음"으로 취급한다.
    }
  }
  return [...types];
}

export async function checkOfficialFacts(
  rawUrl: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date()
): Promise<OfficialFactsResult> {
  // 입력 검증 오류(URL_*)는 호출자가 mapUrlError 로 변환한다.
  const base = normalizePublicUrl(rawUrl);
  await assertPublicUrl(base);
  const origin = base.origin;

  const [home, llms, robots, sitemap] = await Promise.all([
    safeGet(new URL("/", origin), fetchImpl),
    safeGet(new URL("/llms.txt", origin), fetchImpl),
    safeGet(new URL("/robots.txt", origin), fetchImpl),
    safeGet(new URL("/sitemap.xml", origin), fetchImpl),
  ]);

  const items: FactItem[] = [];

  // llms.txt — 200 이고 본문이 있어야 "있음". HTML 오류 페이지(소프트 404)는 제외.
  if (
    llms.ok &&
    llms.status === 200 &&
    llms.text.trim() &&
    !/^\s*<(!doctype|html)/i.test(llms.text)
  ) {
    items.push({
      key: "llms_txt",
      status: "found",
      detail: "llms.txt 가 있습니다.",
    });
  } else if (llms.ok) {
    items.push({
      key: "llms_txt",
      status: "missing",
      detail: "llms.txt 를 찾지 못했습니다.",
    });
  } else {
    items.push({
      key: "llms_txt",
      status: "error",
      detail: "llms.txt 를 확인하지 못했습니다(응답 없음).",
    });
  }

  // robots.txt — 모르면 unknown(막혔다고 단정하지 않는다).
  if (robots.ok && robots.status === 200 && robots.text.trim()) {
    const blocked = blockedAiCrawlers(robots.text);
    let status = "allowed";
    if (blocked.length === AI_CRAWLERS.length) {
      status = "blocked";
    } else if (blocked.length > 0) {
      status = "partially_blocked";
    }
    items.push({
      key: "robots_ai_crawlers",
      status,
      blocked_agents: blocked,
      detail: blocked.length
        ? `robots.txt 에서 AI 크롤러 ${blocked.length}종을 막고 있습니다.`
        : "robots.txt 가 주요 AI 크롤러를 막지 않습니다.",
    });
  } else if (robots.ok && (robots.status === 404 || robots.status === 410)) {
    items.push({
      key: "robots_ai_crawlers",
      status: "allowed",
      blocked_agents: [],
      detail: "robots.txt 가 없어 AI 크롤러를 막지 않습니다.",
    });
  } else {
    items.push({
      key: "robots_ai_crawlers",
      status: "unknown",
      blocked_agents: [],
      detail: "robots.txt 를 확인하지 못했습니다.",
    });
  }

  // JSON-LD — 첫 화면 HTML 기준.
  if (home.ok && home.status === 200) {
    const types = jsonLdTypes(home.text);
    items.push({
      key: "json_ld",
      status: types.length ? "found" : "missing",
      types,
      detail: types.length
        ? `첫 화면에 구조화 데이터(${types.slice(0, 5).join(", ")})가 있습니다.`
        : "첫 화면에 구조화 데이터(JSON-LD)가 없습니다.",
    });
  } else {
    items.push({
      key: "json_ld",
      status: "error",
      types: [],
      detail: "첫 화면을 확인하지 못했습니다.",
    });
  }

  // sitemap.xml
  if (
    sitemap.ok &&
    sitemap.status === 200 &&
    /<(urlset|sitemapindex)/i.test(sitemap.text)
  ) {
    items.push({
      key: "sitemap",
      status: "found",
      detail: "sitemap.xml 이 있습니다.",
    });
  } else if (sitemap.ok) {
    items.push({
      key: "sitemap",
      status: "missing",
      detail: "sitemap.xml 을 찾지 못했습니다.",
    });
  } else {
    items.push({
      key: "sitemap",
      status: "error",
      detail: "sitemap.xml 을 확인하지 못했습니다.",
    });
  }

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
