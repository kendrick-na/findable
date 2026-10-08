import { createHash } from "node:crypto";
import { isAdmin } from "@repo/auth/admin";
import { auth } from "@repo/auth/server";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { z } from "zod";
import {
  CONTACT_BASIS_KINDS,
  contactBasisProblem,
  hasAdLabel,
} from "@/lib/ax-mail/contact-basis";
import { recordSalesDraft } from "@/lib/ax-mail/discovery/pipeline";
import {
  createGoogleDraft,
  findSenderAlias,
  listSenderAliases,
  MAIL_SCOPES,
  refreshMailAccessToken,
} from "@/lib/ax-mail/google";
import {
  hasGuaranteeClaim,
  hasReportLink,
  hasSenderNotice,
  OUTREACH_SENDER,
} from "@/lib/ax-mail/leads";

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
  leadId: z.string().trim().min(1).max(253).optional(),
  // 「회사 찾기」 화면의 영업 리드(SalesLead) — 있으면 초안 저장 뒤 수신 근거·단계(drafted)를 남긴다.
  salesLeadId: z.uuid().optional(),
  // 수신 근거 — 명함 수령·정보 요청·6개월 내 기존 고객·공개 문의 메일. 없으면 초안을 만들지 않는다.
  contactBasis: z.object({
    kind: z.enum(CONTACT_BASIS_KINDS),
    detail: z.string().trim().min(1).max(500),
    date: z.string().trim().max(10),
  }),
});

type DraftInput = z.infer<typeof inputSchema>;

/** 초안 내용 검사 — 화면 검사와 같은 규칙으로 서버에서 다시 본다. 문제 없으면 null. */
function draftContentError(
  subject: string,
  body: string,
  contactBasis: DraftInput["contactBasis"]
): { error: string; reason?: string } | null {
  // 수신 근거 — 없음·미래 날짜·기존 고객 6개월 경과면 만들지 않는다.
  const basisProblem = contactBasisProblem(contactBasis, new Date());
  if (basisProblem) {
    return { error: "contact_basis_invalid", reason: basisProblem };
  }
  // 정보통신망법 제50조 제4항 — 전송자·수신거부 안내가 빠진 초안은 만들지 않는다.
  // 기존 고객(동의 예외)도 광고성 정보라 제목 「(광고)」 표기가 필요하다.
  if (
    !hasSenderNotice(body) ||
    (contactBasis.kind === "existing_customer" && !hasAdLabel(subject))
  ) {
    return { error: "ad_notice_missing" };
  }
  // 첨부 대신 승인된 리포트 링크 — 링크 없는 초안은 만들지 않는다.
  if (!hasReportLink(body)) {
    return { error: "report_link_missing" };
  }
  if (hasGuaranteeClaim(`${subject}\n${body}`)) {
    return { error: "guarantee_claim" };
  }
  return null;
}

/**
 * 영업 리드 기록 — 초안은 이미 Gmail 에 만들어졌으므로 여기서 실패해도 응답을 바꾸지 않는다.
 * (플래그 꺼짐·테이블 없음이면 recordSalesDraft 가 조용히 건너뛴다.)
 */
async function recordSalesDraftSafely(
  salesLeadId: string,
  recipient: string,
  contactBasis: DraftInput["contactBasis"],
  userId: string
): Promise<void> {
  try {
    const outcome = await recordSalesDraft(database, {
      basis: contactBasis,
      recipient,
      salesLeadId,
      userId,
    });
    log.info("ax_mail.draft.sales_lead", { outcome, salesLeadId });
  } catch (error) {
    log.warn("ax_mail.draft.sales_lead_failed", {
      error: error instanceof Error ? error.message : "unknown",
      salesLeadId,
    });
  }
}

export async function POST(request: Request) {
  const { orgId, userId } = await auth();
  if (!(orgId && userId && (await isAdmin()))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const {
    recipient,
    subject,
    body,
    idempotencyKey,
    leadId,
    salesLeadId,
    contactBasis,
  } = input.data;
  const contentError = draftContentError(subject, body, contactBasis);
  if (contentError) {
    return Response.json(contentError, { status: 422 });
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
    !MAIL_SCOPES.every((scope) => connection.scopes.includes(scope))
  ) {
    return Response.json({ error: "mail_not_connected" }, { status: 409 });
  }

  // 🔴 2026-09-28 사고: 초안 보낸사람이 개인 주소(nayoy2@gmail.com)로 잡혀 그대로 발송됐다.
  //   → 회사 주소 별칭이 Gmail 에 등록·인증돼 있을 때만 그 주소를 From 에 박아 초안을 만든다.
  let accessToken: string;
  try {
    accessToken = await refreshMailAccessToken(
      connection.encryptedRefreshToken
    );
  } catch {
    return Response.json({ error: "mail_token_expired" }, { status: 409 });
  }
  let sender: { displayName: string; email: string } | null = null;
  try {
    const alias = findSenderAlias(
      await listSenderAliases(accessToken),
      OUTREACH_SENDER.email
    );
    sender = alias
      ? { displayName: OUTREACH_SENDER.displayName, email: alias.email }
      : null;
  } catch {
    sender = null;
  }
  if (!sender) {
    return Response.json({ error: "sender_alias_missing" }, { status: 409 });
  }

  const bodyHash = createHash("sha256").update(body).digest("hex");
  let draft: { id: string };
  try {
    draft = await database.outreachDraft.create({
      data: {
        organizationId: orgId,
        userId,
        connectionId: connection.id,
        idempotencyKey,
        leadId: leadId ?? null,
        sender: sender.email,
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
        sender: sender.email,
        status: "created",
      });
    }
    return Response.json({ error: "draft_already_requested" }, { status: 409 });
  }
  try {
    const remoteDraftId = await createGoogleDraft(
      accessToken,
      recipient,
      subject,
      body,
      sender
    );
    await database.outreachDraft.update({
      where: { id: draft.id },
      data: { remoteDraftId, status: "created" },
    });
    // 수신 근거 기록(설명 원문은 개인정보가 섞일 수 있어 종류·날짜만 남긴다).
    log.info("ax_mail.draft.contact_basis", {
      draftId: draft.id,
      leadId: leadId ?? null,
      basisKind: contactBasis.kind,
      basisDate: contactBasis.date,
    });
    if (salesLeadId) {
      await recordSalesDraftSafely(
        salesLeadId,
        recipient,
        contactBasis,
        userId
      );
    }
    return Response.json(
      { draftId: remoteDraftId, sender: sender.email, status: "created" },
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
