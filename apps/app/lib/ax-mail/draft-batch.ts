import type { ContactBasis } from "./contact-basis";

/**
 * 받는 사람 여러 명 → **받는 사람마다 Gmail 초안 1건**(대표 결정 2026-10-07).
 * 한 초안에 여러 주소를 넣지 않는다 — 회사 공개 메일끼리 서로의 주소가 보이면 안 되고,
 * 수신 근거(공개 페이지 주소·확인 날짜)도 주소마다 다르다.
 *
 * 서버(drafts route)는 그대로 1명씩 받는다. 여기서 순서대로 한 번씩 부른다.
 * 멱등 키는 주소별로 keys 에 남겨, 다시 눌러도 같은 주소는 같은 키로 간다(중복 초안 방지).
 */

export interface RecipientDraft {
  basis: ContactBasis;
  email: string;
}

export interface RecipientDraftResult {
  draftId?: string;
  email: string;
  error?: string;
  ok: boolean;
  reason?: string;
  sender?: string;
}

export async function saveDraftsPerRecipient(input: {
  body: string;
  fetchImpl?: typeof fetch;
  keys: Map<string, string>;
  leadId?: string;
  newKey?: () => string;
  recipients: RecipientDraft[];
  salesLeadId?: string;
  subject: string;
}): Promise<RecipientDraftResult[]> {
  const doFetch = input.fetchImpl ?? fetch;
  const newKey = input.newKey ?? (() => crypto.randomUUID());
  const results: RecipientDraftResult[] = [];
  for (const recipient of input.recipients) {
    let key = input.keys.get(recipient.email);
    if (!key) {
      key = newKey();
      input.keys.set(recipient.email, key);
    }
    try {
      const response = await doFetch("/api/ax-mail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: recipient.email,
          subject: input.subject,
          body: input.body,
          leadId: input.leadId,
          salesLeadId: input.salesLeadId,
          contactBasis: recipient.basis,
          idempotencyKey: key,
        }),
      });
      const value = (await response.json().catch(() => ({}))) as {
        draftId?: string;
        error?: string;
        reason?: string;
        sender?: string;
      };
      if (response.ok && value.draftId && value.sender) {
        results.push({
          draftId: value.draftId,
          email: recipient.email,
          ok: true,
          sender: value.sender,
        });
      } else {
        results.push({
          email: recipient.email,
          error: value.error,
          ok: false,
          reason: value.reason,
        });
      }
    } catch {
      results.push({ email: recipient.email, ok: false });
    }
  }
  return results;
}
