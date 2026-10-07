/** @vitest-environment node */
/**
 * 「회사 찾기」 화면 개선 P1·P2(2026-10-08 대표 승인) — 새 조건 창 · 맨 위 파이프라인 · 다음 할 일 · 칩 정리 · 표 행 · 0건.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const view = await import("@/lib/ax-mail/discovery/view");
const sub = await import("@/lib/ax-mail/discovery/sub-industry");
const segmentQuery = await import("@/lib/ax-mail/discovery/segment-query");
const ko = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      "../../packages/internationalization/dictionaries/ko.json"
    ),
    "utf8"
  )
).app.salesDiscover;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DIR = "app/(authenticated)/admin/ax-mail/discover";

describe("P1 새 조건 창 — 이름만, 조건은 지금 칩에서", () => {
  test("JSON 입력 칸이 없고, 조건은 filterFromParams 로 자동", () => {
    const src = read(`${DIR}/segment-bar.tsx`);
    expect(src).not.toMatch(/Textarea|JSON\.parse/);
    expect(src).toContain(
      "const filter = filterFromParams(params, asFilter(currentFilter));"
    );
    expect(src).toContain("disabled={pending || !name.trim() || empty}");
  });

  test("저장할 조건을 사람 말로 요약한다", () => {
    const p = view.parseDiscoverParams({
      grow: "1",
      ind: "beauty",
      reg: "서울",
      size: "10-49",
      sub: "fintech",
    });
    expect(view.conditionSummary(p, ko, "수도권")).toEqual([
      "수도권",
      "업종: 뷰티",
      "세부 분야: 핀테크·금융",
      "지역: 서울",
      "직원 수: 10~49명",
      "조건: 성장 중",
    ]);
  });
});

describe("P1 파이프라인 — 맨 위 한 줄, 지금 조건 기준", () => {
  test("필터·표보다 위에 있다", () => {
    const src = read(`${DIR}/discover-screen.tsx`);
    expect(src.indexOf("<PipelineBar")).toBeGreaterThan(0);
    expect(src.indexOf("<PipelineBar")).toBeLessThan(src.indexOf("<FilterBar"));
  });

  test("숫자는 지금 조건(where)으로 센다", () => {
    expect(read("lib/ax-mail/discovery/screen.ts")).toContain(
      "where: { company: { is: buildCompanyWhere(filter) } }"
    );
  });
});

describe("P1 카드 「다음 할 일」 — 측정 → 리포트 승인 → 메일 초안", () => {
  test("단계 판정", async () => {
    // 순수 판정만 쓰려고 카드 모듈의 서버액션 import 를 가짜로 바꾼다
    vi.doMock("@/app/actions/admin/sales-discovery", () => ({}));
    const { nextStepOf } = await import(`@/${DIR}/company-card`);
    const base = {
      lastJob: null,
      lead: null,
      reportUrl: null,
    };
    expect(nextStepOf(base)).toBe("measure");
    expect(nextStepOf({ ...base, lastJob: { status: "processing" } })).toBe(
      "measuring"
    );
    expect(nextStepOf({ ...base, lastJob: { status: "failed" } })).toBe(
      "measure_failed"
    );
    expect(nextStepOf({ ...base, lastJob: { status: "completed" } })).toBe(
      "report"
    );
    expect(
      nextStepOf({
        ...base,
        lastJob: { status: "completed" },
        reportUrl: "https://www.findable.co.kr/r/x",
      })
    ).toBe("draft");
    expect(
      nextStepOf({
        ...base,
        lead: { id: "l", status: "drafted" },
        reportUrl: "https://www.findable.co.kr/r/x",
      })
    ).toBe("done");
  });

  test("카드 맨 위(헤더 바로 아래)에 있고, 리포트 발행 화면을 다시 만들지 않는다", () => {
    const src = read(`${DIR}/company-card.tsx`);
    const header = src.indexOf("<CardHeader");
    const next = src.indexOf("<NextStep\n");
    const facts = src.indexOf("<Facts card={card}");
    expect(header).toBeGreaterThan(0);
    expect(next).toBeGreaterThan(header);
    expect(facts).toBeGreaterThan(next);
    expect(src).not.toMatch(/IssueForm|issueClientReport/);
  });

  test("기본 정보 출처는 「출처 보기」로 접혀 있다(표시 자체는 남아 있음)", () => {
    const src = read(`${DIR}/company-card.tsx`);
    expect(src).toContain("useState(false)");
    expect(src).toContain("{showSources && (");
    expect(src).toContain("labels.sourcesShow");
  });
});

describe("P2 칩 정리", () => {
  test("「커머스」 태그는 세부 분야 하나로 합쳤다(두 태그 다 찾는다)", () => {
    expect(view.DISCOVER_TAGS).not.toContain("commerce");
    expect(sub.subFilterTags("commerce_platform")).toEqual([
      "sub:commerce_platform",
      "commerce",
    ]);
    const where = JSON.stringify(
      segmentQuery.buildCompanyWhere({ subIndustries: ["commerce_platform"] })
    );
    expect(where).toContain(
      '"tags":{"hasSome":["sub:commerce_platform","commerce"]}'
    );
    expect(sub.subIndustriesFromTags(["commerce"])).toEqual([
      "commerce_platform",
    ]);
  });

  test("세부 분야는 접어 두고(고른 게 있으면 펼침), 조건 줄을 따로 둔다 — 칩 줄 5개", () => {
    const src = read(`${DIR}/filter-bar.tsx`);
    expect(src).toContain("defaultOpen={params.subs.length > 0}");
    expect(src).toContain("labels.filterConditions");
    // 칩 줄: 업종(+펼치기) · 태그 · 지역 · 직원 수 · 조건
    expect(src.match(/<Row label=/g)?.length).toBe(5); // 세부 분야(접힘) 1 + 태그·지역·직원 수·조건 4
    expect(ko.subToggleOpen.replace("{count}", "21")).toBe(
      "세부 분야 21개 펼치기"
    );
  });
});

describe("P2 표 행 · 0건", () => {
  test("표 행에는 출처 배지가 없다(카드에만)", () => {
    const src = read(`${DIR}/company-table.tsx`);
    expect(src).not.toContain("row.sources");
    expect(read(`${DIR}/company-card.tsx`)).toContain("company.sources.map");
  });

  test("0건이면 「조건 지우기」 버튼", () => {
    const src = read(`${DIR}/company-table.tsx`);
    expect(src).toContain('data-testid="empty-clear"');
    expect(read(`${DIR}/discover-screen.tsx`)).toContain(
      "hasChips(params) ? discoverHref(params, CLEAR_CHIPS) : null"
    );
  });
});
