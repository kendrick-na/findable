"use client";

import type { PartnerStatus } from "@repo/auth/plan";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/design-system/components/ui/dialog";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { Clock, Handshake } from "lucide-react";
import { useState, useTransition } from "react";
import { applyForPartner } from "@/app/actions/partner/apply";

const CARD =
  "findable-card-accent flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between";
const TITLE = "font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg";
const SUBTLE = "text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm";

interface Props {
  note: string | null;
  status: PartnerStatus;
}

export const PartnerCtaClient = ({ status, note }: Props) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  // 낙관적 상태: 신청 성공 시 즉시 pending UI 로 전환.
  const [localStatus, setLocalStatus] = useState<PartnerStatus>(status);

  const submit = () => {
    startTransition(async () => {
      const result = await applyForPartner(reason);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setLocalStatus("pending");
      setOpen(false);
      setReason("");
      toast.success("파트너 신청이 접수됐어요. 검토 후 알려드릴게요.");
    });
  };

  // 심사 중 — 신청 버튼 없음(중복 방지).
  if (localStatus === "pending") {
    return (
      <section className={CARD}>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]">
            <Clock aria-hidden className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <p className={TITLE}>파트너 신청 심사 중</p>
            <p className={SUBTLE}>
              신청이 접수됐어요. 검토 후 결과를 알려드립니다.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const isRejected = localStatus === "rejected";

  return (
    <section className={CARD}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--findable-primary,#ff7a4d)]/12 text-[color:var(--findable-primary,#ff7a4d)]">
          <Handshake aria-hidden className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          {/* 🔴 S4(2026-08-11) — **순환 문장을 없앴다.**
              예전: 「파트너로 신청하기 / 승인되면 **파트너 전용 접근**이 열립니다」
              = '파트너 전용 접근'을 '파트너 전용 접근'으로 설명하는 자기참조 문장이라
              무슨 파트너인지·누가 대상인지·무엇이 열리는지 화면에 한 글자도 없었다(진단 §원인④).
              → **대상**(대행사·컨설팅사)과 **혜택**을 말한다.
              🔬 혜택은 **코드로 확인한 것만** 적었다(추정 금지): 승인 시 `grantPlan(userId,
              "growth")` 로 **Growth 권한이 부여**된다(`actions/partner/decide.ts:91`
              · `packages/auth/plan.ts:13`). 그래서 "Growth 기능이 열린다"고 쓸 수 있다. */}
          <p className={TITLE}>
            {isRejected ? "파트너 신청 결과" : "대행사·컨설팅사이신가요?"}
          </p>
          <p className={SUBTLE}>
            {isRejected
              ? "이번 신청은 승인되지 않았어요. 다시 신청할 수 있어요."
              : "고객사 여러 곳을 한 계정에서 측정하려면 파트너 승인이 필요해요. 승인되면 Growth 기능이 열려요."}
          </p>
          {isRejected && note ? (
            <p className="mt-1 rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-3 py-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              사유: {note}
            </p>
          ) : null}
        </div>
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger asChild>
          <Button className="findable-btn-primary shrink-0">
            {isRejected ? "다시 신청하기" : "파트너 신청"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>파트너 신청</DialogTitle>
            <DialogDescription>
              신청 사유는 선택이에요. 적어주시면 검토에 도움이 됩니다.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            disabled={pending}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 대행사로 클라이언트 여러 곳의 GEO 진단에 활용하려 합니다."
            rows={4}
            value={reason}
          />
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => setOpen(false)}
              variant="ghost"
            >
              취소
            </Button>
            <Button
              className="findable-btn-primary"
              disabled={pending}
              onClick={submit}
            >
              {pending ? "제출 중…" : "신청 제출"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
