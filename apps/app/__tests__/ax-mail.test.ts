/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mail = await import("@/lib/ax-mail/google");
const campaign = await import("@/lib/ax-mail/cosmetics-prospects");

describe("AX mail draft-only integration", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAIL_CLIENT_ID = "test-client";
    process.env.GOOGLE_MAIL_CLIENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    vi.restoreAllMocks();
  });

  test("OAuth requests only the Gmail compose scope and binds a signed state", () => {
    const state = mail.mailState({
      orgId: "org",
      userId: "user",
      issuedAt: 123,
    });
    expect(mail.parseMailState(state)).toEqual({
      orgId: "org",
      userId: "user",
      issuedAt: 123,
    });
    expect(() => mail.parseMailState(`${state}x`)).toThrow();
    const url = new URL(mail.googleMailAuthorizationUrl(state));
    expect(url.searchParams.get("scope")).toBe(mail.MAIL_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/ax-mail/google/callback"
    );
  });

  test("Korean MIME survives encoding, while header injection is rejected", () => {
    const raw = mail.buildRawMail(
      "buyer@example.com",
      "안녕하세요",
      "첫 줄\n둘째 줄"
    );
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: buyer@example.com\r\n");
    expect(mime).toContain(
      `Subject: =?UTF-8?B?${Buffer.from("안녕하세요").toString("base64")}?=`
    );
    expect(
      Buffer.from(
        mime.split("\r\n\r\n")[1].replaceAll("\r\n", ""),
        "base64"
      ).toString("utf8")
    ).toBe("첫 줄\n둘째 줄");
    expect(() =>
      mail.buildRawMail("buyer@example.com\r\nBcc: x@example.com", "hi", "body")
    ).toThrow();
  });

  test("only the Gmail drafts endpoint is called; never a send endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "draft-123" }), { status: 200 })
      );
    expect(
      await mail.createGoogleDraft(
        "access",
        "buyer@example.com",
        "Hi",
        "Message"
      )
    ).toBe("draft-123");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts"
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  });

  test("routes enforce admin and org scope; no send route exists", () => {
    const api = join(process.cwd(), "app/api/ax-mail");
    for (const path of ["google/connect", "google/callback", "drafts"]) {
      const source = readFileSync(join(api, path, "route.ts"), "utf8");
      expect(source).toContain("isAdmin()");
      expect(source).toContain("orgId");
      expect(source).not.toContain("users/me/messages/send");
    }
  });
});

describe("cosmetics prospect workbench", () => {
  test("six prospects have distinct buying companies and official public contact sources", () => {
    const prospects = campaign.COSMETICS_PROSPECTS;
    expect(prospects).toHaveLength(6);
    expect(new Set(prospects.map((prospect) => prospect.company)).size).toBe(6);
    for (const prospect of prospects) {
      expect(prospect.contactEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(new URL(prospect.contactSource).protocol).toBe("https:");
      expect(new URL(prospect.factSource).protocol).toBe("https:");
    }
  });

  test("all personalized drafts state that visibility has not yet been measured", () => {
    for (const prospect of campaign.COSMETICS_PROSPECTS) {
      const draft = campaign.prospectDraft(prospect);
      expect(draft.recipient).toBe(prospect.contactEmail);
      expect(draft.subject).toContain(prospect.brand);
      expect(draft.body).toContain("실제 노출을 진단한 것은 아니므로");
      expect(draft.body).toContain(prospect.question);
    }
    expect(
      campaign.COSMETICS_PROSPECTS.find(
        (prospect) => prospect.id === "roundlab"
      )?.parentGroup
    ).toContain("구다이글로벌");
  });
});
