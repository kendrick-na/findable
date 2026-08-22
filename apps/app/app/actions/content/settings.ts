"use server";

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { auth } from "@repo/auth/server";
import { database, Prisma } from "@repo/database";
import { revalidatePath } from "next/cache";

const PROTOCOL_RE = /^https?:\/\//;
const TRAILING_SLASH_RE = /\/$/;
const DOMAIN_RE =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(PROTOCOL_RE, "")
    .replace(TRAILING_SLASH_RE, "")
    .split("/")[0];
}

async function ownedPublisher(id: string) {
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  return database.publisher.findFirst({
    where: { id, brand: { organizationId: orgId } },
  });
}

export async function savePublisherSettings(formData: FormData) {
  const publisherId = String(formData.get("publisherId") ?? "");
  const publisher = await ownedPublisher(publisherId);
  if (!publisher) {
    return;
  }
  const customDomain = normalizeDomain(
    String(formData.get("customDomain") ?? "")
  );
  const valid =
    !customDomain ||
    (DOMAIN_RE.test(customDomain) && !customDomain.endsWith("findable.co.kr"));
  if (!valid) {
    throw new Error("올바른 외부 도메인을 입력해 주세요.");
  }
  const changed = customDomain !== (publisher.customDomain ?? "");
  let customDomainStatus = publisher.customDomainStatus;
  if (!customDomain) {
    customDomainStatus = "unconfigured";
  } else if (changed) {
    customDomainStatus = "pending";
  }
  await database.publisher.update({
    where: { id: publisher.id },
    data: {
      customDomain: customDomain || null,
      customDomainStatus,
      customDomainVerificationToken:
        customDomain && changed ? randomBytes(20).toString("hex") : undefined,
      customDomainVerification: changed ? Prisma.DbNull : undefined,
      customDomainUpdatedAt: changed
        ? new Date()
        : publisher.customDomainUpdatedAt,
      newsletterEnabled: formData.get("newsletterEnabled") === "on",
    },
  });
  revalidatePath("/insights/settings");
}

async function addDomainToVercel(domain: string) {
  const token = process.env.FINDABLE_VERCEL_API_TOKEN;
  const project = process.env.FINDABLE_WEB_VERCEL_PROJECT_ID;
  if (!(token && project)) {
    return { configured: false, verified: false };
  }
  const team = process.env.FINDABLE_VERCEL_TEAM_ID;
  const query = team ? `?teamId=${encodeURIComponent(team)}` : "";
  const projectDomainUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  let response = await fetch(`${projectDomainUrl}${query}`, { headers });
  if (response.status === 404) {
    response = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/domains${query}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ name: domain }),
      }
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
    verified?: boolean;
    verification?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      body.error?.message ?? "Vercel 도메인 연결에 실패했습니다."
    );
  }
  if (body.verified === true) {
    return { configured: true, verified: true, response: body };
  }
  const verifyResponse = await fetch(`${projectDomainUrl}/verify${query}`, {
    method: "POST",
    headers,
  });
  const verifyBody = (await verifyResponse.json().catch(() => ({}))) as {
    verified?: boolean;
    verification?: unknown;
  };
  return {
    configured: true,
    verified: verifyResponse.ok && verifyBody.verified === true,
    response: verifyResponse.ok ? verifyBody : body,
  };
}

export async function verifyPublisherDomain(formData: FormData) {
  const publisher = await ownedPublisher(
    String(formData.get("publisherId") ?? "")
  );
  if (!(publisher?.customDomain && publisher.customDomainVerificationToken)) {
    return;
  }
  const txtName = `_findable.${publisher.customDomain}`;
  let txtVerified = false;
  try {
    const records = await resolveTxt(txtName);
    txtVerified = records.some(
      (parts) => parts.join("") === publisher.customDomainVerificationToken
    );
  } catch {
    txtVerified = false;
  }
  if (!txtVerified) {
    await database.publisher.update({
      where: { id: publisher.id },
      data: {
        customDomainStatus: "failed",
        customDomainVerification: {
          txtName,
          txtVerified: false,
          checkedAt: new Date().toISOString(),
        },
      },
    });
    revalidatePath("/insights/settings");
    return;
  }
  try {
    const vercel = await addDomainToVercel(publisher.customDomain);
    await database.publisher.update({
      where: { id: publisher.id },
      data: {
        customDomainStatus:
          vercel.configured && vercel.verified ? "active" : "verified",
        customDomainVerification: {
          txtName,
          txtVerified: true,
          hostingConfigured: vercel.configured,
          providerVerified: vercel.verified,
          checkedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    await database.publisher.update({
      where: { id: publisher.id },
      data: {
        customDomainStatus: "failed",
        customDomainVerification: {
          txtName,
          txtVerified: true,
          hostingConfigured: false,
          error: error instanceof Error ? error.message : String(error),
          checkedAt: new Date().toISOString(),
        },
      },
    });
  }
  revalidatePath("/insights/settings");
}
