import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 요금제 화면 "환불·청약철회 요청" 입력 + 관리자 목록 렌더 (2026-10-05).
 * 고객은 접수 확인과 3영업일 처리 안내를 보고, 관리자는 접수된 요청을 본다.
 * @vitest-environment jsdom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestRefund: vi.fn(),
  resolveRefundRequest: vi.fn(),
}));

vi.mock("@/app/actions/billing/refund-request", () => ({
  requestRefund: mocks.requestRefund,
}));
vi.mock("@/app/actions/admin/refund-requests", () => ({
  resolveRefundRequest: mocks.resolveRefundRequest,
}));

import { RefundRequestTable } from "../app/(authenticated)/admin/billing/refund-request-table";
import { RefundRequestForm } from "../app/(authenticated)/features/billing/refund-request";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("환불·청약철회 요청 폼", () => {
  it("요청을 보내면 접수 확인과 3영업일 처리 안내를 보여 준다", async () => {
    mocks.requestRefund.mockResolvedValue({ ok: true, status: "created" });
    render(<RefundRequestForm t={koDict.app.refundRequest} />);

    fireEvent.click(screen.getByRole("button", { name: "환불·청약철회 요청" }));
    fireEvent.change(screen.getByLabelText("요청 내용(선택)"), {
      target: { value: "결제 취소 원해요" },
    });
    fireEvent.click(screen.getByRole("button", { name: "요청 보내기" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("접수됐어요")
    );
    expect(screen.getByRole("status").textContent).toContain("3영업일");
    expect(mocks.requestRefund).toHaveBeenCalledWith({
      message: "결제 취소 원해요",
    });
  });

  it("이미 접수된 요청이 있으면 그렇게 알려 준다", async () => {
    mocks.requestRefund.mockResolvedValue({
      ok: true,
      status: "already_pending",
    });
    render(<RefundRequestForm t={koDict.app.refundRequest} />);
    fireEvent.click(screen.getByRole("button", { name: "환불·청약철회 요청" }));
    fireEvent.click(screen.getByRole("button", { name: "요청 보내기" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "이미 접수된 요청"
      )
    );
  });

  it("실패하면 오류 문구를 보여 준다", async () => {
    mocks.requestRefund.mockResolvedValue({
      ok: false,
      error: "요청을 저장하지 못했어요.",
    });
    render(<RefundRequestForm t={koDict.app.refundRequest} />);
    fireEvent.click(screen.getByRole("button", { name: "환불·청약철회 요청" }));
    fireEvent.click(screen.getByRole("button", { name: "요청 보내기" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "저장하지 못했어요"
      )
    );
  });
});

describe("관리자 환불 요청 목록", () => {
  it("접수된 요청을 조직·결제 ID·내용과 함께 보여 준다", () => {
    render(
      <RefundRequestTable
        requests={[
          {
            id: "req-1",
            organizationId: "org-1",
            organizationName: "테스트 조직",
            userId: "user_abc",
            paymentId: "fdbl-starter-abc-mg0x1a2b",
            message: "철회 요청",
            status: "pending",
            createdAt: new Date("2026-10-05T03:00:00.000Z"),
          },
        ]}
      />
    );
    expect(screen.getByText("테스트 조직")).toBeTruthy();
    expect(screen.getByText("fdbl-starter-abc-mg0x1a2b")).toBeTruthy();
    expect(screen.getByText("철회 요청")).toBeTruthy();
    expect(screen.getByText("처리 대기")).toBeTruthy();
  });

  it("요청이 없으면 빈 상태 문구", () => {
    render(<RefundRequestTable requests={[]} />);
    expect(
      screen.getByText("접수된 환불·청약철회 요청이 없습니다.")
    ).toBeTruthy();
  });
});

describe("관리자 환불 요청 — 처리 완료 버튼", () => {
  it("처리 대기 줄의 버튼을 누르면 처리 완료로 바뀌고 버튼이 사라진다", async () => {
    mocks.resolveRefundRequest.mockResolvedValue({
      ok: true,
      outcome: "resolved",
    });
    render(
      <RefundRequestTable
        requests={[
          {
            id: "req-1",
            organizationId: "org-1",
            organizationName: "테스트 조직",
            userId: "user_abc",
            paymentId: "fdbl-starter-abc-mg0x1a2b",
            message: "철회 요청",
            status: "pending",
            createdAt: new Date("2026-10-05T03:00:00.000Z"),
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "처리 완료" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "처리 완료" })).toBeNull()
    );
    expect(mocks.resolveRefundRequest).toHaveBeenCalledWith("req-1");
    expect(screen.getByText("처리 완료")).toBeTruthy();
  });

  it("이미 처리 완료된 줄에는 버튼이 없다", () => {
    render(
      <RefundRequestTable
        requests={[
          {
            id: "req-2",
            organizationId: "org-1",
            organizationName: "테스트 조직",
            userId: "user_abc",
            paymentId: null,
            message: null,
            status: "resolved",
            createdAt: new Date("2026-10-05T03:00:00.000Z"),
          },
        ]}
      />
    );
    expect(screen.queryByRole("button", { name: "처리 완료" })).toBeNull();
  });
});
