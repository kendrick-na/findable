/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mail = await import("@/lib/ax-mail/google");
const outreach = await import("@/lib/ax-mail/leads");
type Lead = import("@/lib/ax-mail/leads").Lead;

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "example.com",
    brand: "예시브랜드",
    brandEn: "Example",
    company: "(주)예시",
    domain: "example.com",
    segment: "K-뷰티",
    industry: "beauty",
    priority: 1,
    track: "prospect",
    contact: {
      email: "marketing@example.com",
      role: "공식 마케팅 문의",
      sourceUrl: "https://example.com/contact",
      checkedOn: "2026-09-25",
    },
    measurement: {
      measuredOn: "2026-09-29",
      answers: 32,
      engines: ["ChatGPT", "Gemini", "Claude"],
      productConfirmed: 20,
      answersWithCitations: 24,
      officialCited: 3,
      hook: null,
    },
    reportUrl: null,
    ...overrides,
  };
}

describe("Gmail draft-only integration", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAIL_CLIENT_ID = "test-client";
    process.env.GOOGLE_MAIL_CLIENT_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    vi.restoreAllMocks();
  });

  test("OAuth asks for compose + read-only settings, bound to a signed state", () => {
    const state = mail.mailState({ orgId: "org", userId: "user", issuedAt: 1 });
    expect(mail.parseMailState(state)).toEqual({
      orgId: "org",
      userId: "user",
      issuedAt: 1,
    });
    expect(() => mail.parseMailState(`${state}x`)).toThrow();
    const url = new URL(mail.googleMailAuthorizationUrl(state));
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
      [...mail.MAIL_SCOPES].sort()
    );
    expect(url.searchParams.get("scope")).not.toContain("gmail.send");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/ax-mail/google/callback"
    );
  });

  test("From header carries the company alias; header injection is rejected", () => {
    const raw = mail.buildRawMail("buyer@example.com", "안녕하세요", "본문", {
      displayName: "Findable",
      email: "contact@findable.co.kr",
    });
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime.startsWith("From: =?UTF-8?B?")).toBe(true);
    expect(mime).toContain(
      "<contact@findable.co.kr>\r\nTo: buyer@example.com\r\n"
    );
    expect(() =>
      mail.buildRawMail("buyer@example.com\r\nBcc: x@example.com", "hi", "b")
    ).toThrow();
    expect(() =>
      mail.buildRawMail("buyer@example.com", "hi", "b", {
        displayName: "x",
        email: "a@b.c\r\nBcc: z@example.com",
      })
    ).toThrow();
  });

  test("sender alias must exist and be verified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          sendAs: [
            { sendAsEmail: "nayoy2@gmail.com", isPrimary: true },
            {
              sendAsEmail: "Contact@Findable.co.kr",
              verificationStatus: "accepted",
              smtpMsa: { host: "smtp.improvmx.com" },
            },
            {
              sendAsEmail: "pending@findable.co.kr",
              verificationStatus: "pending",
            },
          ],
        }),
        { status: 200 }
      )
    );
    const aliases = await mail.listSenderAliases("token");
    expect(mail.findSenderAlias(aliases, "contact@findable.co.kr")).toEqual({
      displayName: "",
      email: "contact@findable.co.kr",
      smtpHost: "smtp.improvmx.com",
      verified: true,
    });
    expect(mail.findSenderAlias(aliases, "pending@findable.co.kr")).toBeNull();
    expect(mail.findSenderAlias(aliases, "other@findable.co.kr")).toBeNull();
  });

  test("only the drafts endpoint is called; never a send endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "draft-123" }), { status: 200 })
      );
    expect(
      await mail.createGoogleDraft("access", "buyer@example.com", "Hi", "Msg")
    ).toBe("draft-123");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts"
    );
  });

  test("no file under the outreach feature calls a Gmail send endpoint", () => {
    const roots = [
      "app/api/ax-mail",
      "lib/ax-mail",
      "app/(authenticated)/admin/ax-mail",
    ].map((p) => join(process.cwd(), p));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx)$/.test(name)) {
          files.push(path);
        }
      }
    };
    for (const root of roots) {
      walk(root);
    }
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/messages\/send|drafts\/send|gmail\.send/);
    }
    for (const route of ["google/connect", "google/callback", "drafts"]) {
      const source = readFileSync(
        join(process.cwd(), "app/api/ax-mail", route, "route.ts"),
        "utf8"
      );
      expect(source).toContain("isAdmin()");
      expect(source).toContain("orgId");
    }
  });
});

