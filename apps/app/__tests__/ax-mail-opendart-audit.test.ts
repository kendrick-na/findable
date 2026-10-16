/** @vitest-environment node */
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

const audit = await import("@/lib/ax-mail/sources/opendart-audit");

/*
 * 픽스처 = 2026-10-16 실측 DART 감사보고서(주식회사 비나우, 접수 20260331002615)의
 * 손익계산서 머리·매출액 행을 옮긴 것(공시 금액·사업연도만, 원문 재배포 아님).
 */
const statement = (unit: string, rows: string) =>
  "<TITLE>손 익 계 산 서</TITLE><P>제 8(당) 기 2025년 01월 01일부터 2025년 12월 31일까지</P>" +
  "<P>제 7(전) 기 2024년 01월 01일부터 2024년 12월 31일까지</P><P>주식회사 비나우와 그 종속기업</P>" +
  `<P>(단위 : ${unit})</P><TR><TD>과목</TD><TD>주석</TD><TD>제 8(당) 기</TD><TD>제 7(전) 기</TD></TR>${rows}`;

const ROW_WITH_NOTE =
  "<TR><TD>매출액</TD><TD>23</TD><TD>324,958,207,706</TD><TD>266,431,203,386</TD></TR>" +
  "<TR><TD>매출원가</TD><TD>9,24,26</TD><TD>110,920,845,663</TD><TD>85,695,171,072</TD></TR>";

describe("parseAuditRevenueAmount", () => {
  test("당기 매출만 읽고 주석 번호(23)를 금액으로 착각하지 않는다", () => {
    expect(audit.parseAuditRevenueAmount(statement("원", ROW_WITH_NOTE))).toBe(
      324_958_207_706
    );
  });

  test("주석 칸이 없어도 읽는다", () => {
    const rows =
      "<TR><TD>매출액</TD><TD>266,431,203,386</TD><TD>1,000</TD></TR>";
    expect(audit.parseAuditRevenueAmount(statement("원", rows))).toBe(
      266_431_203_386
    );
  });

  test("단위 천원·백만원은 원으로 환산한다", () => {
    const rows = "<TR><TD>매출액</TD><TD>316,579</TD><TD>1,000</TD></TR>";
    expect(audit.parseAuditRevenueAmount(statement("천원", rows))).toBe(
      316_579_000
    );
    expect(audit.parseAuditRevenueAmount(statement("백만원", rows))).toBe(
      316_579_000_000
    );
  });

  test("단위를 못 읽으면 null(추정 금지)", () => {
    const text = statement("원", ROW_WITH_NOTE).replace("(단위 : 원)", "");
    expect(audit.parseAuditRevenueAmount(text)).toBeNull();
    expect(
      audit.parseAuditRevenueAmount(statement("달러", ROW_WITH_NOTE))
    ).toBeNull();
  });

  test("허용 목록에 없는 계정명이면 null", () => {
    const rows = "<TR><TD>판매수입</TD><TD>324,958,207,706</TD></TR>";
    expect(audit.parseAuditRevenueAmount(statement("원", rows))).toBeNull();
  });

  test("손익계산서가 없으면 null", () => {
    expect(
      audit.parseAuditRevenueAmount("<P>재무상태표 매출채권 1,000</P>")
    ).toBeNull();
  });
});

describe("parseAuditReportList", () => {
  const list = {
    list: [
      {
        rcept_dt: "20260331",
        rcept_no: "A",
        report_nm: "감사보고서 (2025.12)",
      },
      {
        rcept_dt: "20260331",
        rcept_no: "B",
        report_nm: "연결감사보고서 (2025.12)",
      },
      {
        rcept_dt: "20250331",
        rcept_no: "C",
        report_nm: "연결감사보고서 (2024.12)",
      },
      {
        rcept_dt: "20260401",
        rcept_no: "D",
        report_nm: "사업보고서 (2025.12)",
      },
      { rcept_dt: "20260401", rcept_no: "E", report_nm: "감사보고서" },
    ],
    status: "000",
  };

  test("감사보고서만, 최신 사업연도 → 연결 우선 순서로", () => {
    expect(
      audit.parseAuditReportList(list).map((r) => [r.receiptNo, r.fsDiv])
    ).toEqual([
      ["B", "CFS"],
      ["A", "OFS"],
      ["C", "CFS"],
    ]);
  });

  test("데이터 없음(013)이면 빈 목록", () => {
    expect(audit.parseAuditReportList({ status: "013" })).toEqual([]);
  });
});
