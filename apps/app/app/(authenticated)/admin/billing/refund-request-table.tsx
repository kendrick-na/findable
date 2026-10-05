import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import type { RefundRequestRow } from "@/app/actions/admin/refund-requests";

// 🔴 영문 슬러그를 화면에 그대로 내보내지 않는다(stuck-claim-table 과 같은 규칙).
const STATUS_LABEL: Record<RefundRequestRow["status"], string> = {
  pending: "처리 대기",
  resolved: "처리 완료",
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
  if (requests.length === 0) {
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((r) => (
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
