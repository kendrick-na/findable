import "server-only";

import { decryptRefreshToken } from "./crypto";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

const SC_DOMAIN_PREFIX_RE = /^sc-domain:/i;
const WWW_PREFIX_RE = /^www\./;
const TRAILING_SLASH_RE = /\/$/;
const PROPERTY_PREFIX_RE = /^properties\//;
const COMPACT_DATE_RE = /^\d{8}$/;
const TRANSIENT_GOOGLE_STATUS = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_RETRY_DELAY_MS = [200, 600] as const;

export interface GoogleProperty {
  id: string;
  name: string;
  provider: "google_search_console" | "google_analytics_4";
}

function normalizedHostname(value: string): string | null {
  const raw = value.trim().replace(SC_DOMAIN_PREFIX_RE, "");
  if (!raw) {
    return null;
  }
  try {
    const hostname = new URL(
      raw.includes("://") ? raw : `https://${raw}`
    ).hostname.toLowerCase();
    return hostname.replace(WWW_PREFIX_RE, "");
  } catch {
    return null;
  }
}

export function propertyMatchesBrandDomain(
  brandDomain: string,
  propertyUrlOrDomain: string
): boolean {
  const brand = normalizedHostname(brandDomain);
  const property = normalizedHostname(propertyUrlOrDomain);
  return Boolean(brand && property && brand === property);
}

function oauthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!(clientId && clientSecret && appUrl)) {
    throw new Error("GOOGLE_OAUTH_CONFIG_MISSING");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(TRAILING_SLASH_RE, "")}/api/integrations/google/callback`,
  };
}

export function googleAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function jsonResponse<T>(response: Response, code: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${code}_${response.status}`);
  }
  return (await response.json()) as T;
}

export async function exchangeGoogleCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
}> {
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const body = await jsonResponse<{
    access_token: string;
    refresh_token?: string;
    scope?: string;
  }>(response, "GOOGLE_TOKEN_EXCHANGE_FAILED");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scopes: body.scope?.split(" ").filter(Boolean) ?? [...GOOGLE_SCOPES],
  };
}

export async function refreshGoogleAccessToken(
  encryptedRefreshToken: string
): Promise<string> {
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptRefreshToken(encryptedRefreshToken),
    }),
    cache: "no-store",
  });
  const body = await jsonResponse<{ access_token: string }>(
    response,
    "GOOGLE_TOKEN_REFRESH_FAILED"
  );
  return body.access_token;
}

export async function listGoogleProperties(
  accessToken: string
): Promise<GoogleProperty[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [sitesResponse, analyticsResponse] = await Promise.all([
    fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers,
      cache: "no-store",
    }),
    fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
      headers,
      cache: "no-store",
    }),
  ]);

  const sites = await jsonResponse<{
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  }>(sitesResponse, "SEARCH_CONSOLE_PROPERTIES_FAILED");
  const analytics = await jsonResponse<{
    accountSummaries?: Array<{
      propertySummaries?: Array<{
        property?: string;
        displayName?: string;
      }>;
    }>;
  }>(analyticsResponse, "GA4_PROPERTIES_FAILED");

  const gsc: GoogleProperty[] = (sites.siteEntry ?? [])
    .filter(
      (site) => site.siteUrl && site.permissionLevel !== "siteUnverifiedUser"
    )
    .map((site) => ({
      id: site.siteUrl as string,
      name: site.siteUrl as string,
      provider: "google_search_console",
    }));
  const ga4: GoogleProperty[] = (analytics.accountSummaries ?? []).flatMap(
    (account) =>
      (account.propertySummaries ?? [])
        .filter((property) => property.property)
        .map((property) => ({
          id: (property.property as string).replace(PROPERTY_PREFIX_RE, ""),
          name: property.displayName || (property.property as string),
          provider: "google_analytics_4" as const,
        }))
  );
  return [...gsc, ...ga4];
}

