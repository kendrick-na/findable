"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { toast } from "@repo/design-system/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { useState, useTransition } from "react";
import {
  type RefundRequestRow,
  type ResolveRefundRequestResult,
  resolveRefundRequest,
} from "@/app/actions/admin/refund-requests";

// 🔴 영문 슬러그를 화면에 그대로 내보내지 않는다(stuck-claim-table 과 같은 규칙).
const STATUS_LABEL: Record<RefundRequestRow["status"], string> = {
  pending: "처리 대기",
  resolved: "처리 완료",
};

const OUTCOME_MESSAGE: Record<ResolveRefundRequestResult["outcome"], string> = {
  resolved: "처리 완료로 표시했습니다.",
  already_resolved: "이미 처리 완료된 요청입니다.",
  not_found: "요청을 찾을 수 없습니다.",
  failed: "처리 완료 표시에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(d));

export const RefundRequestTable = ({
  requests,
}: {
  requests: RefundRequestRow[];
}) => {
  const [rows, setRows] = useState<RefundRequestRow[]>(requests);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const resolve = (row: RefundRequestRow) => {
    setPendingId(row.id);
    startTransition(async () => {
      try {
        const result = await resolveRefundRequest(row.id);
        const message = OUTCOME_MESSAGE[result.outcome];
        if (result.ok) {
          toast.success(message);
          setRows((current) =>
            current.map((r) =>
              r.id === row.id ? { ...r, status: "resolved" } : r
            )
          );
        } else {
          toast.error(message);
        }
      } catch {
        toast.error(OUTCOME_MESSAGE.failed);
      } finally {
        setPendingId(null);
      }
    });
  };

  if (rows.length === 0) {
    return (
      <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        접수된 환불·청약철회 요청이 없습니다.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>접수</TableHead>
          <TableHead>조직</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>마지막 결제 ID</TableHead>
          <TableHead>요청 내용</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap">
              {fmtDate(r.createdAt)}
            </TableCell>
            <TableCell>
              <span>{r.organizationName ?? r.organizationId}</span>
              <span className="block text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
                {r.userId}
              </span>
            </TableCell>
            <TableCell>{STATUS_LABEL[r.status]}</TableCell>
            <TableCell className="font-mono text-xs">
              {r.paymentId ?? "없음(1회 결제는 PortOne 에서 확인)"}
            </TableCell>
            <TableCell className="max-w-xs whitespace-pre-wrap text-xs">
              {r.message ?? "—"}
            </TableCell>
            <TableCell className="text-right">
              {r.status === "pending" && (
                <Button
                  disabled={pendingId === r.id}
                  onClick={() => resolve(r)}
                  size="sm"
                  variant="outline"
                >
                  {pendingId === r.id ? "저장 중…" : "처리 완료"}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
