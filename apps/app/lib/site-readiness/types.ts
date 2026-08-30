export type ReadinessCategory = "access" | "crawl" | "structure" | "trust";

export type ReadinessStatus = "pass" | "warning" | "fail" | "info";

export type ReadinessSeverity = "critical" | "high" | "medium" | "low";

export type PerformanceRating =
  | "good"
  | "needs-improvement"
  | "poor"
  | "unavailable";

export type SiteFindingCode =
  | "non_2xx"
  | "noindex"
  | "canonical_missing"
  | "canonical_mismatch"
  | "schema_invalid"
  | "schema_required_missing"
  | "title_missing"
  | "h1_missing"
  | "broken_internal_link"
  | "thin_article_content"
  | "citation_sources_missing"
  | "author_signal_missing"
  | "slow_ttfb"
  | "slow_response";

export type SiteReadinessRunStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type SiteReadinessTrigger =
  | "onboarding"
  | "brand_create"
  | "domain_change"
  | "manual";

export type ReadinessCheckId =
  | "https"
  | "status"
  | "robots"
  | "aiBots"
  | "sitemap"
  | "title"
  | "description"
  | "h1"
  | "canonical"
  | "jsonLd"
  | "serverContent"
  | "semanticHtml"
  | "trustLinks"
  | "freshness"
  | "llmsTxt";

export interface ReadinessCheck {
  category: ReadinessCategory;
  evidence: string;
  id: ReadinessCheckId;
  status: ReadinessStatus;
}

export interface ReadinessCategorySummary {
  category: ReadinessCategory;
  fail: number;
  pass: number;
  total: number;
  warning: number;
}

export interface SiteReadinessReport {
  categories: ReadinessCategorySummary[];
  checkedAt: string;
  checks: ReadinessCheck[];
  crawl?: {
    audited: number;
    discovered: number;
    limit: number;
    pages: SiteReadinessPage[];
  };
  finalUrl: string;
  findings?: SiteReadinessFinding[];
  performance?: {
    pageSpeed?: PageSpeedMeasurement;
    responseBytes: number;
    totalResponseMs: number;
    ttfbMs: number;
  };
  summary: {
    fail: number;
    info: number;
    pass: number;
    warning: number;
  };
  targetUrl: string;
  version?: 2 | 3;
}

export interface PageSpeedOpportunity {
  displayValue: string | null;
  id: string;
  savingsMs: number | null;
  title: string;
}

export interface PageSpeedMeasurement {
  cls: PageSpeedMetric;
  errorCode: string | null;
  fieldDataPeriod?: { firstDate: string; lastDate: string } | null;
  fieldDataProvider?: "crux" | "pagespeed" | null;
  fieldDataScope: "url" | "origin" | null;
  inpMs: PageSpeedMetric;
  lcpMs: PageSpeedMetric;
  measuredAt: string | null;
  opportunities: PageSpeedOpportunity[];
  performanceScore: number | null;
  seoScore: number | null;
  strategy: "mobile";
}

export interface CruxMeasurement {
  cls: number | null;
  errorCode: string | null;
  fieldDataScope: "url" | "origin" | null;
  firstDate: string | null;
  inpMs: number | null;
  lastDate: string | null;
  lcpMs: number | null;
}

export interface PageSpeedMetric {
  rating: PerformanceRating;
  source: "field" | "lab" | null;
  value: number | null;
}

export interface SiteReadinessSchemaEvidence {
  blocks: number;
  invalidBlocks: number;
  missingRequired: string[];
  types: string[];
}

export interface SiteReadinessPage {
  canonical: string | null;
  canonicalMatches: boolean | null;
  contentSignals: {
    articleLike: boolean;
    hasAuthorSignal: boolean;
    hasPublishedDate: boolean;
    outboundSourceLinks: number;
    wordCount: number;
  };
  errorCode: string | null;
  finalUrl: string;
  h1Count: number;
  indexable: boolean;
  internalLinks: string[];
  noindex: boolean;
  responseBytes: number;
  schema: SiteReadinessSchemaEvidence;
  statusCode: number;
  title: string | null;
  totalResponseMs: number;
  ttfbMs: number;
  url: string;
}

export interface SiteReadinessFinding {
  affectedCount: number;
  code: SiteFindingCode;
  evidence: string;
  sampleUrls: string[];
  severity: ReadinessSeverity;
}

export type SiteReadinessActionState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "ok"; report: SiteReadinessReport };

export interface StoredSiteReadinessRun {
  errorCode: string | null;
  id: string;
  report: SiteReadinessReport | null;
  status: SiteReadinessRunStatus;
  targetUrl: string;
  trigger: SiteReadinessTrigger;
}
