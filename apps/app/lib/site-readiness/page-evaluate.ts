import type {
  SiteReadinessFinding,
  SiteReadinessPage,
  SiteReadinessSchemaEvidence,
} from "./types";

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const H1_RE = /<h1\b[^>]*>/gi;
const JSON_LD_RE =
  /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TAG_RE = /<[^>]+>/g;
const SPACE_RE = /\s+/g;
const TRAILING_SLASH_RE = /\/$/;
const ARTICLE_PATH_RE =
  /\/(blog|insights?|articles?|news|guides?|resources?|posts?|contents?)(\/|$)/i;
const AUTHOR_SIGNAL_RE =
  /(rel=["']author|class=["'][^"']*(author|byline)|\b(author|writer|written by|저자|작성자)\b)/i;
const PUBLISHED_DATE_RE =
  /(datePublished|article:published_time|<time\b[^>]*datetime=)/i;

const REQUIRED_SCHEMA_FIELDS: Record<string, string[]> = {
  Article: ["headline", "author", "datePublished"],
  BlogPosting: ["headline", "author", "datePublished"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  LocalBusiness: ["name", "address"],
  NewsArticle: ["headline", "author", "datePublished"],
  Organization: ["name", "url"],
  Product: ["name", "offers"],
  WebSite: ["name", "url"],
};

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`,
    "i"
  );
  const match = pattern.exec(tag);
  return match?.[1]?.trim() || match?.[2]?.trim() || null;
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

function collectSchemaNodes(value: unknown, nodes: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSchemaNodes(item, nodes);
    }
    return;
  }
  if (!(value && typeof value === "object")) {
    return;
  }
  const record = value as Record<string, unknown>;
  if ("@type" in record) {
    nodes.push(record);
  }
  if ("@graph" in record) {
    collectSchemaNodes(record["@graph"], nodes);
  }
}

export function evaluateSchema(html: string): SiteReadinessSchemaEvidence {
  const blocks = [...html.matchAll(JSON_LD_RE)];
  const nodes: Record<string, unknown>[] = [];
  let invalidBlocks = 0;
  for (const block of blocks) {
    try {
      collectSchemaNodes(JSON.parse(block[1]?.trim() ?? ""), nodes);
    } catch {
      invalidBlocks += 1;
    }
  }

  const types = new Set<string>();
  const missingRequired = new Set<string>();
  for (const node of nodes) {
    inspectSchemaNode(node, types, missingRequired);
  }

  return {
    blocks: blocks.length,
    invalidBlocks,
    missingRequired: [...missingRequired],
    types: [...types],
  };
}

function inspectSchemaNode(
  node: Record<string, unknown>,
  types: Set<string>,
  missingRequired: Set<string>
) {
  const rawTypes = Array.isArray(node["@type"])
    ? node["@type"]
    : [node["@type"]];
  for (const rawType of rawTypes) {
    if (typeof rawType !== "string") {
      continue;
    }
    types.add(rawType);
    for (const field of REQUIRED_SCHEMA_FIELDS[rawType] ?? []) {
      if (!(field in node) || node[field] === "" || node[field] == null) {
        missingRequired.add(`${rawType}.${field}`);
      }
    }
  }
}

function metaRobotsNoindex(html: string): boolean {
  return tags(html, "meta").some((tag) => {
    const name = attribute(tag, "name")?.toLowerCase();
    const content = attribute(tag, "content")?.toLowerCase() ?? "";
    return (
      (name === "robots" || name === "googlebot") && content.includes("noindex")
    );
  });
}

function canonicalHref(html: string, pageUrl: string): string | null {
  const link = tags(html, "link").find((tag) =>
    (attribute(tag, "rel")?.toLowerCase().split(SPACE_RE) ?? []).includes(
      "canonical"
    )
  );
  const href = link ? attribute(link, "href") : null;
  if (!href) {
    return null;
  }
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return href;
  }
}

function internalLinks(html: string, pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  const links = new Set<string>();
  for (const tag of tags(html, "a")) {
    const href = attribute(tag, "href");
    if (!href) {
      continue;
    }
    try {
      const url = new URL(href, pageUrl);
      if (
        url.origin !== origin ||
        !["http:", "https:"].includes(url.protocol)
      ) {
        continue;
      }
      url.hash = "";
      links.add(url.toString());
      if (links.size >= 30) {
        break;
      }
    } catch {
      // Invalid hrefs are ignored; they cannot be fetched reliably.
    }
  }
  return [...links];
}

function contentSignals(
  html: string,
  pageUrl: string,
  schema: SiteReadinessSchemaEvidence
) {
  const articleTypes = new Set(["Article", "BlogPosting", "NewsArticle"]);
  const articleLike =
    schema.types.some((type) => articleTypes.has(type)) ||
    ARTICLE_PATH_RE.test(new URL(pageUrl).pathname);
  const text = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(TAG_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
  const origin = new URL(pageUrl).origin;
  const outboundSourceLinks = tags(html, "a").filter((tag) => {
    const href = attribute(tag, "href");
    if (!href) {
      return false;
    }
    try {
      return new URL(href, pageUrl).origin !== origin;
    } catch {
      return false;
    }
  }).length;
  return {
    articleLike,
    hasAuthorSignal: AUTHOR_SIGNAL_RE.test(html),
    hasPublishedDate: PUBLISHED_DATE_RE.test(html),
    outboundSourceLinks,
    wordCount: text ? text.split(SPACE_RE).length : 0,
  };
}

function normalizedComparableUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(TRAILING_SLASH_RE, "");
  }
  return url.toString();
}

export function evaluateCrawledPage(input: {
  errorCode?: string | null;
  finalUrl: string;
  html: string;
  responseBytes: number;
  statusCode: number;
  totalResponseMs: number;
  ttfbMs: number;
  url: string;
  xRobotsTag?: string | null;
}): SiteReadinessPage {
  const title =
    input.html.match(TITLE_RE)?.[1]?.replace(TAG_RE, " ").trim() || null;
  const canonical = canonicalHref(input.html, input.finalUrl);
  const noindex =
    metaRobotsNoindex(input.html) ||
    (input.xRobotsTag?.toLowerCase().includes("noindex") ?? false);
  const statusOk = input.statusCode >= 200 && input.statusCode < 300;
  const schema = evaluateSchema(input.html);
  let canonicalMatches: boolean | null = null;
  if (canonical) {
    try {
      canonicalMatches =
        normalizedComparableUrl(canonical) ===
        normalizedComparableUrl(input.finalUrl);
    } catch {
      canonicalMatches = false;
    }
  }

  return {
    canonical,
    canonicalMatches,
    contentSignals: contentSignals(input.html, input.finalUrl, schema),
    errorCode: input.errorCode ?? null,
    finalUrl: input.finalUrl,
    h1Count: input.html.match(H1_RE)?.length ?? 0,
    indexable: statusOk && !noindex,
    internalLinks: internalLinks(input.html, input.finalUrl),
    noindex,
    responseBytes: input.responseBytes,
    schema,
    statusCode: input.statusCode,
    title,
    totalResponseMs: input.totalResponseMs,
    ttfbMs: input.ttfbMs,
    url: input.url,
  };
}

const findingRules: Array<{
  code: SiteReadinessFinding["code"];
  evidence: (page: SiteReadinessPage) => string;
  matches: (page: SiteReadinessPage) => boolean;
  severity: SiteReadinessFinding["severity"];
}> = [
  {
    code: "non_2xx",
    severity: "critical",
    matches: (page) => page.statusCode < 200 || page.statusCode >= 300,
    evidence: (page) => `HTTP ${page.statusCode}`,
  },
  {
    code: "noindex",
    severity: "critical",
    matches: (page) => !page.errorCode && page.noindex,
    evidence: () => "meta/X-Robots-Tag noindex",
  },
  {
    code: "canonical_mismatch",
    severity: "high",
    matches: (page) => !page.errorCode && page.canonicalMatches === false,
    evidence: (page) => page.canonical ?? "invalid canonical",
  },
  {
    code: "schema_invalid",
    severity: "high",
    matches: (page) => !page.errorCode && page.schema.invalidBlocks > 0,
    evidence: (page) => `${page.schema.invalidBlocks} invalid JSON-LD block(s)`,
  },
  {
    code: "schema_required_missing",
    severity: "high",
    matches: (page) =>
      !page.errorCode && page.schema.missingRequired.length > 0,
    evidence: (page) => page.schema.missingRequired.join(", "),
  },
  {
    code: "title_missing",
    severity: "high",
    matches: (page) => !(page.errorCode || page.title),
    evidence: () => "title missing",
  },
  {
    code: "h1_missing",
    severity: "medium",
    matches: (page) => !page.errorCode && page.h1Count === 0,
    evidence: () => "H1 missing",
  },
  {
    code: "canonical_missing",
    severity: "medium",
    matches: (page) => !(page.errorCode || page.canonical),
    evidence: () => "canonical missing",
  },
  {
    code: "slow_ttfb",
    severity: "medium",
    matches: (page) => !page.errorCode && page.ttfbMs > 800,
    evidence: (page) => `TTFB ${page.ttfbMs}ms`,
  },
  {
    code: "slow_response",
    severity: "low",
    matches: (page) => !page.errorCode && page.totalResponseMs > 2500,
    evidence: (page) => `total ${page.totalResponseMs}ms`,
  },
  {
    code: "thin_article_content",
    severity: "medium",
    matches: (page) =>
      !page.errorCode &&
      page.contentSignals.articleLike &&
      page.contentSignals.wordCount < 500,
    evidence: (page) => `${page.contentSignals.wordCount} words`,
  },
  {
    code: "citation_sources_missing",
    severity: "medium",
    matches: (page) =>
      !page.errorCode &&
      page.contentSignals.articleLike &&
      page.contentSignals.outboundSourceLinks === 0,
    evidence: () => "0 outbound evidence links",
  },
  {
    code: "author_signal_missing",
    severity: "medium",
    matches: (page) =>
      !page.errorCode &&
      page.contentSignals.articleLike &&
      !page.contentSignals.hasAuthorSignal,
    evidence: (page) =>
      page.contentSignals.hasPublishedDate
        ? "published date found · author missing"
        : "author and published date missing",
  },
];

export function buildFindings(
  pages: SiteReadinessPage[]
): SiteReadinessFinding[] {
  const findings = findingRules.flatMap((rule) => {
    const affected = pages.filter(rule.matches);
    if (affected.length === 0) {
      return [];
    }
    return [
      {
        affectedCount: affected.length,
        code: rule.code,
        evidence: rule.evidence(affected[0] as SiteReadinessPage),
        sampleUrls: affected.slice(0, 3).map((page) => page.finalUrl),
        severity: rule.severity,
      },
    ];
  });
  const failedUrls = new Set(
    pages
      .filter((page) => page.statusCode < 200 || page.statusCode >= 300)
      .map((page) => normalizedComparableUrl(page.url))
  );
  const brokenLinks = pages.flatMap((page) =>
    page.internalLinks.filter((link) =>
      failedUrls.has(normalizedComparableUrl(link))
    )
  );
  if (brokenLinks.length > 0) {
    findings.push({
      affectedCount: new Set(brokenLinks).size,
      code: "broken_internal_link",
      evidence: "audited internal target returned an error",
      sampleUrls: [...new Set(brokenLinks)].slice(0, 3),
      severity: "high",
    });
  }
  return findings;
}