export async function listGa4WebStreamUris(
  accessToken: string,
  propertyId: string
): Promise<string[]> {
  const url = `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/dataStreams?pageSize=200`;
  const request = () =>
    fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  let response = await request();
  for (const delay of TRANSIENT_RETRY_DELAY_MS) {
    if (!TRANSIENT_GOOGLE_STATUS.has(response.status)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await request();
  }
  const body = await jsonResponse<{
    dataStreams?: Array<{
      type?: string;
      webStreamData?: { defaultUri?: string };
    }>;
  }>(response, "GA4_DATA_STREAMS_FAILED");
  return (body.dataStreams ?? []).flatMap((stream) => {
    const uri = stream.webStreamData?.defaultUri?.trim();
    return stream.type === "WEB_DATA_STREAM" && uri ? [uri] : [];
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromGoogle(value: string): Date {
  const normalized = COMPACT_DATE_RE.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
  return new Date(`${normalized}T00:00:00.000Z`);
}

export async function syncConnection(connectionId: string): Promise<void> {
  // OAuth URL·토큰 암호화 같은 순수 로직을 가져올 때 DB 환경 검증이 실행되지 않게
  // 실제 동기화 경계에서만 서버 DB 모듈을 로드한다.
  const { database } = await import("@repo/database");
  const connection = await database.searchPerformanceConnection.findUnique({
    where: { id: connectionId },
    include: { brand: { select: { domain: true } } },
  });
  if (
    !(
      connection?.propertyId &&
      connection.encryptedRefreshToken &&
      ["google_search_console", "google_analytics_4"].includes(
        connection.provider
      ) &&
      connection.status !== "pending_property"
    )
  ) {
    throw new Error("PROPERTY_REQUIRED");
  }
  await database.searchPerformanceConnection.update({
    where: { id: connection.id },
    data: { status: "syncing", lastErrorCode: null },
  });

  try {
    const accessToken = await refreshGoogleAccessToken(
      connection.encryptedRefreshToken
    );
    const brandDomain = connection.brand.domain;
    if (!brandDomain) {
      throw new Error("BRAND_DOMAIN_REQUIRED");
    }
    if (
      connection.provider === "google_search_console" &&
      !propertyMatchesBrandDomain(brandDomain, connection.propertyId)
    ) {
      throw new Error("PROPERTY_DOMAIN_MISMATCH");
    }
    if (connection.provider === "google_analytics_4") {
      const streamUris = await listGa4WebStreamUris(
        accessToken,
        connection.propertyId
      );
      if (
        !streamUris.some((uri) => propertyMatchesBrandDomain(brandDomain, uri))
      ) {
        throw new Error("PROPERTY_DOMAIN_MISMATCH");
      }
    }
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 2);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 27);

    if (connection.provider === "google_search_console") {
      const response = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.propertyId)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            startDate: isoDate(start),
            endDate: isoDate(end),
            dimensions: ["date"],
            dataState: "final",
            rowLimit: 1000,
          }),
          cache: "no-store",
        }
      );
      const body = await jsonResponse<{
        rows?: Array<{
          keys?: string[];
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
        }>;
      }>(response, "SEARCH_CONSOLE_SYNC_FAILED");
      const writes = (body.rows ?? []).flatMap((row) => {
        const date = row.keys?.[0];
        return date
          ? [
              database.searchPerformanceDaily.upsert({
                where: {
                  connectionId_date: {
                    connectionId: connection.id,
                    date: dateFromGoogle(date),
                  },
                },
                create: {
                  connectionId: connection.id,
                  date: dateFromGoogle(date),
                  clicks: Math.round(row.clicks ?? 0),
                  impressions: Math.round(row.impressions ?? 0),
                  ctr: row.ctr ?? 0,
                  averagePosition: row.position ?? 0,
                  dataFinal: true,
                },
                update: {
                  clicks: Math.round(row.clicks ?? 0),
                  impressions: Math.round(row.impressions ?? 0),
                  ctr: row.ctr ?? 0,
                  averagePosition: row.position ?? 0,
                  dataFinal: true,
                },
              }),
            ]
          : [];
      });
      await database.$transaction([
        database.searchPerformanceDaily.deleteMany({
          where: {
            connectionId: connection.id,
            date: { gte: start, lte: end },
          },
        }),
        ...writes,
      ]);
    } else if (connection.provider === "google_analytics_4") {
      const response = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${connection.propertyId}:runReport`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: isoDate(start), endDate: isoDate(end) }],
            dimensions: [
              { name: "date" },
              { name: "sessionDefaultChannelGroup" },
            ],
            dimensionFilter: {
              filter: {
                fieldName: "sessionDefaultChannelGroup",
                stringFilter: {
                  matchType: "EXACT",
                  value: "Organic Search",
                },
              },
            },
            metrics: [
              { name: "sessions" },
              { name: "engagedSessions" },
              { name: "keyEvents" },
              { name: "totalRevenue" },
            ],
            limit: "1000",
          }),
          cache: "no-store",
        }
      );
      const body = await jsonResponse<{
        rows?: Array<{
          dimensionValues?: Array<{ value?: string }>;
          metricValues?: Array<{ value?: string }>;
        }>;
      }>(response, "GA4_SYNC_FAILED");
      const writes = (body.rows ?? []).flatMap((row) => {
        const date = row.dimensionValues?.[0]?.value;
        const values = row.metricValues ?? [];
        return date
          ? [
              database.searchPerformanceDaily.upsert({
                where: {
                  connectionId_date: {
                    connectionId: connection.id,
                    date: dateFromGoogle(date),
                  },
                },
                create: {
                  connectionId: connection.id,
                  date: dateFromGoogle(date),
                  sessions: Number(values[0]?.value ?? 0),
                  engagedSessions: Number(values[1]?.value ?? 0),
                  keyEvents: Number(values[2]?.value ?? 0),
                  totalRevenue: Number(values[3]?.value ?? 0),
                  dataFinal: true,
                },
                update: {
                  sessions: Number(values[0]?.value ?? 0),
                  engagedSessions: Number(values[1]?.value ?? 0),
                  keyEvents: Number(values[2]?.value ?? 0),
                  totalRevenue: Number(values[3]?.value ?? 0),
                  dataFinal: true,
                },
              }),
            ]
          : [];
      });
      await database.$transaction([
        database.searchPerformanceDaily.deleteMany({
          where: {
            connectionId: connection.id,
            date: { gte: start, lte: end },
          },
        }),
        ...writes,
      ]);
    }

    await database.searchPerformanceConnection.update({
      where: { id: connection.id },
      data: {
        status: "connected",
        lastSyncedAt: new Date(),
        lastErrorCode: null,
      },
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message.slice(0, 120) : "SYNC_FAILED";
    await database.searchPerformanceConnection.update({
      where: { id: connection.id },
      data: { status: "error", lastErrorCode: code },
    });
    throw error;
  }
}