describe("lead readiness gate", () => {
  test("a measured prospect with an official contact is ready (citation observation)", () => {
    const r = outreach.leadReadiness(lead());
    expect(r.ready).toBe(true);
    expect(r.observation).toEqual({
      kind: "citation",
      answersWithCitations: 24,
      officialCited: 3,
    });
  });

  test("inbound leads (already in contact) are never cold-email ready", () => {
    const r = outreach.leadReadiness(lead({ track: "inbound" }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain("inbound");
  });

  test("missing contact / measurement / date block the draft", () => {
    expect(outreach.leadReadiness(lead({ contact: null })).blockers).toEqual([
      "no_contact",
    ]);
    expect(
      outreach.leadReadiness(lead({ measurement: null })).blockers
    ).toContain("not_measured");
    const base = lead().measurement;
    if (!base) {
      throw new Error("fixture");
    }
    expect(
      outreach.leadReadiness(
        lead({ measurement: { ...base, measuredOn: null } })
      ).blockers
    ).toContain("no_date");
  });

  test("when the two judges disagree (라운드랩 7 vs 24) the recognition number is not used", () => {
    const base = lead().measurement;
    if (!base) {
      throw new Error("fixture");
    }
    const disagree = lead({
      measurement: {
        ...base,
        productConfirmed: 7,
        hook: {
          label: "자연원료 기반 브랜드",
          labelCount: 8,
          independentCorrect: 24,
          excerpt: "Round Lab is a prominent Korean skincare brand",
          excerptEngine: "Gemini",
        },
      },
    });
    const r = outreach.leadReadiness(disagree);
    expect(r.blockers).toContain("judges_disagree");
    expect(r.observation?.kind).toBe("citation");
    expect(r.ready).toBe(true);
    const draft = outreach.composeOutreachDraft(disagree, r);
    expect(draft?.body).not.toContain("정확히 설명한 답변은 7개");
    expect(draft?.body).not.toContain("Round Lab is");
  });

  test("agreeing judges allow the recognition line with the verified excerpt", () => {
    const base = lead().measurement;
    if (!base) {
      throw new Error("fixture");
    }
    const agree = lead({
      measurement: {
        ...base,
        productConfirmed: 12,
        hook: {
          label: "AI 기술 자문",
          labelCount: 7,
          independentCorrect: 11,
          excerpt: "예시브랜드는 AI 기술 자문을 전문으로 하는 브랜드입니다.",
          excerptEngine: "Gemini",
        },
      },
    });
    const draft = outreach.composeOutreachDraft(agree);
    expect(draft?.body).toContain(
      "답변 32개 중 예시브랜드를 정확히 설명한 답변은 12개였습니다."
    );
    expect(draft?.body).toContain(
      '"예시브랜드는 AI 기술 자문을 전문으로 하는 브랜드입니다."'
    );
  });
});

describe("cold email draft", () => {
  test("uses only measured numbers, ad notice, unsubscribe line, no attachment wording", () => {
    const draft = outreach.composeOutreachDraft(lead());
    if (!draft) {
      throw new Error("draft expected");
    }
    expect(draft.recipient).toBe("marketing@example.com");
    expect(draft.subject.startsWith("(광고) 예시브랜드")).toBe(true);
    expect(outreach.hasAdNotice(draft.subject, draft.body)).toBe(true);
    expect(outreach.hasGuaranteeClaim(draft.body)).toBe(false);
    expect(draft.body).toContain("2026년 9월 29일, ChatGPT·Gemini·Claude");
    expect(draft.body).toContain(
      "출처 링크가 달린 답변 24개 중 공식 사이트(example.com)를 출처로 쓴 답변은 3개였습니다."
    );
    expect(draft.body).toContain("contact@findable.co.kr");
    expect(draft.body).not.toMatch(/첨부/);
    // 본문 속 모든 숫자는 측정값·날짜·서명에서만 나온다.
    const allowed = new Set(["2026", "9", "29", "32", "24", "3"]);
    for (const n of draft.body.match(/\d+/g) ?? []) {
      expect(allowed.has(n)).toBe(true);
    }
  });

  test("report link is used when issued, otherwise the email offers it on reply", () => {
    expect(outreach.composeOutreachDraft(lead())?.body).toContain(
      "회신 주시면 보내드리겠습니다"
    );
    expect(
      outreach.composeOutreachDraft(
        lead({ reportUrl: "https://findable.co.kr/r/abc" })
      )?.body
    ).toContain("https://findable.co.kr/r/abc");
  });

  test("guarantee claims and missing ad notices are detected", () => {
    expect(outreach.hasGuaranteeClaim("노출되면 매출이 오릅니다")).toBe(true);
    expect(outreach.hasGuaranteeClaim("효과를 보장합니다")).toBe(true);
    expect(outreach.hasAdNotice("안녕하세요", "수신거부")).toBe(false);
    expect(outreach.hasAdNotice("(광고) 안녕하세요", "본문")).toBe(false);
  });
});

describe("shipped lead snapshot", () => {
  const leads = outreach.loadLeads();

  test("contacts carry an official https source; no guessed personal addresses", () => {
    for (const l of leads) {
      if (!l.contact) {
        continue;
      }
      expect(new URL(l.contact.sourceUrl).protocol).toBe("https:");
      expect(l.contact.email).not.toMatch(/@(gmail|naver|daum|hanmail)\./);
    }
  });

  test("노우버스·TechDD are inbound, never offered as cold-email drafts", () => {
    for (const domain of ["www.knowverse.net", "dd.knowverse.net"]) {
      const l = leads.find((x) => x.domain === domain);
      expect(l?.track).toBe("inbound");
      if (l) {
        expect(outreach.composeOutreachDraft(l)).toBeNull();
      }
    }
  });

  test("every generated draft passes the server-side checks", () => {
    for (const l of leads) {
      const draft = outreach.composeOutreachDraft(l);
      if (draft) {
        expect(outreach.hasAdNotice(draft.subject, draft.body)).toBe(true);
        expect(outreach.hasGuaranteeClaim(draft.body)).toBe(false);
        expect(draft.recipient).toBe(l.contact?.email);
      }
    }
  });
});

describe("workbench renders", () => {
  test("server render shows the industry chips, a ready lead and no send button", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { LeadWorkbench } = await import(
      "@/app/(authenticated)/admin/ax-mail/lead-workbench"
    );
    const ko = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "../../packages/internationalization/dictionaries/ko.json"
        ),
        "utf8"
      )
    ).app.axMail;
    const leads = outreach.loadLeads().map((l) => {
      const readiness = outreach.leadReadiness(l);
      return {
        lead: l,
        readiness,
        draft: outreach.composeOutreachDraft(l, readiness),
        drafted: false,
      };
    });
    const html = renderToStaticMarkup(
      createElement(LeadWorkbench, {
        connectFailed: false,
        labels: ko,
        leads,
        sender: { kind: "not_connected" },
        senderEmail: "contact@findable.co.kr",
      })
    );
    expect(html).toContain("뷰티·소비재");
    expect(html).toContain("초안 가능");
    expect(html).toContain("Gmail 초안함에 저장");
    expect(html).toContain("정보통신망법 제50조 제1항");
    expect(html).not.toMatch(/>\s*(보내기|발송|Send)\s*</);
  });
});
