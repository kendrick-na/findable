"use client";

import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { toast } from "@repo/design-system/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@repo/design-system/components/ui/tabs";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useMemo, useState, useTransition } from "react";
import { approvePartner, rejectPartner } from "@/app/actions/partner/decide";
import type { PartnerApplicationRow } from "@/app/actions/partner/query";

type StatusFilter = "pending" | "approved" | "rejected";
type Row = PartnerApplicationRow;

const STATUS_LABEL: Record<StatusFilter, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "거절",
};

const StatusBadge = ({ status }: { status: Row["status"] }) => {
  if (status === "approved") {
    return <Badge variant="default">승인됨</Badge>;
  }
  if (status === "rejected") {
    return <Badge variant="destructive">거절됨</Badge>;
  }
  return <Badge variant="secondary">대기 중</Badge>;
};

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

export const PartnerReviewTable = ({
  applications,
}: {
  applications: Row[];
}) => {
  const [rows, setRows] = useState<Row[]>(applications);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // 거절 다이얼로그 대상 + 사유 입력.
  const [rejectTarget, setRejectTarget] = useState<Row | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === "pending").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    }),
    [rows]
  );

  const visible = useMemo(
    () => rows.filter((r) => r.status === filter),
    [rows, filter]
  );

  const setStatus = (
    id: string,
    status: StatusFilter,
    note?: string | null
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status, note: note ?? r.note, decidedAt: new Date() }
          : r
      )
    );
  };

  const onApprove = (row: Row) => {
    const prev = row.status;
    setStatus(row.id, "approved"); // 낙관적
    setPendingId(row.id);
    startTransition(async () => {
      const result = await approvePartner(row.id);
      setPendingId(null);
      if ("error" in result) {
        setStatus(row.id, prev); // 롤백
        toast.error(result.error);
        return;
      }
      if ("warning" in result) {
        toast.warning(result.warning);
        return;
      }
      toast.success("승인했어요. 파트너 접근(Growth)이 부여됐습니다.");
    });
  };

  const openReject = (row: Row) => {
    setRejectTarget(row);
    setRejectNote("");
  };

  const confirmReject = () => {
    const row = rejectTarget;
    if (!row) {
      return;
    }
    const note = rejectNote.trim() || undefined;
    const prev = row.status;
    setStatus(row.id, "rejected", note ?? null); // 낙관적
    setPendingId(row.id);
    setRejectTarget(null);
    startTransition(async () => {
      const result = await rejectPartner(row.id, note);
      setPendingId(null);
      if ("error" in result) {
        setStatus(row.id, prev);
        toast.error(result.error);
        return;
      }
      toast.success("거절 처리했어요.");
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs onValueChange={(v) => setFilter(v as StatusFilter)} value={filter}>
        <TabsList>
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <TabsTrigger key={s} value={s}>
              {STATUS_LABEL[s]} ({counts[s]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-10 text-center text-[color:var(--findable-ink-subtle,#8a8f98)]">
          {filter === "pending"
            ? "대기 중인 신청이 없어요."
            : `${STATUS_LABEL[filter]} 상태의 신청이 없어요.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[color:var(--findable-hairline,#23252a)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>신청자</TableHead>
                <TableHead>사유</TableHead>
                <TableHead>신청일</TableHead>
                <TableHead>상태</TableHead>
                {filter === "pending" ? (
                  <TableHead className="text-right">처리</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)]">
                        {row.name ?? "이름 미상"}
                      </span>
                      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
                        {row.email ?? row.userId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {row.reason ? (
                      <span className="text-[color:var(--findable-ink-muted,#d0d6e0)] text-sm">
                        {row.reason}
                      </span>
                    ) : (
                      <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm italic">
                        사유 미입력
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
                    {fmtDate(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  {filter === "pending" ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          disabled={pendingId === row.id}
                          onClick={() => openReject(row)}
                          size="sm"
                          variant="outline"
                        >
                          거절
                        </Button>
                        <Button
                          className="findable-btn-primary"
                          disabled={pendingId === row.id}
                          onClick={() => onApprove(row)}
                          size="sm"
                        >
                          승인
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        onOpenChange={(o) => !o && setRejectTarget(null)}
        open={rejectTarget !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>신청 거절</DialogTitle>
            <DialogDescription>
              거절 사유는 선택이에요. 입력하면 신청자에게 표시됩니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            maxLength={500}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="예: 현재 파트너 정원이 마감되어 다음 분기에 다시 검토드릴게요."
            rows={3}
            value={rejectNote}
          />
          <DialogFooter>
            <Button onClick={() => setRejectTarget(null)} variant="ghost">
              취소
            </Button>
            <Button onClick={confirmReject} variant="destructive">
              거절 확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
