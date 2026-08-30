import "server-only";

import type {
  CruxMeasurement,
  PageSpeedMeasurement,
  PageSpeedOpportunity,
  PerformanceRating,
} from "./types";

const PAGESPEED_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PAGESPEED_TIMEOUT_MS = 45_000;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function auditNumericValue(audits: UnknownRecord, id: string): number | null {
  return finiteNumber(record(audits[id])?.numericValue);
}

function fieldNumericValue(metrics: UnknownRecord, id: string): number | null {
  return finiteNumber(record(metrics[id])?.percentile);
}

function metricRating(
  value: number | null,
  goodMaximum: number,
  poorMinimum: number
): PerformanceRating {
  if (value === null) {
    return "unavailable";
  }
  if (value <= goodMaximum) {
    return "good";
  }
  if (value > poorMinimum) {
    return "poor";
  }
  return "needs-improvement";
}

function score(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.round(numeric * 100);
}

function measuredSource(
  fieldValue: number | null,
  labValue: number | null
): "field" | "lab" | null {
  if (fieldValue !== null) {
    return "field";
  }
  return labValue === null ? null : "lab";
}

function opportunities(audits: UnknownRecord): PageSpeedOpportunity[] {
  return Object.entries(audits)
    .flatMap(([id, raw]) => {
      const audit = record(raw);
      const details = record(audit?.details);
      const savingsMs = finiteNumber(details?.overallSavingsMs);
      const auditScore = finiteNumber(audit?.score);
      const title = typeof audit?.title === "string" ? audit.title : null;
      if (
        !(
          title &&
          (savingsMs !== null || (auditScore !== null && auditScore < 0.9))
        )
      ) {
        return [];
      }
      return [
        {
          displayValue:
            typeof audit?.displayValue === "string" ? audit.displayValue : null,
          id,
          savingsMs: savingsMs === null ? null : Math.round(savingsMs),
          title,
        },
      ];
    })
    .sort((left, right) => (right.savingsMs ?? 0) - (left.savingsMs ?? 0))
    .slice(0, 5);
}

export function unavailablePageSpeed(errorCode: string): PageSpeedMeasurement {
  return {
    cls: { rating: "unavailable", source: null, value: null },
    errorCode,
    fieldDataScope: null,
    fieldDataProvider: null,
    fieldDataPeriod: null,
    inpMs: { rating: "unavailable", source: null, value: null },
    lcpMs: { rating: "unavailable", source: null, value: null },
    measuredAt: null,
    opportunities: [],
    performanceScore: null,
    seoScore: null,
    strategy: "mobile",
  };
}

export function parsePageSpeedResponse(value: unknown): PageSpeedMeasurement {
  const root = record(value);
  const lighthouse = record(root?.lighthouseResult);
  const categories = record(lighthouse?.categories) ?? {};
  const audits = record(lighthouse?.audits) ?? {};
  const performance = record(categories.performance);
  const seo = record(categories.seo);
  const urlField = record(record(root?.loadingExperience)?.metrics);
  const originField = record(record(root?.originLoadingExperience)?.metrics);
  const fieldMetrics = urlField ?? originField ?? {};
  let fieldDataScope: "url" | "origin" | null = null;
  if (urlField) {
    fieldDataScope = "url";
  } else if (originField) {
    fieldDataScope = "origin";
  }
  const fieldLcp = fieldNumericValue(
    fieldMetrics,
    "LARGEST_CONTENTFUL_PAINT_MS"
  );
  const fieldInp = fieldNumericValue(fieldMetrics, "INTERACTION_TO_NEXT_PAINT");
  const fieldClsRaw = fieldNumericValue(
    fieldMetrics,
    "CUMULATIVE_LAYOUT_SHIFT_SCORE"
  );
  const fieldCls = fieldClsRaw === null ? null : fieldClsRaw / 100;
  const labLcp = auditNumericValue(audits, "largest-contentful-paint");
  const labCls = auditNumericValue(audits, "cumulative-layout-shift");
  const lcp = fieldLcp ?? labLcp;
  const cls = fieldCls ?? labCls;

  return {
    cls: {
      rating: metricRating(cls, 0.1, 0.25),
      source: measuredSource(fieldCls, labCls),
      value: cls,
    },
    errorCode: null,
    fieldDataScope,
    fieldDataProvider: fieldDataScope ? "pagespeed" : null,
    fieldDataPeriod: null,
    inpMs: {
      rating: metricRating(fieldInp, 200, 500),
      source: fieldInp === null ? null : "field",
      value: fieldInp,
    },
    lcpMs: {
      rating: metricRating(lcp, 2500, 4000),
      source: measuredSource(fieldLcp, labLcp),
      value: lcp,
    },
    measuredAt:
      typeof lighthouse?.fetchTime === "string"
        ? lighthouse.fetchTime
        : new Date().toISOString(),
    opportunities: opportunities(audits),
    performanceScore: score(performance?.score),
    seoScore: score(seo?.score),
    strategy: "mobile",
  };
}

export function applyCruxFieldData(
  pageSpeed: PageSpeedMeasurement,
  crux: CruxMeasurement
): PageSpeedMeasurement {
  if (crux.errorCode) {
    return pageSpeed;
  }
  const metric = (
    value: number | null,
    goodMaximum: number,
    poorMinimum: number
  ) => ({
    rating: metricRating(value, goodMaximum, poorMinimum),
    source: value === null ? null : ("field" as const),
    value,
  });
  return {
    ...pageSpeed,
    cls: metric(crux.cls, 0.1, 0.25),
    fieldDataPeriod:
      crux.firstDate && crux.lastDate
        ? { firstDate: crux.firstDate, lastDate: crux.lastDate }
        : null,
    fieldDataProvider: "crux",
    fieldDataScope: crux.fieldDataScope,
    inpMs: metric(crux.inpMs, 200, 500),
    lcpMs: metric(crux.lcpMs, 2500, 4000),
  };
}

export async function inspectPageSpeed(
  targetUrl: string
): Promise<PageSpeedMeasurement> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY?.trim();
  if (!apiKey) {
    return unavailablePageSpeed("PAGESPEED_CONFIG_MISSING");
  }

  const url = new URL(PAGESPEED_ENDPOINT);
  url.searchParams.set("url", targetUrl);
  url.searchParams.set("strategy", "mobile");
  url.searchParams.append("category", "performance");
  url.searchParams.append("category", "seo");
  url.searchParams.set("locale", "ko");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGESPEED_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return unavailablePageSpeed(`PAGESPEED_HTTP_${response.status}`);
    }
    return parsePageSpeedResponse(await response.json());
  } catch (error) {
    return unavailablePageSpeed(
      error instanceof Error && error.name === "AbortError"
        ? "PAGESPEED_TIMEOUT"
        : "PAGESPEED_FAILED"
    );
  } finally {
    clearTimeout(timeout);
  }
}
