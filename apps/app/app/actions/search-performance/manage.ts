"use server";

import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  listGa4WebStreamUris,
  listGoogleProperties,
  propertyMatchesBrandDomain,
  refreshGoogleAccessToken,
  syncConnection,
} from "@/lib/search-performance/google";
import {
  buildIndexNowPayload,
  parseNaverSearchCsv,
  resolveIndexNowHost,
  verifyIndexNowKeyFile,
} from "@/lib/search-performance/naver";

const INDEXNOW_KEY_RE = /^[a-fA-F0-9-]{8,128}$/;
const LINE_RE = /\r?\n/;

function ownedConnection(id: string, orgId: string) {
  return database.searchPerformanceConnection.findFirst({
    where: { id, organizationId: orgId },
    include: { brand: { select: { domain: true } } },
  });
}

export async function selectSearchProperty(formData: FormData) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error("FORBIDDEN");
  }
  const connectionId = String(formData.get("connectionId") ?? "");
  const propertyId = String(formData.get("propertyId") ?? "");
  const connection = await ownedConnection(connectionId, orgId);
  if (!(connection && propertyId)) {
    redirect("/site-audit/integrations?error=property");
  }
  if (!connection.encryptedRefreshToken) {
    redirect("/site-audit/integrations?error=property");
  }
  let properties: Awaited<ReturnType<typeof listGoogleProperties>>;
  try {
    const accessToken = await refreshGoogleAccessToken(
      connection.encryptedRefreshToken
    );
    properties = await listGoogleProperties(accessToken);
  } catch {
    redirect(
      `/site-audit/integrations?brand=${connection.brandId}&error=property_list`
    );
  }
  const selected = properties.find(
    (property) =>
      property.provider === connection.provider && property.id === propertyId
  );
  if (!selected) {
    redirect("/site-audit/integrations?error=property");
  }
  const brandDomain = connection.brand.domain;
  if (!brandDomain) {
    redirect(
      `/site-audit/integrations?brand=${connection.brandId}&error=brand_domain`
    );
  }
  let domainMatches = propertyMatchesBrandDomain(brandDomain, selected.id);
  if (connection.provider === "google_analytics_4") {
    try {
      const accessToken = await refreshGoogleAccessToken(
        connection.encryptedRefreshToken
      );
      const streamUris = await listGa4WebStreamUris(accessToken, selected.id);
      domainMatches = streamUris.some((uri) =>
        propertyMatchesBrandDomain(brandDomain, uri)
      );
    } catch {
      redirect(
        `/site-audit/integrations?brand=${connection.brandId}&error=property_list`
      );
    }
  }
  if (!domainMatches) {
    redirect(
      `/site-audit/integrations?brand=${connection.brandId}&error=property_domain`
    );
  }
  try {
    await database.searchPerformanceConnection.update({
      where: { id: connection.id },
      data: {
        propertyId: selected.id,
        propertyName: selected.name,
        status: "connected",
        lastErrorCode: null,
      },
    });
  } catch {
    redirect(
      `/site-audit/integrations?brand=${connection.brandId}&error=property_save`
    );
  }
  try {
    await syncConnection(connection.id);
  } catch {
    // syncConnection이 오류 상태를 기록한다. 속성 선택 자체는 보존한다.
  }
  revalidatePath("/site-audit/integrations");
  redirect(
    `/site-audit/integrations?brand=${connection.brandId}&saved=property`
  );
}

export async function syncSearchPerformance(formData: FormData) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error("FORBIDDEN");
  }
  const connectionId = String(formData.get("connectionId") ?? "");
  const connection = await ownedConnection(connectionId, orgId);
  if (!connection) {
    throw new Error("FORBIDDEN");
  }
  try {
    await syncConnection(connection.id);
  } catch {
    // 상태와 안전한 오류코드는 DB에 이미 기록된다.
  }
  revalidatePath("/site-audit/integrations");
  redirect(`/site-audit/integrations?brand=${connection.brandId}&synced=1`);
}

export async function disconnectSearchPerformance(formData: FormData) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error("FORBIDDEN");
  }
  const connectionId = String(formData.get("connectionId") ?? "");
  const connection = await ownedConnection(connectionId, orgId);
  if (!connection) {
    throw new Error("FORBIDDEN");
  }
  await database.searchPerformanceConnection.delete({
    where: { id: connection.id },
  });
  revalidatePath("/site-audit/integrations");
  redirect(
    `/site-audit/integrations?brand=${connection.brandId}&disconnected=1`
  );
}

