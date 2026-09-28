import { createHash } from "node:crypto";
import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { z } from "zod";
import {
  createGoogleDraft,
  MAIL_SCOPE,
  refreshMailAccessToken,
} from "@/lib/ax-mail/google";

const HEADER_NEWLINE_RE = /[\r\n]/;
const inputSchema = z.object({
  recipient: z.email().max(320),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !HEADER_NEWLINE_RE.test(value)),
  body: z.string().min(1).max(100_000),
  idempotencyKey: z.uuid(),
});

export async function POST(request: Request) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const connection = await database.mailboxConnection.findUnique({
    where: {
      organizationId_userId_provider: {
        organizationId: orgId,
        userId,
        provider: "google_workspace",
      },
    },
  });
  if (
    !connection ||
    connection.status !== "connected" ||
    !connection.scopes.includes(MAIL_SCOPE)
  ) {
    return Response.json({ error: "mail_not_connected" }, { status: 409 });
  }
  const { recipient, subject, body, idempotencyKey } = input.data;
  const bodyHash = createHash("sha256").update(body).digest("hex");
  let draft: { id: string };
  try {
    draft = await database.outreachDraft.create({
      data: {
        organizationId: orgId,
        userId,
        connectionId: connection.id,
        idempotencyKey,
        recipient,
        subject,
        bodyHash,
      },
      select: { id: true },
    });
  } catch {
    const existing = await database.outreachDraft.findUnique({
      where: {
        organizationId_userId_idempotencyKey: {
          organizationId: orgId,
          userId,
          idempotencyKey,
        },
      },
      select: {
        bodyHash: true,
        recipient: true,
        subject: true,
        status: true,
        remoteDraftId: true,
      },
    });
    if (
      existing?.status === "created" &&
      existing.bodyHash === bodyHash &&
      existing.recipient === recipient &&
      existing.subject === subject
    ) {
      return Response.json({
        draftId: existing.remoteDraftId,
        status: "created",
      });
    }
    return Response.json({ error: "draft_already_requested" }, { status: 409 });
  }
  try {
    const accessToken = await refreshMailAccessToken(
      connection.encryptedRefreshToken
    );
    const remoteDraftId = await createGoogleDraft(
      accessToken,
      recipient,
      subject,
      body
    );
    await database.outreachDraft.update({
      where: { id: draft.id },
      data: { remoteDraftId, status: "created" },
    });
    return Response.json(
      { draftId: remoteDraftId, status: "created" },
      { status: 201 }
    );
  } catch {
    // 외부 API 성공 직후 DB 기록만 실패했을 수도 있다. 같은 키로 자동 재시도하지 않는다.
    await database.outreachDraft.updateMany({
      where: { id: draft.id, status: "pending" },
      data: { status: "failed" },
    });
    return Response.json(
      { error: "draft_creation_uncertain" },
      { status: 502 }
    );
  }
}
