/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mail = await import("@/lib/ax-mail/google");
const outreach = await import("@/lib/ax-mail/leads");
const basisLib = await import("@/lib/ax-mail/contact-basis");
type Lead = import("@/lib/ax-mail/leads").Lead;

/** 테스트 기준 시각 — 2026-10-06 (KST 정오). */
const NOW = new Date("2026-10-06T03:00:00Z");
/** ⚠️ 가짜 리포트 링크(형식만 맞춘 자리표시자) — 실제 발행본 아님. */
const REPORT_URL = `https://www.findable.co.kr/r/${"A".repeat(43)}`;

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
      contactBasis: {
        kind: "business_card",
        detail: "코엑스 뷰티 박람회 부스에서 직접 받음",
        date: "2026-09-20",
      },
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
    reportUrl: REPORT_URL,
    ...overrides,
  };
}

function measurement() {
  const base = lead().measurement;
  if (!base) {
    throw new Error("fixture");
  }
  return base;
}

function draftOf(l: Lead) {
  const draft = outreach.composeOutreachDraft(
    l,
    outreach.leadReadiness(l, NOW)
  );
  if (!draft) {
    throw new Error("draft expected");
  }
  return draft;
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
  test("a measured prospect with contact basis + report link is ready (citation observation)", () => {
    const r = outreach.leadReadiness(lead(), NOW);
    expect(r.ready).toBe(true);
    expect(r.composable).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.observation).toEqual({
      kind: "citation",
      answersWithCitations: 24,
      officialCited: 3,
    });
  });

  test("inbound leads (already in contact) are never cold-email ready", () => {
    const r = outreach.leadReadiness(lead({ track: "inbound" }), NOW);
    expect(r.ready).toBe(false);
    expect(r.composable).toBe(false);
    expect(r.blockers).toContain("inbound");
  });

  test("missing contact / measurement / date block the draft", () => {
    expect(
      outreach.leadReadiness(lead({ contact: null }), NOW).blockers
    ).toEqual(["no_contact", "no_contact_basis"]);
    expect(
      outreach.leadReadiness(lead({ measurement: null }), NOW).blockers
    ).toContain("not_measured");
    expect(
      outreach.leadReadiness(
        lead({ measurement: { ...measurement(), measuredOn: null } }),
        NOW
      ).blockers
    ).toContain("no_date");
  });

  test("no published report link → blocked, no draft (no link, no draft)", () => {
    for (const reportUrl of [
      null,
      "https://findable.co.kr/r/abc",
      `https://preview.example.com/r/${"A".repeat(43)}`,
    ]) {
      const l = lead({ reportUrl });
      const r = outreach.leadReadiness(l, NOW);
      expect(r.blockers).toContain("no_report");
      expect(r.composable).toBe(false);
      expect(outreach.composeOutreachDraft(l, r)).toBeNull();
    }
  });

  test("missing contact basis blocks saving but the draft text is still shown", () => {
    const base = lead().contact;
    if (!base) {
      throw new Error("fixture");
    }
    const l = lead({ contact: { ...base, contactBasis: null } });
    const r = outreach.leadReadiness(l, NOW);
    expect(r.blockers).toEqual(["no_contact_basis"]);
    expect(r.ready).toBe(false);
    expect(r.composable).toBe(true);
    expect(outreach.composeOutreachDraft(l, r)).not.toBeNull();
  });

  test("contact basis rules: empty / future → missing, existing customer > 6 months → expired", () => {
    const ok = (
      kind:
        | "business_card"
        | "requested"
        | "existing_customer"
        | "public_contact"
    ) => ({ kind, detail: "근거", date: "2026-09-01" }) as const;
    expect(basisLib.contactBasisProblem(null, NOW)).toBe("missing");
    expect(
      basisLib.contactBasisProblem({ ...ok("requested"), detail: "  " }, NOW)
    ).toBe("missing");
    expect(
      basisLib.contactBasisProblem(
        { ...ok("requested"), date: "2026-02-30" },
        NOW
      )
    ).toBe("missing");
    expect(
      basisLib.contactBasisProblem(
        { ...ok("requested"), date: "2026-10-07" },
        NOW
      )
    ).toBe("missing");
    expect(basisLib.contactBasisProblem(ok("business_card"), NOW)).toBeNull();
    // 2026-10-07 KISA 구두 확인 — 공개 문의 메일도 근거로 인정, (광고) 표기 없음
    expect(basisLib.contactBasisProblem(ok("public_contact"), NOW)).toBeNull();
    expect(basisLib.subjectForBasis("(광고) 제목", "public_contact")).toBe(
      "제목"
    );
    expect(
      basisLib.contactBasisProblem(ok("existing_customer"), NOW)
    ).toBeNull();
    // 거래 2026-04-06 → 6개월 = 2026-10-06 (오늘까지 유효), 2026-04-05 → 만료
    expect(
      basisLib.contactBasisProblem(
        { ...ok("existing_customer"), date: "2026-04-06" },
        NOW
      )
    ).toBeNull();
    expect(
      basisLib.contactBasisProblem(
        { ...ok("existing_customer"), date: "2026-04-05" },
        NOW
      )
    ).toBe("expired");
    // 명함·요청 근거는 기간 제한이 없다
    expect(
      basisLib.contactBasisProblem(
        { ...ok("business_card"), date: "2025-01-01" },
        NOW
      )
    ).toBeNull();

    const base = lead().contact;
    if (!base) {
      throw new Error("fixture");
    }
    const expired = lead({
      contact: {
        ...base,
        contactBasis: {
          kind: "existing_customer",
          detail: "2026년 3월 진단 계약",
          date: "2026-03-01",
        },
      },
    });
    expect(outreach.leadReadiness(expired, NOW).blockers).toEqual([
      "no_contact_basis",
    ]);
  });

  test("when the two judges disagree (라운드랩 7 vs 24) the recognition number is not used", () => {
    const disagree = lead({
      measurement: {
        ...measurement(),
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
    const r = outreach.leadReadiness(disagree, NOW);
    expect(r.blockers).toContain("judges_disagree");
    expect(r.observation?.kind).toBe("citation");
    expect(r.ready).toBe(true);
    const draft = outreach.composeOutreachDraft(disagree, r);
    expect(draft?.body).not.toContain("정확히 소개한 답변은 7번");
    expect(draft?.body).not.toContain("Round Lab is");
  });

  test("agreeing judges allow the recognition line", () => {
    const agree = lead({
      measurement: {
        ...measurement(),
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
    expect(draftOf(agree).body).toContain(
      "- ChatGPT·Gemini·Claude에 예시브랜드를 32번 물었고, 정확히 소개한 답변은 12번이었습니다."
    );
  });
});

/** 프란츠 유사 예시(측정값은 테스트용 가상 수치). */
function franzLike(overrides: Partial<Lead> = {}): Lead {
  return lead({
    id: "franz.example",
    brand: "프란츠",
    brandEn: "FRANZ",
    company: "확인 필요",
    domain: "franz.example",
    measurement: {
      measuredOn: "2026-10-01",
      answers: 40,
      engines: ["claude", "Perplexity", "gemini", "ChatGPT"],
      productConfirmed: 9,
      answersWithCitations: 30,
      officialCited: 4,
      hook: {
        label: "비건 스킨케어",
        labelCount: 5,
        independentCorrect: 10,
        excerpt: null,
        excerptEngine: null,
      },
      entityConfusion: {
        query: "Franz",
        queryLanguage: "en",
        otherEntity: "같은 이름의 메신저 앱",
        engines: ["ChatGPT", "Gemini", "Claude", "Perplexity"],
      },
    },
    ...overrides,
  });
}

describe("sales email template", () => {
  test("Franz-like lead: hooked subject, ordered engines, finding sentence", () => {
    const draft = draftOf(franzLike());
    expect(draft.subject).toBe(
      "프란츠 AI 검색 진단 결과 공유드립니다 (ChatGPT 오인식 확인)"
    );
    expect(draft.body.startsWith("안녕하세요, 프란츠 마케팅 담당자님.\n")).toBe(
      true
    );
    expect(draft.body).toContain(
      "최근 고객들이 화장품을 고를 때 ChatGPT 같은 AI에 먼저 묻는 경우가 늘고 있어,\n프란츠가 AI에서 어떻게 소개되는지 직접 확인해 보았습니다."
    );
    expect(draft.body).toContain(
      "- ChatGPT·Gemini·Claude·Perplexity에 프란츠를 40번 물었고, 정확히 소개한 답변은 9번이었습니다."
    );
    expect(draft.body).toContain(
      '- 영어로 "Franz"를 물으면 네 곳 모두 같은 이름의 메신저 앱을 소개했습니다.'
    );
    expect(draft.body).toContain(
      `답변 원문과 개선 방향은 아래 링크에 정리해 두었습니다.\n${REPORT_URL}`
    );
    expect(draft.body).toContain(
      "나현덕 드림\nFindable 대표 | www.findable.co.kr"
    );
  });

  test("partial confusion names the engines instead of 「모두」", () => {
    const base = franzLike().measurement;
    if (!base?.entityConfusion) {
      throw new Error("fixture");
    }
    const draft = draftOf(
      franzLike({
        measurement: {
          ...base,
          entityConfusion: {
            ...base.entityConfusion,
            engines: ["gemini", "openai"],
          },
        },
      })
    );
    expect(draft.body).toContain(
      '- 영어로 "Franz"를 물으면 ChatGPT·Gemini에서는 같은 이름의 메신저 앱을 소개했습니다.'
    );
    expect(draft.subject).toContain("(ChatGPT 오인식 확인)");
  });

  test("category omission → 「AI 답변 누락 확인」 hook + leader impact line", () => {
    const l = lead({
      category: {
        questions: 50,
        answers: 474,
        mentioned: 0,
        leaders: [{ brand: "코스알엑스", mentioned: 183 }],
      },
    });
    const draft = draftOf(l);
    expect(draft.subject).toBe(
      "예시브랜드 AI 검색 진단 결과 공유드립니다 (AI 답변 누락 확인)"
    );
    expect(draft.body).toContain(
      "- 브랜드명을 넣지 않은 구매 질문 50개(답변 474개)에서는 예시브랜드가 한 번도 언급되지 않았습니다."
    );
    expect(draft.body).toContain(
      "영향\n- 같은 구매 질문의 답변 474개 중 183개에는 코스알엑스가 언급됐습니다."
    );
  });

  test("no hook → subject without parentheses; no data → no finding / impact section", () => {
    const draft = draftOf(lead());
    expect(draft.subject).toBe("예시브랜드 AI 검색 진단 결과 공유드립니다");
    expect(draft.body).toContain(
      "- ChatGPT·Gemini·Claude에 예시브랜드를 32번 물었고, 출처가 달린 답변 24번 중 공식 사이트(example.com)를 출처로 쓴 답변은 3번이었습니다.\n\n답변 원문과"
    );
    expect(draft.body).not.toContain("영향");
    expect(draft.body).not.toContain("매출");
  });

  test("revenue line only with a confirmed annual revenue; 72.6억 → 월 약 4천만 원", () => {
    expect(outreach.readableMonthlyAmount((7_260_000_000 * 0.07) / 12)).toBe(
      "4천만 원"
    );
    expect(outreach.readableMonthlyAmount(135_000_000)).toBe("1억 원");
    expect(outreach.readableMonthlyAmount(2_600_000_000)).toBe("30억 원");
    expect(outreach.readableMonthlyAmount(9_600_000)).toBe("1천만 원");
    expect(outreach.readableMonthlyAmount(3_400_000)).toBe("3백만 원");
    expect(outreach.readableMonthlyAmount(500_000)).toBeNull();

    expect(outreach.monthlyAiInfluencedRevenue(lead())).toBeNull();
    expect(
      outreach.monthlyAiInfluencedRevenue(
        lead({ annualRevenue: { krw: 7_260_000_000, source: "" } })
      )
    ).toBeNull();
    const withRevenue = franzLike({
      annualRevenue: { krw: 7_260_000_000, source: "DART 2025 감사보고서" },
    });
    expect(draftOf(withRevenue).body).toContain(
      "영향\n- 저희 추정으로는 프란츠 매출 중 월 약 4천만 원 규모가 AI 추천을 거쳐 결정되고 있습니다."
    );
    expect(draftOf(franzLike()).body).not.toContain("매출");
  });

  test("tone: no emoji, no divider lines, no markdown bold, no attachment, no guarantee", () => {
    for (const l of [
      lead(),
      franzLike({
        annualRevenue: { krw: 7_260_000_000, source: "DART 2025 감사보고서" },
      }),
    ]) {
      const { subject, body } = draftOf(l);
      expect(`${subject}\n${body}`).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(body).not.toMatch(/^\s*[-—─=_*]{2,}\s*$/m);
      expect(body).not.toContain("**");
      expect(body).not.toMatch(/첨부/);
      expect(outreach.hasGuaranteeClaim(`${subject}\n${body}`)).toBe(false);
    }
  });

  test("opt-out footer: sender name + contact email + KO/EN opt-out line", () => {
    const { body } = draftOf(lead());
    expect(body).toContain(
      "보낸 사람: Findable(인디고차일드) · contact@findable.co.kr"
    );
    expect(body).toContain(
      "더 이상 연락을 원치 않으시면 이 메일에 '수신거부'라고 회신해 주세요."
    );
    expect(body).toContain(outreach.UNSUBSCRIBE_LINE_EN);
    expect(outreach.hasSenderNotice(body)).toBe(true);
    expect(outreach.hasReportLink(body)).toBe(true);
  });

  test("every number in the body comes from the measurement (or the fixed 15-minute ask)", () => {
    const { body } = draftOf(lead());
    const allowed = new Set(["32", "24", "3", "15"]);
    for (const n of body.replace(REPORT_URL, "").match(/\d+/g) ?? []) {
      expect(allowed.has(n)).toBe(true);
    }
  });

  test("existing customer basis keeps the (광고) subject label; others drop it", () => {
    const base = lead().contact;
    if (!base) {
      throw new Error("fixture");
    }
    const existing = lead({
      contact: {
        ...base,
        contactBasis: {
          kind: "existing_customer",
          detail: "2026년 8월 진단 계약",
          date: "2026-08-10",
        },
      },
    });
    expect(draftOf(existing).subject).toBe(
      "(광고) 예시브랜드 AI 검색 진단 결과 공유드립니다"
    );
    expect(basisLib.subjectForBasis("(광고) 제목", "requested")).toBe("제목");
    expect(basisLib.subjectForBasis("제목", "existing_customer")).toBe(
      "(광고) 제목"
    );
    expect(basisLib.hasAdLabel("(광고) 제목")).toBe(true);
  });

  test("server-side checks detect missing notices / links / guarantee claims", () => {
    expect(outreach.hasGuaranteeClaim("노출되면 매출이 오릅니다")).toBe(true);
    expect(outreach.hasGuaranteeClaim("효과를 보장합니다")).toBe(true);
    expect(outreach.hasSenderNotice("수신거부")).toBe(false);
    expect(outreach.hasSenderNotice("contact@findable.co.kr")).toBe(false);
    expect(outreach.hasReportLink("https://www.findable.co.kr/r/abc")).toBe(
      false
    );
    expect(outreach.hasReportLink(`링크\n${REPORT_URL}\n`)).toBe(true);
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
        expect(
          outreach.composeOutreachDraft({ ...l, reportUrl: REPORT_URL })
        ).toBeNull();
      }
    }
  });

  test("every generated draft passes the server-side checks", () => {
    let drafts = 0;
    for (const snapshotLead of leads) {
      const l = { ...snapshotLead, reportUrl: REPORT_URL };
      const draft = outreach.composeOutreachDraft(
        l,
        outreach.leadReadiness(l, NOW)
      );
      if (draft) {
        drafts += 1;
        expect(outreach.hasSenderNotice(draft.body)).toBe(true);
        expect(outreach.hasReportLink(draft.body)).toBe(true);
        expect(outreach.hasGuaranteeClaim(draft.body)).toBe(false);
        expect(draft.body).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(draft.recipient).toBe(l.contact?.email);
      }
    }
    expect(drafts).toBeGreaterThan(0);
  });
});

describe("workbench renders", () => {
  test("server render shows chips, the contact-basis blocker + inputs, and no send button", async () => {
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
    const leads = outreach.loadLeads().map((snapshotLead) => {
      const l = { ...snapshotLead, reportUrl: REPORT_URL };
      const readiness = outreach.leadReadiness(l, NOW);
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
    expect(html).toContain("수신 근거 입력 필요");
    expect(html).toContain(ko.blockerNoContactBasis);
    expect(html).toContain("수신 근거 (필수)");
    expect(html).toContain("명함을 직접 받음");
    expect(html).toContain("Gmail 초안함에 저장");
    expect(html).toContain("정보통신망법 제50조 제1항");
    expect(html).not.toMatch(/>\s*(보내기|발송|Send)\s*</);
  });
});
