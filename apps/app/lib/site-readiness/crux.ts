import "server-only";

import type { CruxMeasurement } from "./types";

const CRUX_ENDPOINT =
  "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const CRUX_TIMEOUT_MS = 15_000;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function p75(metrics: UnknownRecord, key: string): number | null {
  const raw = record(record(metrics[key])?.percentiles)?.p75;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function date(value: unknown): string | null {
  const input = record(value);
  const year = Number(input?.year);
  const month = Number(input?.month);
  const day = Number(input?.day);
  if (
    !(
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day)
    )
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function unavailableCrux(errorCode: string): CruxMeasurement {
  return {
    cls: null,
    errorCode,
    fieldDataScope: null,
    firstDate: null,
    inpMs: null,
    lastDate: null,
    lcpMs: null,
  };
}

export function parseCruxResponse(value: unknown): CruxMeasurement {
  const root = record(value);
  const data = record(root?.record);
  const key = record(data?.key);
  const metrics = record(data?.metrics) ?? {};
  const period = record(data?.collectionPeriod);
  return {
    cls: p75(metrics, "cumulative_layout_shift"),
    errorCode: null,
    fieldDataScope: typeof key?.url === "string" ? "url" : "origin",
    firstDate: date(period?.firstDate),
    inpMs: p75(metrics, "interaction_to_next_paint"),
    lastDate: date(period?.lastDate),
    lcpMs: p75(metrics, "largest_contentful_paint"),
  };
}

async function queryCrux(
  targetUrl: string,
  scope: "url" | "origin",
  apiKey: string
): Promise<CruxMeasurement> {
  const endpoint = new URL(CRUX_ENDPOINT);
  endpoint.searchParams.set("key", apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRUX_TIMEOUT_MS);
  try {
    const target = new URL(targetUrl);
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        [scope]: scope === "origin" ? target.origin : target.toString(),
        formFactor: "PHONE",
        metrics: [
          "largest_contentful_paint",
          "interaction_to_next_paint",
          "cumulative_layout_shift",
        ],
      }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    if (response.status === 404) {
      return unavailableCrux("CRUX_NO_DATA");
    }
    if (!response.ok) {
      return unavailableCrux(`CRUX_HTTP_${response.status}`);
    }
    return parseCruxResponse(await response.json());
  } catch (error) {
    return unavailableCrux(
      error instanceof Error && error.name === "AbortError"
        ? "CRUX_TIMEOUT"
        : "CRUX_FAILED"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function inspectCrux(targetUrl: string): Promise<CruxMeasurement> {
  const apiKey = process.env.GOOGLE_CRUX_API_KEY?.trim();
  if (!apiKey) {
    return unavailableCrux("CRUX_CONFIG_MISSING");
  }
  const page = await queryCrux(targetUrl, "url", apiKey);
  if (page.errorCode !== "CRUX_NO_DATA") {
    return page;
  }
  return queryCrux(targetUrl, "origin", apiKey);
}
