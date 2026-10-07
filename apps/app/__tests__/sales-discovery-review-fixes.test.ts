/** @vitest-environment node */
/**
 * 독립 검수(2026-10-07) 흐름 버그 수정 — 확인 창 · 쉬운 실패 문구 · 빈 조건 · 진행 중 새로 고침 · 발송 금지 주소 · 접근성.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const view = await import("@/lib/ax-mail/discovery/view");
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

describe("[측정] 확인 창", () => {
  test("문구: 실제 질문 · 운영 실측 평균, 최근 측정이 있으면 N일 전", async () => {
    const { measureConfirmText } = await import(`@/${DIR}/measure-text`);
    const now = new Date("2026-10-08T03:00:00Z");
    expect(measureConfirmText(ko, null, now)).toBe(
      "측정할까요?\n\nAI 6곳에 실제로 질문합니다 · 1회 평균 약 621원(운영 실측)"
    );
    expect(
      measureConfirmText(ko, "2026-10-05T03:00:00Z", now).split("\n")[0]
    ).toBe("3일 전 측정 있음 — 다시 측정할까요?");
    expect(
      measureConfirmText(ko, "2026-10-08T01:00:00Z", now).split("\n")[0]
    ).toBe("오늘 측정 있음 — 다시 측정할까요?");
  });

  test("버튼은 확인을 받은 뒤에만 서버액션을 부른다", () => {
    const src = read(`${DIR}/measure-button.tsx`);
    expect(src.indexOf("window.confirm(")).toBeGreaterThan(0);
    expect(src.indexOf("window.confirm(")).toBeLessThan(
      src.indexOf("await measureCompany(")
    );
  });

  test("실패하면 기술 원문 대신 쉬운 문구(원문은 서버 로그로만)", async () => {
    const { measureMessage } = await import(`@/${DIR}/measure-text`);
    expect(measureMessage(ko, { error: "failed", ok: false })).toBe(
      ko.measureFailed
    );
    const action = read("app/actions/admin/sales-discovery.ts");
    expect(action).toContain('log.warn("admin.sales_discovery.measure_failed"');
    expect(action).not.toMatch(/error: "failed", message: run\.error/);
  });

  test("영업 회차 날짜만 쓴다(표: lastSalesMeasuredAt · 카드: 영업 lastJob)", () => {
    expect(read(`${DIR}/company-table.tsx`)).toContain(
      "lastMeasuredAt={row.lastSalesMeasuredAt}"
    );
    expect(read("lib/ax-mail/discovery/screen.ts")).toContain(
      'organizationId: SALES_INTERNAL_ORG_ID,\n          status: "completed",'
    );
  });
});

describe("빈 조건 · 회사 수", () => {
  test("칩을 하나도 고르지 않은 {} 는 빈 조건", () => {
    expect(view.isEmptyFilter({})).toBe(true);
    expect(view.isEmptyFilter({ industries: [], tagsAny: [] })).toBe(true);
    expect(view.isEmptyFilter({ hasWebsite: true })).toBe(false);
    expect(view.isEmptyFilter({ industries: ["beauty"] })).toBe(false);
  });

  test("서버가 빈 조건을 거절하고, 저장·수정 뒤 회사 수를 채운다", () => {
    const action = read("app/actions/admin/sales-discovery.ts");
    expect(action).toContain('return { ok: false, error: "empty_filter" }');
    expect(action).toContain(
      "await refreshSegmentCompanies(database, segmentId)"
    );
  });
});

describe("카드 흐름", () => {
  const card = read(`${DIR}/company-card.tsx`);

  test("측정 진행 중이면 주기적으로 새로 가져오고, 끝나면 멈춘다", () => {
    expect(card).toContain('card.lastJob?.status === "queued"');
    expect(card).toContain("setInterval(() => router.refresh(), POLL_MS)");
    expect(card).toContain("return () => clearInterval(timer)");
  });

  test("영업 목록 자동 추가가 실패해도 카드 안 문구로만", () => {
    expect(card).toContain("setDraftError(labels.errors.unexpected)");
  });

  test("개인정보보호책임자 주소는 체크할 수 없고 받는 사람에서도 빠진다", () => {
    expect(card).toContain('disabled={contact.role === "privacy"}');
    expect(card).toContain('selected.has(c.email) && c.role !== "privacy"');
  });
});

describe("접근성 · 문구", () => {
  test("링크 칩은 aria-pressed 대신 aria-current", () => {
    for (const f of [
      "filter-bar.tsx",
      "pipeline-bar.tsx",
      "segment-bar.tsx",
      "company-table.tsx",
    ]) {
      const src = read(`${DIR}/${f}`);
      expect(src, f).not.toContain("aria-pressed");
      expect(src, f).toContain("aria-current");
    }
  });

  test("제목 음수 자간 없음 · FORBIDDEN 대신 쉬운 문구", () => {
    expect(read(`${DIR}/discover-screen.tsx`)).not.toContain("tracking-tight");
    expect(ko.errors.unexpected).not.toMatch(/FORBIDDEN/);
    for (const f of [
      "company-card.tsx",
      "company-table.tsx",
      "ingest-button.tsx",
      "segment-bar.tsx",
      "measure-button.tsx",
    ]) {
      expect(read(`${DIR}/${f}`), f).toContain("labels.errors.unexpected");
    }
  });
});