export async function importNaverSearchPerformance(formData: FormData) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId)) {
    throw new Error("FORBIDDEN");
  }
  const brandId = String(formData.get("brandId") ?? "");
  const file = formData.get("file");
  const brand = await database.brand.findFirst({
    where: { id: brandId, organizationId: orgId },
    select: { domain: true, id: true },
  });
  if (!(brand?.domain && file instanceof File && file.size > 0)) {
    redirect(`/site-audit/integrations?brand=${brandId}&error=naver_file`);
  }
  if (file.size > 1_000_000) {
    redirect(`/site-audit/integrations?brand=${brandId}&error=naver_size`);
  }
  let rows: ReturnType<typeof parseNaverSearchCsv>;
  try {
    rows = parseNaverSearchCsv(await file.text());
  } catch (error) {
    const code = error instanceof Error ? error.message : "NAVER_CSV_INVALID";
    redirect(
      `/site-audit/integrations?brand=${brandId}&error=${encodeURIComponent(code.toLowerCase())}`
    );
  }
  const connection = await database.searchPerformanceConnection.upsert({
    where: {
      brandId_provider: { brandId, provider: "naver_search_advisor_csv" },
    },
    create: {
      brandId,
      createdBy: userId,
      encryptedRefreshToken: null,
      lastSyncedAt: new Date(),
      organizationId: orgId,
      propertyId: brand.domain,
      propertyName: brand.domain,
      provider: "naver_search_advisor_csv",
      scopes: [],
      status: "connected",
    },
    update: {
      lastErrorCode: null,
      lastSyncedAt: new Date(),
      propertyId: brand.domain,
      propertyName: brand.domain,
      status: "connected",
    },
  });
  await database.$transaction(
    rows.map((row) =>
      database.searchPerformanceDaily.upsert({
        where: {
          connectionId_date: { connectionId: connection.id, date: row.date },
        },
        create: { connectionId: connection.id, ...row, dataFinal: true },
        update: { ...row, dataFinal: true },
      })
    )
  );
  revalidatePath("/site-audit/integrations");
  redirect(
    `/site-audit/integrations?brand=${brandId}&naverImported=${rows.length}`
  );
}

export async function submitIndexNow(formData: FormData) {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error("FORBIDDEN");
  }
  const brandId = String(formData.get("brandId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const rawUrls = String(formData.get("urls") ?? "");
  const brand = await database.brand.findFirst({
    where: { id: brandId, organizationId: orgId },
    select: { domain: true },
  });
  if (!(brand?.domain && INDEXNOW_KEY_RE.test(key))) {
    redirect(`/site-audit/integrations?brand=${brandId}&error=indexnow_input`);
  }
  let urls: URL[];
  try {
    urls = rawUrls
      .split(LINE_RE)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value));
  } catch {
    redirect(`/site-audit/integrations?brand=${brandId}&error=indexnow_input`);
  }
  const indexNowHost = resolveIndexNowHost(brand.domain, urls);
  if (urls.length === 0 || urls.length > 100 || !indexNowHost) {
    redirect(`/site-audit/integrations?brand=${brandId}&error=indexnow_domain`);
  }
  const keyVerifiedAt = new Date();
  if (!(await verifyIndexNowKeyFile(indexNowHost, key))) {
    await database.indexNowConfiguration.upsert({
      where: { brandId },
      create: {
        brandId,
        host: indexNowHost,
        key,
        lastErrorCode: "KEY_FILE_NOT_FOUND",
        organizationId: orgId,
        status: "error",
      },
      update: {
        host: indexNowHost,
        key,
        keyVerifiedAt: null,
        lastErrorCode: "KEY_FILE_NOT_FOUND",
        status: "error",
      },
    });
    redirect(
      `/site-audit/integrations?brand=${brandId}&error=indexnow_key_file`
    );
  }
  let response: Response;
  try {
    response = await fetch("https://searchadvisor.naver.com/indexnow", {
      body: JSON.stringify(buildIndexNowPayload(indexNowHost, key, urls)),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });
  } catch {
    await database.indexNowConfiguration.upsert({
      where: { brandId },
      create: {
        brandId,
        host: indexNowHost,
        key,
        keyVerifiedAt,
        lastErrorCode: "NETWORK_ERROR",
        organizationId: orgId,
        status: "error",
      },
      update: {
        host: indexNowHost,
        key,
        keyVerifiedAt,
        lastErrorCode: "NETWORK_ERROR",
        status: "error",
      },
    });
    redirect(
      `/site-audit/integrations?brand=${brandId}&error=indexnow_network`
    );
  }
  if (![200, 202].includes(response.status)) {
    await database.indexNowConfiguration.upsert({
      where: { brandId },
      create: {
        brandId,
        host: indexNowHost,
        key,
        keyVerifiedAt,
        lastErrorCode: `HTTP_${response.status}`,
        lastHttpStatus: response.status,
        organizationId: orgId,
        status: "error",
      },
      update: {
        host: indexNowHost,
        key,
        keyVerifiedAt,
        lastErrorCode: `HTTP_${response.status}`,
        lastHttpStatus: response.status,
        status: "error",
      },
    });
    redirect(
      `/site-audit/integrations?brand=${brandId}&error=indexnow_http_${response.status}`
    );
  }
  await database.indexNowConfiguration.upsert({
    where: { brandId },
    create: {
      brandId,
      host: indexNowHost,
      key,
      keyVerifiedAt,
      lastErrorCode: null,
      lastHttpStatus: response.status,
      lastSubmittedAt: new Date(),
      lastSubmittedCount: urls.length,
      organizationId: orgId,
      status: "configured",
    },
    update: {
      host: indexNowHost,
      key,
      keyVerifiedAt,
      lastErrorCode: null,
      lastHttpStatus: response.status,
      lastSubmittedAt: new Date(),
      lastSubmittedCount: urls.length,
      status: "configured",
    },
  });
  redirect(
    `/site-audit/integrations?brand=${brandId}&indexNowSubmitted=${urls.length}`
  );
}
