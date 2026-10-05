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
import type { AppDictionary } from "@/lib/i18n";

const CARD =
  "findable-card-accent flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between";
const TITLE = "font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-lg";
const SUBTLE = "text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm";

interface Props {
  note: string | null;
  status: PartnerStatus;
  t: AppDictionary["partnerCta"];
}

export const PartnerCtaClient = ({ status, note, t }: Props) => {
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
      toast.success(t.submitted);
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
            <p className={TITLE}>{t.pendingTitle}</p>
            <p className={SUBTLE}>{t.pendingBody}</p>
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
          <p className={TITLE}>{isRejected ? t.rejectedTitle : t.title}</p>
          <p className={SUBTLE}>{isRejected ? t.rejectedBody : t.body}</p>
          {isRejected && note ? (
            <p className="mt-1 rounded-md border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] px-3 py-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {t.reason.replace("{note}", note)}
            </p>
          ) : null}
        </div>
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger asChild>
          <Button className="findable-btn-primary shrink-0">
            {isRejected ? t.reapply : t.apply}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.dialogTitle}</DialogTitle>
            <DialogDescription>{t.dialogBody}</DialogDescription>
          </DialogHeader>
          <Textarea
            disabled={pending}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.placeholder}
            rows={4}
            value={reason}
          />
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => setOpen(false)}
              variant="ghost"
            >
              {t.cancel}
            </Button>
            <Button
              className="findable-btn-primary"
              disabled={pending}
              onClick={submit}
            >
              {pending ? t.submitting : t.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
