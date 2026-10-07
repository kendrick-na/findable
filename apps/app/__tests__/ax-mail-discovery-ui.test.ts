/** @vitest-environment node */
/**
 * 「회사 찾기」 화면(2026-10-07) — 안전장치 · 필터 연결 · 받는 사람별 초안.
 *
 *  ① 플래그 꺼짐이면 DB 를 아예 부르지 않고, 테이블 없음(P2021)은 500 이 아니라 「DB 준비 전」이 된다.
 *  ② URL 칩 → 세그먼트 필터 → Prisma where 가 끊기지 않고 이어진다(파이프라인 칸 포함).
 *  ③ 받는 사람 N명 → Gmail 초안 N건(주소마다 수신 근거 따로, 멱등 키 따로).
 *  ④ 서버액션·화면이 관리자 게이트와 플래그 게이트를 우회하지 않는다(소스 검사).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = {
  auditJob: { findMany: vi.fn() },
  company: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  salesLead: { findMany: vi.fn(), groupBy: vi.fn() },
  segment: { findMany: vi.fn() },
};
vi.mock("@repo/database", () => ({ database: db }));
vi.mock("@/lib/client-report/admin", () => ({
  approvedReportUrlByDomain: () => new Map(),
  bareDomain: (d: string) => d,
  listIssuedReports: () => Promise.resolve([]),
}));

const guard = await import("@/lib/ax-mail/discovery/guard");
const view = await import("@/lib/ax-mail/discovery/view");
const segmentQuery = await import("@/lib/ax-mail/discovery/segment-query");
const screen = await import("@/lib/ax-mail/discovery/screen");
const pipeline = await import("@/lib/ax-mail/discovery/pipeline");
const batch = await import("@/lib/ax-mail/draft-batch");
const draft = await import("@/lib/ax-mail/discovery/draft");
const leads = await import("@/lib/ax-mail/leads");
const runner = await import("@/lib/ax-mail/discovery/ingest-runner");
const { emptyDiscovered } = await import("@/lib/ax-mail/discovery/types");

const ON = { SALES_DISCOVERY_ENABLED: "true" };
const OFF = {};
const REPORT_URL = `https://www.findable.co.kr/r/${"A".repeat(43)}`;

function missingTable(): Error {
  return Object.assign(new Error("The table `public.Company` does not exist"), {
    code: "P2021",
  });
}

describe("① 안전장치 — 플래그 · 테이블 없음", () => {
  test("SALES_DISCOVERY_ENABLED 는 true/1 일 때만 켜진다(기본 꺼짐)", () => {
    expect(guard.salesDiscoveryEnabled(OFF)).toBe(false);
    expect(guard.salesDiscoveryEnabled({ SALES_DISCOVERY_ENABLED: "" })).toBe(
      false
    );
    expect(
      guard.salesDiscoveryEnabled({ SALES_DISCOVERY_ENABLED: "false" })
    ).toBe(false);
    expect(guard.salesDiscoveryEnabled({ SALES_DISCOVERY_ENABLED: "1" })).toBe(
      true
    );
    expect(
      guard.salesDiscoveryEnabled({ SALES_DISCOVERY_ENABLED: " TRUE " })
    ).toBe(true);
  });

  test("꺼져 있으면 DB 쪽 함수를 부르지 않는다", async () => {
    const run = vi.fn(() => Promise.resolve(1));
    expect(await guard.withDiscovery(run, OFF)).toEqual({ state: "disabled" });
    expect(run).not.toHaveBeenCalled();
  });

  test("P2021 · 42P01 · relation does not exist → db_not_ready (500 아님)", async () => {
    expect(
      await guard.withDiscovery(() => Promise.reject(missingTable()), ON)
    ).toEqual({ state: "db_not_ready" });
    expect(
      guard.isMissingTableError({
        code: "42P01",
        message: 'relation "Segment" does not exist',
      })
    ).toBe(true);
    expect(
      guard.isMissingTableError(new Error('relation "Company" does not exist'))
    ).toBe(true);
  });

  test("다른 오류는 숨기지 않고 그대로 던진다", async () => {
    await expect(
      guard.withDiscovery(
        () => Promise.reject(Object.assign(new Error("x"), { code: "P2002" })),
        ON
      )
    ).rejects.toThrow("x");
    expect(guard.isMissingTableError(null)).toBe(false);
    expect(guard.isMissingTableError("P2021")).toBe(false);
  });

  test("켜져 있고 테이블이 있으면 값을 돌려준다", async () => {
    expect(await guard.withDiscovery(() => Promise.resolve(7), ON)).toEqual({
      state: "ready",
      value: 7,
    });
  });
});

describe("② 필터 연결 — URL 칩 → 세그먼트 필터 → Prisma where", () => {
  test("URL 파싱은 허용 값만 남기고 순서를 고정한다", () => {
    const p = view.parseDiscoverParams({
      grow: "1",
      ind: "food,beauty,hacker",
      mail: "1",
      page: "3",
      reg: "서울,평양",
      site: "0",
      size: "500+,10-49",
      sort: "growth",
      stage: "mail",
      tag: "venture,listed,unknown",
      co: "../etc",
    });
    expect(p).toMatchObject({
      companyId: null,
      growing: true,
      hasMail: true,
      hasSite: false,
      industries: ["beauty", "food"],
      page: 3,
      regions: ["서울"],
      sizes: ["10-49", "500+"],
      sort: "growth",
      stage: "mail",
      tags: ["venture", "listed"],
    });
    expect(view.parseDiscoverParams({ sort: "x", page: "-2" })).toMatchObject({
      page: 1,
      sort: "employees",
      stage: null,
    });
  });

  test("칩 링크: 필터를 바꾸면 1쪽으로 가고 카드는 닫힌다, 쪽 이동은 유지", () => {
    const p = view.parseDiscoverParams({
      co: "abc-1",
      ind: "beauty",
      page: "2",
    });
    const href = view.discoverHref(p, {
      tags: view.toggle(p.tags, "venture"),
    });
    expect(href).toBe("/admin/ax-mail/discover?ind=beauty&tag=venture");
    expect(view.discoverHref(p, { page: 3 })).toBe(
      "/admin/ax-mail/discover?ind=beauty&page=3&co=abc-1"
    );
    // 링크 → 다시 파싱하면 같은 상태
    const back = view.parseDiscoverParams(
      Object.fromEntries(new URLSearchParams(href.split("?")[1]))
    );
    expect(back.tags).toEqual(["venture"]);
    expect(back.industries).toEqual(["beauty"]);
  });

  test("세그먼트 필터 위에 칩이 덧붙고, where 에 그대로 반영된다", () => {
    const p = view.parseDiscoverParams({
      grow: "1",
      mail: "1",
      reg: "경기",
      site: "1",
      tag: "commerce",
    });
    const filter = view.filterFromParams(p, {
      foundedFrom: 2015,
      industries: ["beauty"],
      regions: ["서울"],
    });
    expect(filter).toEqual({
      employeeGrowthMin: view.GROWING_MIN,
      foundedFrom: 2015,
      hasEmail: true,
      hasWebsite: true,
      industries: ["beauty"],
      regions: ["경기"],
      tagsAny: ["commerce"],
    });
    expect(segmentQuery.segmentFilterSchema.safeParse(filter).success).toBe(
      true
    );
    const where = JSON.stringify(segmentQuery.buildCompanyWhere(filter));
    for (const piece of [
      '"industry":{"in":["beauty"]}',
      '"region":{"in":["경기"]}',
      '"tags":{"hasSome":["commerce"]}',
      '"domain":{"not":null}',
      '"contacts":{"some":{"personalName":false}}',
      `"employeeGrowth":{"gte":${view.GROWING_MIN}}`,
    ]) {
      expect(where).toContain(piece);
    }
  });

  test("「성장 중」= 증가율 > 0 — 0% 와 감소는 빠진다", () => {
    const filter = view.filterFromParams(
      view.parseDiscoverParams({ grow: "1" }),
      null
    );
    const base = {
      businessNumber: null,
      corpRegNo: null,
      dartCorpCode: null,
      domain: null,
      employeeAsOf: null,
      employeeCount: 10,
      foundedYear: null,
      hasPublicEmail: false,
      id: "c",
      industry: null,
      industryCode: null,
      industryName: null,
      industrySource: null,
      lastMeasuredScore: null,
      legalName: "예시",
      matchConfidence: "exact",
      normalizedName: "예시",
      region: null,
      sources: [],
      tags: [],
    };
    expect(
      segmentQuery.matchesSegment({ ...base, employeeGrowth: 0.05 }, filter)
    ).toBe(true);
    expect(
      segmentQuery.matchesSegment({ ...base, employeeGrowth: 0 }, filter)
    ).toBe(false);
    expect(
      segmentQuery.matchesSegment({ ...base, employeeGrowth: -0.1 }, filter)
    ).toBe(false);
  });

  test("파이프라인 7칸 = 상태 10개를 빠짐없이 한 번씩 덮는다", () => {
    const covered = view.PIPELINE_GROUPS.flatMap((g) => g.statuses);
    expect([...covered].sort()).toEqual([...view.SALES_LEAD_STATUSES].sort());
    expect(
      view.pipelineCounts({ drafted: 2, sent: 3, won: 1, opted_out: 4 })
    ).toMatchObject({ closed: 5, found: 0, mail: 5 });
    expect(view.statusesOf("mail")).toEqual(["drafted", "sent"]);
  });

  test("자동 단계 이동은 앞으로만 — 답장·종료 리드를 되돌리지 않는다", () => {
    expect(view.shouldAdvance("found", "drafted")).toBe(true);
    expect(view.shouldAdvance("reported", "drafted")).toBe(true);
    expect(view.shouldAdvance("replied", "drafted")).toBe(false);
    expect(view.shouldAdvance("drafted", "drafted")).toBe(false);
    expect(view.shouldAdvance("lost", "drafted")).toBe(false);
  });

  describe("loadDiscoverScreen — 화면 상태가 조회에 그대로 들어간다", () => {
    beforeEach(() => {
      for (const group of Object.values(db)) {
        for (const fn of Object.values(group)) {
          fn.mockReset();
        }
      }
      db.auditJob.findMany.mockResolvedValue([]);
      db.segment.findMany.mockResolvedValue([
        {
          companyCount: 3,
          filter: { industries: ["food"] },
          id: "seg-1",
          name: "식품",
        },
      ]);
      db.company.count.mockResolvedValue(30);
      db.company.findMany.mockResolvedValue([
        {
          domain: "example.com",
          employeeCount: 12,
          employeeGrowth: 0.1,
          id: "c1",
          industry: "food",
          industrySource: "name",
          legalName: "예시식품",
          region: "서울",
          sources: ["nps"],
          tags: ["venture"],
        },
      ]);
      db.salesLead.groupBy.mockResolvedValue([
        { _count: { _all: 2 }, status: "found" },
        { _count: { _all: 1 }, status: "sent" },
      ]);
      db.salesLead.findMany.mockResolvedValue([
        { companyId: "c1", status: "found" },
      ]);
    });

    test("세그먼트 + 칩 + 단계 + 정렬 + 쪽", async () => {
      const params = view.parseDiscoverParams({
        page: "2",
        reg: "서울",
        seg: "seg-1",
        sort: "growth",
        stage: "mail",
      });
      const result = await screen.loadDiscoverScreen(params);
      const call = db.company.findMany.mock.calls[0][0];
      const where = JSON.stringify(call.where);
      expect(where).toContain('"industry":{"in":["food"]}');
      expect(where).toContain('"region":{"in":["서울"]}');
      expect(where).toContain(
        '"leads":{"some":{"status":{"in":["drafted","sent"]}}}'
      );
      expect(call.skip).toBe(view.PAGE_SIZE);
      expect(call.take).toBe(view.PAGE_SIZE);
      expect(call.orderBy[0]).toEqual({
        employeeGrowth: { nulls: "last", sort: "desc" },
      });
      expect(db.company.count.mock.calls[0][0].where).toEqual(call.where);
      expect(result.total).toBe(30);
      expect(result.companies[0]).toMatchObject({ id: "c1", status: "found" });
      expect(result.pipeline).toMatchObject({ found: 2, mail: 1 });
      expect(result.segmentInvalid).toBe(false);
    });

    test("저장된 필터가 깨진 세그먼트는 칩만 적용하고 그 사실을 알린다", async () => {
      db.segment.findMany.mockResolvedValue([
        { companyCount: null, filter: { bogus: 1 }, id: "seg-2", name: "x" },
      ]);
      const result = await screen.loadDiscoverScreen(
        view.parseDiscoverParams({ seg: "seg-2" })
      );
      expect(result.segmentInvalid).toBe(true);
      expect(db.company.findMany.mock.calls[0][0].where).toEqual({});
    });

    test("테이블이 없으면 P2021 이 올라와 guard 가 db_not_ready 로 바꾼다", async () => {
      db.segment.findMany.mockRejectedValue(missingTable());
      expect(
        await guard.withDiscovery(
          () => screen.loadDiscoverScreen(view.parseDiscoverParams({})),
          ON
        )
      ).toEqual({ state: "db_not_ready" });
    });
  });
});

describe("③ 받는 사람별 초안 — N명 → Gmail 초안 N건", () => {
  const basisA = {
    date: "2026-10-07",
    detail:
      "https://example.com/contact 에 공개된 회사 메일(partner@example.com)",
    kind: "public_contact" as const,
  };
  const basisB = {
    date: "2026-10-06",
    detail:
      "https://example.com/global 에 공개된 회사 메일(global@example.com)",
    kind: "public_contact" as const,
  };

  function okFetch() {
    let n = 0;
    return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => {
      n++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            draftId: `d${n}`,
            sender: "contact@findable.co.kr",
            status: "created",
          }),
          { status: 201 }
        )
      );
    });
  }

  test("주소마다 1번씩, 각자의 수신 근거·멱등 키·영업 리드로 보낸다", async () => {
    const fetchImpl = okFetch();
    let k = 0;
    const keys = new Map<string, string>();
    const results = await batch.saveDraftsPerRecipient({
      body: "본문",
      fetchImpl,
      keys,
      leadId: "example.com",
      newKey: () => `key-${++k}`,
      recipients: [
        { basis: basisA, email: "partner@example.com" },
        { basis: basisB, email: "global@example.com" },
      ],
      salesLeadId: "11111111-1111-4111-8111-111111111111",
      subject: "제목",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map((c) =>
      JSON.parse(String(c[1]?.body))
    );
    expect(bodies.map((b) => b.recipient)).toEqual([
      "partner@example.com",
      "global@example.com",
    ]);
    expect(bodies.map((b) => b.contactBasis)).toEqual([basisA, basisB]);
    expect(new Set(bodies.map((b) => b.idempotencyKey)).size).toBe(2);
    expect(
      bodies.every((b) => b.salesLeadId && b.leadId === "example.com")
    ).toBe(true);
    expect(
      fetchImpl.mock.calls.every((c) => c[0] === "/api/ax-mail/drafts")
    ).toBe(true);
    expect(results.map((r) => [r.email, r.ok, r.draftId])).toEqual([
      ["partner@example.com", true, "d1"],
      ["global@example.com", true, "d2"],
    ]);
  });

  test("한 명이 실패해도 나머지는 계속, 다시 누르면 같은 키(중복 초안 방지)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "report_link_missing" }), {
          status: 422,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ draftId: "d2", sender: "contact@findable.co.kr" }),
          { status: 201 }
        )
      );
    const keys = new Map<string, string>();
    let k = 0;
    const input = {
      body: "본문",
      fetchImpl,
      keys,
      newKey: () => `key-${++k}`,
      recipients: [
        { basis: basisA, email: "partner@example.com" },
        { basis: basisB, email: "global@example.com" },
      ],
      subject: "제목",
    };
    const first = await batch.saveDraftsPerRecipient(input);
    expect(first.map((r) => r.ok)).toEqual([false, true]);
    expect(first[0].error).toBe("report_link_missing");
    const retryFetch = okFetch();
    await batch.saveDraftsPerRecipient({
      ...input,
      fetchImpl: retryFetch,
      recipients: [input.recipients[0]],
    });
    expect(
      JSON.parse(String(retryFetch.mock.calls[0][1]?.body)).idempotencyKey
    ).toBe("key-1");
  });

  test("다중 작성기 — 주소 목록과 「초안 N건 저장」이 보이고, 보내기 버튼은 없다", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { DraftComposer } = await import(
      "@/app/(authenticated)/admin/ax-mail/draft-composer"
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
    const html = renderToStaticMarkup(
      createElement(DraftComposer, {
        canSave: true,
        initialDraft: { body: "본문", recipient: "", subject: "제목" },
        labels: ko,
        recipients: [
          { basis: basisA, email: "partner@example.com" },
          { basis: basisB, email: "global@example.com" },
        ],
      })
    );
    expect(html).toContain("받는 사람 2명");
    expect(html).toContain("partner@example.com");
    expect(html).toContain("global@example.com");
    expect(html).toContain("Gmail 초안 2건 저장");
    expect(html).not.toMatch(/>\s*(보내기|발송|Send)\s*</);
    // 1명이면 기존 단일 작성기(수신 근거 입력칸)
    const single = renderToStaticMarkup(
      createElement(DraftComposer, {
        canSave: true,
        initialBasis: basisA,
        initialDraft: {
          body: "본문",
          recipient: "partner@example.com",
          subject: "제목",
        },
        labels: ko,
        recipients: [{ basis: basisA, email: "partner@example.com" }],
      })
    );
    expect(single).toContain("수신 근거 (필수)");
  });

  test("초안 뼈대 — 전송자·수신거부 안내는 항상, 리포트 링크 없으면 저장이 막힌다", () => {
    const without = draft.composeCompanyDraft({
      companyName: "예시상사",
      recipient: "partner@example.com",
      reportUrl: null,
    });
    expect(leads.hasSenderNotice(without.body)).toBe(true);
    expect(leads.hasReportLink(without.body)).toBe(false);
    expect(without.body).toContain(draft.REPORT_PLACEHOLDER);
    expect(leads.hasGuaranteeClaim(`${without.subject}\n${without.body}`)).toBe(
      false
    );
    const withLink = draft.composeCompanyDraft({
      companyName: "예시상사",
      recipient: "partner@example.com",
      reportUrl: REPORT_URL,
    });
    expect(leads.hasReportLink(withLink.body)).toBe(true);
    expect(withLink.body).toContain("예시상사가 ChatGPT");
  });

  test("초안 저장 뒤 영업 리드 기록 — 근거 행 추가 + drafted(앞으로만)", async () => {
    const fake = {
      companyContact: {
        findUnique: vi.fn().mockResolvedValue({ id: "contact-1" }),
      },
      contactBasis: { create: vi.fn().mockResolvedValue({}) },
      salesLead: {
        findUnique: vi.fn().mockResolvedValue({
          companyId: "c1",
          contactId: null,
          id: "lead-1",
          status: "found",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const input = {
      basis: basisA,
      recipient: "partner@example.com",
      salesLeadId: "lead-1",
      userId: "user_1",
    };
    // Prisma 위임 객체를 부분 가짜로 대신한다(테스트 전용).
    const asDb = fake as unknown as Parameters<
      typeof pipeline.recordSalesDraft
    >[0];
    expect(await pipeline.recordSalesDraft(asDb, input, OFF)).toBe("disabled");
    expect(fake.salesLead.findUnique).not.toHaveBeenCalled();

    expect(await pipeline.recordSalesDraft(asDb, input, ON)).toBe("recorded");
    expect(fake.contactBasis.create.mock.calls[0][0].data).toMatchObject({
      email: "partner@example.com",
      kind: "public_contact",
      leadId: "lead-1",
      recordedBy: "user_1",
    });
    expect(fake.salesLead.update.mock.calls[0][0].data).toMatchObject({
      contactId: "contact-1",
      status: "drafted",
    });

    fake.salesLead.update.mockClear();
    fake.companyContact.findUnique.mockResolvedValue(null);
    fake.salesLead.findUnique.mockResolvedValue({
      companyId: "c1",
      contactId: "contact-1",
      id: "lead-1",
      status: "replied",
    });
    await pipeline.recordSalesDraft(asDb, input, ON);
    expect(fake.salesLead.update).not.toHaveBeenCalled();

    fake.salesLead.findUnique.mockRejectedValue(missingTable());
    expect(await pipeline.recordSalesDraft(asDb, input, ON)).toBe(
      "db_not_ready"
    );
  });
});

describe("연락처 역할 라벨 · 사실 표시", () => {
  test("제휴/해외/대표/CS/개인정보", () => {
    expect(view.contactRoleLabel("partnership", "제휴 문의", "biz@x.com")).toBe(
      "partnership"
    );
    expect(view.contactRoleLabel("partnership", "해외 영업", "biz@x.com")).toBe(
      "overseas"
    );
    expect(view.contactRoleLabel("other", null, "global@x.com")).toBe(
      "overseas"
    );
    expect(view.contactRoleLabel("general", "대표메일", "info@x.com")).toBe(
      "general"
    );
    expect(view.contactRoleLabel("cs", null, "cs@x.com")).toBe("cs");
    expect(view.contactRoleLabel("privacy", "해외", "dpo@x.com")).toBe(
      "privacy"
    );
  });

  test("저장된 연락처 + 새로 찾은 후보 → 하나로, 기본 선택은 개인정보·사람이름 제외", () => {
    const merged = screen.mergeContacts(
      [
        {
          confidence: "high",
          email: "privacy@example.com",
          fetchedAt: new Date("2026-10-01T00:00:00Z"),
          label: "개인정보보호책임자",
          personalName: false,
          role: "privacy",
          sourceUrl: "https://example.com/privacy",
        },
        {
          confidence: "medium",
          email: "jane.kim@example.com",
          fetchedAt: new Date("2026-10-01T00:00:00Z"),
          label: null,
          personalName: true,
          role: "partnership",
          sourceUrl: "https://example.com/about",
        },
      ],
      [
        {
          confidence: "high",
          email: "partner@example.com",
          fetchedAt: "2026-10-07T01:00:00.000Z",
          label: "제휴 문의",
          personalName: false,
          role: "partnership",
          sameDomain: true,
          sourceUrl: "https://example.com/contact",
        },
      ]
    );
    const { contacts, defaultRecipients } = screen.contactViews(merged);
    expect(contacts.map((c) => c.email).sort()).toEqual([
      "jane.kim@example.com",
      "partner@example.com",
      "privacy@example.com",
    ]);
    expect(defaultRecipients).toEqual(["partner@example.com"]);
    const partner = contacts.find((c) => c.email === "partner@example.com");
    expect(partner?.basis).toMatchObject({
      date: "2026-10-07",
      kind: "public_contact",
    });
    expect(partner?.basis.detail).toContain("https://example.com/contact");
  });

  test("기본 정보 — (field, 원천)별 최신 1개, 같은 값은 한 줄 + 출처 여러 개", () => {
    const at = new Date("2026-10-07T00:00:00Z");
    const facts = screen.latestFacts([
      {
        asOf: "2026-05",
        field: "employeeCount",
        fetchedAt: at,
        source: "nps",
        value: { count: 10 },
      },
      {
        asOf: "2026-08",
        field: "employeeCount",
        fetchedAt: at,
        source: "nps",
        value: { count: 14 },
      },
      {
        asOf: "2026-05-21",
        field: "industry",
        fetchedAt: at,
        source: "venture",
        value: { code: null, name: "화장품 제조업" },
      },
      {
        asOf: "2026-09-30",
        field: "industry",
        fetchedAt: at,
        source: "ftc_mail_order",
        value: { code: null, name: "화장품 제조업" },
      },
      {
        asOf: "2026-09-30",
        field: "legalName",
        fetchedAt: at,
        source: "ftc_mail_order",
        value: "(주)예시",
      },
      {
        asOf: "2026-05-21",
        field: "legalName",
        fetchedAt: at,
        source: "venture",
        value: "㈜예시상사",
      },
      {
        asOf: "",
        field: "sourceRecord",
        fetchedAt: at,
        source: "venture",
        value: {},
      },
      {
        asOf: "",
        field: "subIndustry",
        fetchedAt: at,
        source: "venture",
        value: [{ basis: "name", id: "foodtech" }],
      },
    ]);
    // 업종은 원천 2곳이 같은 값 → 한 줄, 회사명은 값이 달라 두 줄(어느 쪽이 맞는지 정하지 않는다)
    expect(facts.map((f) => f.field).sort()).toEqual([
      "employeeCount",
      "industry",
      "legalName",
      "legalName",
    ]);
    expect(facts.find((f) => f.field === "employeeCount")).toMatchObject({
      sources: [{ asOf: "2026-08", source: "nps" }],
      value: "14",
    });
    const industry = facts.find((f) => f.field === "industry");
    expect(industry?.value).toBe("화장품 제조업");
    expect(industry?.sources.map((x) => x.source).sort()).toEqual([
      "ftc_mail_order",
      "venture",
    ]);
    const ko = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "../../packages/internationalization/dictionaries/ko.json"
        ),
        "utf8"
      )
    ).app.salesDiscover;
    // 공공저작물 출처표시(제1유형) — 벤처기업명단은 이 문구 그대로
    expect(ko.sources.venture).toBe("중소벤처기업부 벤처기업명단");
  });
});

describe("데이터 불러오기 — 원천별로 따로, 실패는 그 원천만", () => {
  function tinyStore() {
    let n = 0;
    const store: import("@/lib/ax-mail/discovery/ingest").CompanyStore = {
      create: (data) => Promise.resolve({ ...data, id: `c${++n}` }),
      findByBusinessNumber: () => Promise.resolve(null),
      findByNameRegion: () => Promise.resolve([]),
      listFacts: () => Promise.resolve([]),
      update: () => Promise.reject(new Error("unused")),
      upsertFact: () => Promise.resolve("created"),
    };
    return store;
  }

  test("키 없음(null)·오류는 그 원천만 표시하고 나머지는 적재한다", async () => {
    const results = await runner.runDiscoveryIngest(tinyStore(), {
      fsc: () => Promise.resolve(null),
      ftc_mail_order: () => Promise.reject(new Error("boom")),
      mfds: () =>
        Promise.resolve([
          { ...emptyDiscovered("mfds", "예시화장품"), region: "서울" },
        ]),
      nps: () => Promise.resolve([]),
      opendart: () => Promise.resolve(null),
    });
    expect(results.map((r) => [r.source, r.status, r.fetched])).toEqual([
      ["fsc", "unavailable", 0],
      ["nps", "ok", 0],
      ["mfds", "ok", 1],
      ["ftc_mail_order", "error", 0],
      ["opendart", "unavailable", 0],
    ]);
    expect(results[2].result?.created).toBe(1);
  });

  test("테이블 없음은 원천 오류로 삼키지 않고 위로 던진다", async () => {
    const store = tinyStore();
    store.create = () => Promise.reject(missingTable());
    await expect(
      runner.runDiscoveryIngest(
        store,
        {
          fsc: () => Promise.resolve([emptyDiscovered("fsc", "예시")]),
          ftc_mail_order: () => Promise.resolve(null),
          mfds: () => Promise.resolve(null),
          nps: () => Promise.resolve(null),
          opendart: () => Promise.resolve(null),
        },
        { sources: ["fsc"] }
      )
    ).rejects.toMatchObject({ code: "P2021" });
  });
});

describe("④ 게이트 — 관리자 · 플래그 (소스 검사)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  test("서버액션은 모두 첫 줄 requireAdmin(), DB 접근은 withDiscovery 안에서", () => {
    const source = read("app/actions/admin/sales-discovery.ts");
    // 함수마다 시그니처 끝(열 0에서 「{」로 끝나는 줄) 다음 줄 = 첫 문장
    const fns = source
      .split("export async function ")
      .slice(1)
      .map((chunk) => {
        const lines = chunk.split("\n");
        const end = lines.findIndex(
          (line, i) => (i === 0 || !line.startsWith(" ")) && line.endsWith("{")
        );
        return {
          first: lines[end + 1]?.trim() ?? "",
          name: chunk.slice(0, chunk.indexOf("(")),
        };
      });
    expect(fns.map((f) => f.name).sort()).toEqual([
      "addCompaniesToSalesList",
      "findCompanyContacts",
      "ingestDiscoverySources",
      "measureCompany",
      "saveSegment",
      "setSalesLeadStatus",
    ]);
    for (const f of fns) {
      expect(f.first, f.name).toMatch(/await requireAdmin\(\);$/);
    }
    // withDiscovery 밖에서 database 를 직접 부르지 않는다(영업 org 브랜드는 sales-org.ts)
    let outside = source;
    for (;;) {
      const start = outside.indexOf("withDiscovery(");
      if (start < 0) {
        break;
      }
      let depth = 0;
      let end = start + "withDiscovery".length;
      for (; end < outside.length; end++) {
        if (outside[end] === "(") {
          depth++;
        } else if (outside[end] === ")") {
          depth--;
          if (depth === 0) {
            break;
          }
        }
      }
      outside = outside.slice(0, start) + outside.slice(end + 1);
    }
    const dbCalls = [...outside.matchAll(/database\.(\w+)\./g)].map(
      (m) => m[1]
    );
    expect(dbCalls).toEqual([]);
  });

  test("측정은 영업 전용 org 브랜드 + 기존 관리자 1건 측정만 쓴다", () => {
    const source = read("app/actions/admin/sales-discovery.ts");
    expect(source).toContain("await runMeasureOne(brand.id)");
    expect(source).toContain("ensureSalesBrand(");
    // org 없으면 측정 전에 막는다
    expect(source.indexOf('error: "no_sales_org"')).toBeLessThan(
      source.indexOf("ensureSalesBrand(")
    );
    // 고객 org 의 등록·요금제 한도 경로를 부르지 않는다
    expect(source).not.toMatch(
      /assignBrandOwner|startOrgTracking|planCapabilities|runAuditJob|startMeasureOne/
    );
    const salesOrg = read("lib/ax-mail/discovery/sales-org.ts");
    const salesOrgCode = salesOrg
      .split("\n")
      .filter((line) => !line.trim().startsWith("*"))
      .join("\n");
    expect(salesOrgCode).not.toMatch(
      /planCapabilities|getCurrentPlan|brandLimit/
    );
  });

  test("화면은 관리자 아니면 notFound, 데이터는 withDiscovery 로만 읽는다", () => {
    const page = read("app/(authenticated)/admin/ax-mail/discover/page.tsx");
    expect(page).toMatch(/await isAdmin\(\)\)\)\) \{\n\s+notFound\(\);/);
    // 본문은 게이트 뒤에서만 그린다
    expect(page.indexOf("notFound()")).toBeLessThan(
      page.indexOf("<DiscoverScreen")
    );
    const body = read(
      "app/(authenticated)/admin/ax-mail/discover/discover-screen.tsx"
    );
    expect(body).toContain("withDiscovery(");
    expect(body).toContain('guarded.state === "disabled"');
    expect(body).toContain('guarded.state === "db_not_ready"');
  });

  test("초안 라우트 — 영업 리드 기록은 Gmail 초안 생성 뒤, 실패해도 응답을 바꾸지 않는다", () => {
    const route = read("app/api/ax-mail/drafts/route.ts");
    const created = route.indexOf("await createGoogleDraft(");
    const recorded = route.indexOf("await recordSalesDraftSafely(");
    expect(created).toBeGreaterThan(0);
    expect(recorded).toBeGreaterThan(created);
    expect(route).toContain("salesLeadId: z.uuid().optional()");
    expect(route).not.toMatch(/messages\/send|drafts\/send|gmail\.send/);
  });
});

describe("A. 세부 분야(sub-industry) — 규칙 · 필터 · 미분류 비율", () => {
  test("KSIC 코드 → 업종명 → 취급품목, 근거는 더 강한 쪽 하나", async () => {
    const sub = await import("@/lib/ax-mail/discovery/sub-industry");
    expect(sub.classifySubIndustries({ industryCode: "64191" })).toEqual([
      { basis: "ksic", id: "fintech" },
    ]);
    expect(
      sub.classifySubIndustries({
        industryCode: "68112",
        industryName: "비주거용 건물 임대업",
      })
    ).toEqual([{ basis: "ksic", id: "proptech" }]);
    expect(
      sub.classifySubIndustries({ industryName: "일반 화물 자동차 운송업" })
    ).toEqual([
      { basis: "name", id: "mobility" },
      { basis: "name", id: "logistics" },
    ]);
    expect(sub.classifySubIndustries({ products: "반려동물 간식" })).toEqual([
      { basis: "products", id: "pet" },
    ]);
    // 오탐 방지: 자동차 임대는 부동산이 아니고, 텔레마케팅은 광고가 아니다
    expect(
      sub
        .classifySubIndustries({ industryName: "자동차 임대업" })
        .map((v) => v.id)
    ).toEqual(["mobility"]);
    expect(
      sub.classifySubIndustries({
        industryName: "콜센터 및 텔레마케팅 서비스업",
      })
    ).toEqual([]);
    expect(sub.subIndustriesFromTags(["b2b", "sub:fintech", "sub:x"])).toEqual([
      "fintech",
    ]);
  });

  test("세부 분야 칩 → where 에 sub: 태그(하나라도), 메모리 판정도 같은 규칙", () => {
    const p = view.parseDiscoverParams({
      sub: "proptech,fintech,bogus",
      tag: "venture",
    });
    expect(p.subs).toEqual(["fintech", "proptech"]);
    expect(view.discoverHref(p, {})).toContain("sub=fintech%2Cproptech");
    const filter = view.filterFromParams(p, null);
    expect(filter.subIndustries).toEqual(["fintech", "proptech"]);
    expect(segmentQuery.segmentFilterSchema.safeParse(filter).success).toBe(
      true
    );
    const where = JSON.stringify(segmentQuery.buildCompanyWhere(filter));
    expect(where).toContain(
      '"tags":{"hasSome":["sub:fintech","sub:proptech"]}'
    );
    expect(where).toContain('"tags":{"hasSome":["venture"]}');
    const base = {
      businessNumber: null,
      corpRegNo: null,
      dartCorpCode: null,
      domain: null,
      employeeAsOf: null,
      employeeCount: null,
      employeeGrowth: null,
      foundedYear: null,
      hasPublicEmail: false,
      id: "c",
      industry: null,
      industryCode: null,
      industryName: null,
      industrySource: null,
      lastMeasuredScore: null,
      legalName: "예시",
      matchConfidence: "exact",
      normalizedName: "예시",
      region: null,
      sources: [],
    };
    expect(
      segmentQuery.matchesSegment(
        { ...base, tags: ["venture", "sub:proptech"] },
        filter
      )
    ).toBe(true);
    expect(
      segmentQuery.matchesSegment(
        { ...base, tags: ["venture", "sub:game"] },
        filter
      )
    ).toBe(false);
  });

  test("미분류 비율(업종명 표본 100개) — 63% → 20%", async () => {
    const { INDUSTRY_NAME_SAMPLE } = await import(
      "./fixtures/industry-name-sample"
    );
    const { classifyIndustry } = await import(
      "@/lib/ax-mail/discovery/taxonomy"
    );
    const sub = await import("@/lib/ax-mail/discovery/sub-industry");
    let before = 0;
    let after = 0;
    for (const name of INDUSTRY_NAME_SAMPLE) {
      const { industry } = classifyIndustry({ industryName: name });
      const unclassified = industry === null || industry === "other";
      if (unclassified) {
        before++;
        if (sub.classifySubIndustries({ industryName: name }).length === 0) {
          after++;
        }
      }
    }
    expect(INDUSTRY_NAME_SAMPLE).toHaveLength(100);
    expect(before).toBe(63);
    expect(after).toBe(20);
  });
});

describe("B. 바깥 링크 — http/https 만, 새 탭", () => {
  test("도메인·주소 정규화와 위험한 스킴 차단", () => {
    expect(view.safeExternalUrl("sample.co.kr")).toBe("https://sample.co.kr/");
    expect(view.safeExternalUrl("www.sample.co.kr/about?x=1")).toBe(
      "https://www.sample.co.kr/about?x=1"
    );
    expect(view.safeExternalUrl("http://sample.co.kr/contact")).toBe(
      "http://sample.co.kr/contact"
    );
    expect(view.safeExternalUrl("//sample.co.kr")).toBe(
      "https://sample.co.kr/"
    );
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,x",
      "mailto:a@b.com",
      "ftp://sample.co.kr",
      "https://user:pw@sample.co.kr",
      "not a url",
      "localhost",
      "",
      null,
    ]) {
      expect(view.safeExternalUrl(bad), String(bad)).toBeNull();
    }
  });

  test("링크 부품은 새 탭 + noopener noreferrer, 카드·표가 그것을 쓴다", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const link = read(
      "app/(authenticated)/admin/ax-mail/discover/external-link.tsx"
    );
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain("safeExternalUrl(href)");
    const card = read(
      "app/(authenticated)/admin/ax-mail/discover/company-card.tsx"
    );
    const table = read(
      "app/(authenticated)/admin/ax-mail/discover/company-table.tsx"
    );
    expect(card).toContain("<ExternalLink href={company.domain}>");
    expect(card).toContain("href={contact.sourceUrl}");
    expect(table).toContain("<ExternalLink href={row.domain}>");
    // 날 URL 을 그대로 href 에 끼워 넣는 곳이 없다
    expect(card).not.toContain("href={`https://");
  });
});

describe("C. 단계 자동 이동 · 법률 안내", () => {
  test("측정 완료 → measured, 리포트 발송 승인 → reported, 앞으로만", async () => {
    const fake = {
      auditJob: {
        findMany: vi.fn().mockResolvedValue([
          { domain: "www.measured.example", id: "job-m" },
          { domain: "both.example", id: "job-b" },
        ]),
      },
      salesLead: {
        findMany: vi.fn().mockResolvedValue([
          {
            company: { domain: "measured.example" },
            id: "l1",
            status: "found",
          },
          { company: { domain: "both.example" }, id: "l2", status: "found" },
          {
            company: { domain: "nothing.example" },
            id: "l3",
            status: "found",
          },
          {
            company: { domain: "both.example" },
            id: "l4",
            status: "measured",
          },
          { company: { domain: null }, id: "l5", status: "found" },
        ]),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const now = new Date("2026-10-07T05:00:00Z");
    const result = await pipeline.syncLeadStages(
      fake as unknown as Parameters<typeof pipeline.syncLeadStages>[0],
      (ids) => {
        // 영업 회차 id 만 넘어온다 → 그 회차의 리포트만 쓴다
        expect([...ids].sort()).toEqual(["job-b", "job-m"]);
        return new Map([["both.example", REPORT_URL]]);
      },
      now
    );
    expect(result).toEqual({ measured: 1, reported: 2 });
    // 조회는 found·measured 리드만(답장·미팅·종료는 대상 아님)
    expect(fake.salesLead.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ["found", "measured"] },
    });
    expect(fake.auditJob.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: "f1dab1e0-5a1e-4000-8000-00000000a001",
      status: "completed",
    });
    expect(fake.salesLead.update.mock.calls.map((c) => c[0].where.id)).toEqual([
      "l2",
      "l4",
    ]);
    expect(fake.salesLead.update.mock.calls[0][0].data).toMatchObject({
      reportUrl: REPORT_URL,
      status: "reported",
    });
    expect(fake.salesLead.updateMany.mock.calls[0][0]).toEqual({
      data: { status: "measured", statusChangedAt: now },
      where: { id: { in: ["l1"] }, status: "found" },
    });
  });

  test("「영업 실행」 법률 안내에 4번째 근거(공개 회사 메일·KISA 전화 확인)가 ko·en 모두 있다", () => {
    const dict = (lang: string) =>
      JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            `../../packages/internationalization/dictionaries/${lang}.json`
          ),
          "utf8"
        )
      ).app.axMail.legalBody as string;
    expect(dict("ko")).toContain("④");
    expect(dict("ko")).toContain("KISA");
    expect(dict("ko")).toContain("2026-10-07");
    expect(dict("en")).toContain("(4)");
    expect(dict("en")).toContain("KISA");
    expect(dict("en")).toContain("2026-10-07");
  });
});

describe("D. 영업 전용 내부 조직(우리 DB 에만)", () => {
  test("env·Clerk 조회 없이 고정 id 로 만들고, 화면에서 [측정]을 막지 않는다", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const salesOrg = read("lib/ax-mail/discovery/sales-org.ts");
    expect(salesOrg).toContain("SALES_INTERNAL_ORG_ID");
    expect(salesOrg).not.toMatch(
      /clerkClient|SALES_DISCOVERY_ORG_ID|process\.env/
    );
    const screenSrc = read(
      "app/(authenticated)/admin/ax-mail/discover/discover-screen.tsx"
    );
    expect(screenSrc).not.toContain("measureEnabled");
    const action = read("app/actions/admin/sales-discovery.ts");
    expect(action).toContain("await ensureSalesOrg(adminId)");
  });
});
