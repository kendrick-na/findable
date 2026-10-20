/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ic = await import("@/lib/ax-mail/discovery/identity-check");
const leads = await import("@/lib/ax-mail/leads");
type FactInput = import("@/lib/ax-mail/discovery/ingest").FactInput;

const RESULT = {
  dartBizNoTail4: "4640",
  dartCorpCode: "00123456",
  homepageBizNoTails: ["4640"],
  homepageStatus: "ok" as const,
  level: "confirmed" as const,
  pagesRead: 2,
  reasons: ["name_match", "homepage_biz_no_match"],
};
const AT = new Date("2026-10-21T00:00:00Z");

describe("동일성 저장 — 끝 4자리·멱등·대조 전 표시", () => {
  test("① 저장 한 줄: field/source/sourceRef/asOf 가 맞고, 같은 날 재확인은 같은 키", () => {
    const f = ic.identityFactFor(RESULT, "2026-10-21", AT);
    expect(f.field).toBe("identity");
    expect(f.source).toBe("identity_check");
    expect(f.sourceRef).toBe("00123456");
    expect(f.asOf).toBe("2026-10-21");
    const again = ic.identityFactFor(
      { ...RESULT, level: "mismatch" },
      "2026-10-21",
      AT
    );
    expect(`${again.field}|${again.source}|${again.asOf}`).toBe(
      `${f.field}|${f.source}|${f.asOf}`
    );
  });

  test("② 사업자번호는 끝 4자리만 — 전체 번호가 값 어디에도 없다", () => {
    const f = ic.identityFactFor(
      {
        ...RESULT,
        dartBizNoTail4: ic.tailOf("8330187017"),
        homepageBizNoTails: [ic.tailOf("8330187017") as string],
      },
      "2026-10-21",
      AT
    );
    const raw = JSON.stringify(f.value);
    expect(raw).toContain("7017");
    expect(raw).not.toContain("833018");
    expect(raw).not.toContain("8330187017");
    expect(ic.tailOf("833-01-87017")).toBe("7017");
    expect(ic.tailOf(null)).toBeNull();
  });

  test("③ identity 없음 → 대조 전(unchecked), 매출 문장은 막힌다", () => {
    expect(ic.identityStateOf([])).toBe("unchecked");
    const lead = {
      annualRevenue: { krw: 12_152_511_976, source: "DART 감사보고서(2025)" },
      brand: "(주)파이온텍",
      brandEn: null,
      company: "(주)파이온텍",
      revenueIdentity: null,
    } as unknown as import("@/lib/ax-mail/leads").Lead;
    expect(leads.monthlyAiInfluencedRevenue(lead)).toBeNull();
  });

  test("④ confirmed 저장 후 읽으면 confirmed, 재확인(같은 날)은 최신 값으로 갱신", () => {
    const facts = [
      {
        field: "identity",
        source: "identity_check",
        asOf: "2026-10-20",
        value: { level: "name_only" },
      },
      {
        field: "identity",
        source: "identity_check",
        asOf: "2026-10-21",
        value: { level: "confirmed" },
      },
    ];
    expect(ic.identityStateOf(facts)).toBe("confirmed");
    const lead = {
      annualRevenue: { krw: 12_152_511_976, source: "DART 감사보고서(2025)" },
      brand: "(주)파이온텍",
      brandEn: null,
      company: "(주)파이온텍",
      revenueIdentity: ic.identityStateOf(facts),
    } as unknown as import("@/lib/ax-mail/leads").Lead;
    expect(leads.monthlyAiInfluencedRevenue(lead)).not.toBeNull();
  });
});

describe("대조 흐름 — 가짜 홈페이지·저장으로 검사", () => {
  const base = {
    checkedOn: "2026-10-21",
    dart: { bizNo: "8330187017", corpCode: "00123456" },
    fetchedAt: AT,
    judge: (tails: string[]) =>
      tails.includes("7017")
        ? { level: "confirmed" as const, reasons: ["homepage_biz_no_match"] }
        : { level: "name_only" as const, reasons: ["name_match"] },
  };

  test("① 같은 날 재확인은 저장 키가 같아 갱신된다(대상 1줄 유지)", async () => {
    const saved = new Map<string, FactInput>();
    const save = (f: FactInput): Promise<void> => {
      saved.set(`${f.field}|${f.source}|${f.asOf}`, f);
      return Promise.resolve();
    };
    const readHomepage = async () => ({
      bizTails: ["7017"],
      pagesRead: 2,
      status: "ok" as const,
    });
    await ic.checkOneIdentity({ ...base, readHomepage, save });
    await ic.checkOneIdentity({
      ...base,
      readHomepage: async () => ({
        bizTails: [],
        pagesRead: 1,
        status: "ok" as const,
      }),
      save,
    });
    expect(saved.size).toBe(1);
    expect((saved.values().next().value as FactInput).value).toMatchObject({
      level: "name_only",
    });
  });

  test("홈페이지에서 번호를 못 찾으면 name_only 로 두고 매출은 막힌다", async () => {
    const r = await ic.checkOneIdentity({
      ...base,
      readHomepage: async () => ({
        bizTails: [],
        pagesRead: 3,
        status: "ok" as const,
      }),
      save: () => Promise.resolve(),
    });
    expect(r.level).toBe("name_only");
    expect(
      ic.identityStateOf([
        {
          field: "identity",
          source: "identity_check",
          asOf: "2026-10-21",
          value: { level: r.level },
        },
      ])
    ).toBe("name_only");
  });
});

describe("⑤ 여러 곳 대조 — 예산 초과 시 partial, 이어서 처리", () => {
  test("예산이 다 되면 멈추고, 이어서 하면 남은 회사를 처리한다", async () => {
    const { runWithinBudget } = await import("@repo/observability/time-budget");
    const { createTimeBudget } = await import(
      "@repo/observability/time-budget"
    );
    const clock = { t: 0 };
    const companies = ["a", "b", "c", "d", "e"];
    const done: string[] = [];
    const worker = (name: string): Promise<string> => {
      clock.t += 1000;
      done.push(name);
      return Promise.resolve(name);
    };
    const budget = createTimeBudget(2500, { now: () => clock.t });
    const first = await runWithinBudget(companies, budget, worker, {
      now: () => clock.t,
    });
    expect(first.stoppedBy).toBe("budget");
    expect(first.nextIndex).not.toBeNull();
    const budget2 = createTimeBudget(60_000, { now: () => clock.t });
    const second = await runWithinBudget(companies, budget2, worker, {
      now: () => clock.t,
      startIndex: first.nextIndex ?? 0,
    });
    expect(second.stoppedBy).toBe("complete");
    expect(new Set(done).size).toBe(companies.length);
  });
});
