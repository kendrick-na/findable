import type {
  ReadinessCategory,
  ReadinessCategorySummary,
  ReadinessCheck,
  SiteReadinessReport,
} from "./types";

const TAG_RE = /<[^>]+>/g;
const SCRIPT_STYLE_RE = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const SPACE_RE = /\s+/g;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
const JSON_LD_RE =
  /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ENTITY_RE = /&(?:nbsp|amp|quot|#39|lt|gt);/gi;
const SEMANTIC_MAIN_RE = /<(main|article)\b/i;
const TRUST_LINK_RE =
  /(about|company|contact|privacy|terms|legal|소개|문의|개인정보|약관)/;

type ScoreStatus = "pass" | "warning" | "fail";

export interface HtmlEvaluationInput {
  aiBotsEvidence: string;
  aiBotsStatus: "pass" | "warning" | "fail";
  finalUrl: string;
  html: string;
  llmsTxtEvidence: string;
  robotsEvidence: string;
  robotsStatus: "pass" | "warning" | "fail";
  sitemapEvidence: string;
  sitemapStatus: "pass" | "warning" | "fail";
  statusCode: number;
  targetUrl: string;
}

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

function metaContent(html: string, key: string): string | null {
  for (const tag of tags(html, "meta")) {
    const marker = attribute(tag, "name") ?? attribute(tag, "property");
    if (marker?.toLowerCase() === key.toLowerCase()) {
      return attribute(tag, "content");
    }
  }
  return null;
}

function linkHref(html: string, rel: string): string | null {
  for (const tag of tags(html, "link")) {
    const relations =
      attribute(tag, "rel")?.toLowerCase().split(SPACE_RE) ?? [];
    if (relations.includes(rel.toLowerCase())) {
      return attribute(tag, "href");
    }
  }
  return null;
}

function plainText(value: string): string {
  return value
    .replace(COMMENT_RE, " ")
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(TAG_RE, " ")
    .replace(ENTITY_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

function tagText(html: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(
    html
  );
  return match ? plainText(match[1] ?? "") : "";
}

function jsonLdEvidence(html: string): {
  evidence: string;
  status: "pass" | "warning" | "fail";
} {
  const blocks = [...html.matchAll(JSON_LD_RE)].map((match) =>
    match[1]?.trim()
  );
  if (blocks.length === 0) {
    return { evidence: "0 blocks", status: "warning" };
  }

  const types = new Set<string>();
  let invalid = 0;
  const collectTypes = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectTypes(item);
      }
      return;
    }
    if (typeof value === "string") {
      types.add(value);
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    if ("@type" in record) {
      collectTypes(record["@type"]);
    }
    if ("@graph" in record) {
      collectTypes(record["@graph"]);
    }
  };

  for (const block of blocks) {
    try {
      collectTypes(JSON.parse(block ?? ""));
    } catch {
      invalid += 1;
    }
  }

  const evidence = `${blocks.length} blocks · ${types.size > 0 ? [...types].join(", ") : "type unknown"}${invalid > 0 ? ` · ${invalid} invalid` : ""}`;
  let status: ScoreStatus = "pass";
  if (invalid === blocks.length) {
    status = "fail";
  } else if (invalid > 0) {
    status = "warning";
  }
  return { evidence, status };
}

function titleStatus(length: number): ScoreStatus {
  if (length === 0) {
    return "fail";
  }
  return length <= 70 ? "pass" : "warning";
}

function descriptionStatus(length: number): ScoreStatus {
  if (length === 0) {
    return "fail";
  }
  return length >= 50 && length <= 180 ? "pass" : "warning";
}

function h1Status(count: number): ScoreStatus {
  if (count === 0) {
    return "fail";
  }
  return count === 1 ? "pass" : "warning";
}

function contentStatus(length: number): ScoreStatus {
  if (length >= 300) {
    return "pass";
  }
  return length >= 100 ? "warning" : "fail";
}

function summarize(checks: ReadinessCheck[]): {
  categories: ReadinessCategorySummary[];
  summary: SiteReadinessReport["summary"];
} {
  const scoreable = checks.filter((check) => check.status !== "info");
  const categories: ReadinessCategory[] = [
    "access",
    "crawl",
    "structure",
    "trust",
  ];
  return {
    categories: categories.map((category) => {
      const rows = scoreable.filter((check) => check.category === category);
      return {
        category,
        total: rows.length,
        pass: rows.filter((check) => check.status === "pass").length,
        warning: rows.filter((check) => check.status === "warning").length,
        fail: rows.filter((check) => check.status === "fail").length,
      };
    }),
    summary: {
      pass: checks.filter((check) => check.status === "pass").length,
      warning: checks.filter((check) => check.status === "warning").length,
      fail: checks.filter((check) => check.status === "fail").length,
      info: checks.filter((check) => check.status === "info").length,
    },
  };
}

export function evaluateSiteReadiness(
  input: HtmlEvaluationInput
): SiteReadinessReport {
  const title = tagText(input.html, "title");
  const description = metaContent(input.html, "description") ?? "";
  const h1s = [...input.html.matchAll(H1_RE)].map((match) =>
    plainText(match[1] ?? "")
  );
  const canonical = linkHref(input.html, "canonical");
  const jsonLd = jsonLdEvidence(input.html);
  const bodyText = plainText(input.html);
  const hasSemanticMain = SEMANTIC_MAIN_RE.test(input.html);
  const trustLinkCount = tags(input.html, "a").filter((tag) => {
    const href = attribute(tag, "href")?.toLowerCase() ?? "";
    return TRUST_LINK_RE.test(href);
  }).length;
  const modified =
    metaContent(input.html, "article:modified_time") ??
    metaContent(input.html, "last-modified") ??
    tags(input.html, "time")
      .map((tag) => attribute(tag, "datetime"))
      .find(Boolean) ??
    null;

  const checks: ReadinessCheck[] = [
    {
      id: "https",
      category: "access",
      status: new URL(input.finalUrl).protocol === "https:" ? "pass" : "fail",
      evidence: new URL(input.finalUrl).protocol.replace(":", "").toUpperCase(),
    },
    {
      id: "status",
      category: "access",
      status:
        input.statusCode >= 200 && input.statusCode < 300 ? "pass" : "fail",
      evidence: `HTTP ${input.statusCode}`,
    },
    {
      id: "robots",
      category: "crawl",
      status: input.robotsStatus,
      evidence: input.robotsEvidence,
    },
    {
      id: "aiBots",
      category: "crawl",
      status: input.aiBotsStatus,
      evidence: input.aiBotsEvidence,
    },
    {
      id: "sitemap",
      category: "crawl",
      status: input.sitemapStatus,
      evidence: input.sitemapEvidence,
    },
    {
      id: "title",
      category: "structure",
      status: titleStatus(title.length),
      evidence: title
        ? `${title.length} chars · ${title.slice(0, 100)}`
        : "missing",
    },
    {
      id: "description",
      category: "structure",
      status: descriptionStatus(description.length),
      evidence: description ? `${description.length} chars` : "missing",
    },
    {
      id: "h1",
      category: "structure",
      status: h1Status(h1s.length),
      evidence: `${h1s.length} H1${h1s[0] ? ` · ${h1s[0].slice(0, 100)}` : ""}`,
    },
    {
      id: "canonical",
      category: "structure",
      status: canonical ? "pass" : "warning",
      evidence: canonical ?? "missing",
    },
    {
      id: "jsonLd",
      category: "structure",
      status: jsonLd.status,
      evidence: jsonLd.evidence,
    },
    {
      id: "serverContent",
      category: "access",
      status: contentStatus(bodyText.length),
      evidence: `${bodyText.length} visible chars in server HTML`,
    },
    {
      id: "semanticHtml",
      category: "structure",
      status: hasSemanticMain ? "pass" : "warning",
      evidence: hasSemanticMain ? "main/article found" : "main/article missing",
    },
    {
      id: "trustLinks",
      category: "trust",
      status: trustLinkCount >= 2 ? "pass" : "warning",
      evidence: `${trustLinkCount} trust links`,
    },
    {
      id: "freshness",
      category: "trust",
      status: modified ? "pass" : "info",
      evidence: modified ?? "no machine-readable date",
    },
    {
      id: "llmsTxt",
      category: "crawl",
      status: "info",
      evidence: input.llmsTxtEvidence,
    },
  ];
  const totals = summarize(checks);
  return {
    targetUrl: input.targetUrl,
    finalUrl: input.finalUrl,
    checkedAt: new Date().toISOString(),
    checks,
    ...totals,
  };
}
