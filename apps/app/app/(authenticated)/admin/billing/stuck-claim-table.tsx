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
  type ReleaseOutcome,
  releaseStuckClaim,
  type StuckClaimRow,
} from "@/app/actions/admin/billing";

const OUTCOME_MESSAGE: Record<ReleaseOutcome, string> = {
  released: "선점을 해제했습니다.",
  already_released: "이미 해제된 선점입니다.",
  not_a_claim: "빌링키가 있는 구독이라 해제하지 않았습니다.",
  too_recent: "선점한 지 30분이 지나지 않아 해제하지 않았습니다.",
  paid_unrecorded:
    "PortOne 에서 결제 완료로 확인돼 해제하지 않았습니다. 조직 기록 복구가 필요합니다.",
  in_progress: "PortOne 에서 아직 결제 진행 중이라 해제하지 않았습니다.",
  lookup_failed:
    "PortOne 조회에 실패해 해제하지 않았습니다. 잠시 후 다시 시도해 주세요.",
};

// 🔴 영문 슬러그를 화면에 그대로 내보내지 않는다(/admin/ops 의 COST_BASIS_LABEL 과 같은 규칙).
const BILLING_STATUS_LABEL: Record<string, string> = {
  active: "구독 중",
  trialing: "체험",
  past_due: "갱신 실패 유예",
  canceled: "해지",
  expired: "만료",
};

const fmtDate = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(d))
    : "시각 미상";

export const StuckClaimTable = ({ claims }: { claims: StuckClaimRow[] }) => {
  const [rows, setRows] = useState<StuckClaimRow[]>(claims);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const release = (row: StuckClaimRow) => {
    setPendingId(row.organizationId);
    startTransition(async () => {
      try {
        const result = await releaseStuckClaim(row.organizationId);
        const message = OUTCOME_MESSAGE[result.outcome];
        if (result.ok) {
          toast.success(message);
          setRows((current) =>
            current.filter((r) => r.organizationId !== row.organizationId)
          );
        } else {
          toast.error(message);
        }
      } catch {
        toast.error("해제 요청에 실패했습니다.");
      } finally {
        setPendingId(null);
      }
    });
  };

  if (rows.length === 0) {
    return (
      <p className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
        30분 넘게 남은 선점이 없습니다.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>조직</TableHead>
          <TableHead>결제 ID</TableHead>
          <TableHead>선점 시각</TableHead>
          <TableHead>경과</TableHead>
          <TableHead>결제 상태</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.organizationId}>
            <TableCell>{row.organizationName}</TableCell>
            <TableCell className="font-mono text-xs">{row.paymentId}</TableCell>
            <TableCell>{fmtDate(row.claimedAt)}</TableCell>
            <TableCell>
              {row.ageMinutes === null ? "미상" : `${row.ageMinutes}분`}
            </TableCell>
            <TableCell>
              {BILLING_STATUS_LABEL[row.billingStatus] ?? "알 수 없음"}
            </TableCell>
            <TableCell className="text-right">
              <Button
                disabled={pendingId === row.organizationId}
                onClick={() => release(row)}
                size="sm"
                variant="outline"
              >
                {pendingId === row.organizationId ? "확인 중…" : "선점 해제"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
