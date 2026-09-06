"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ConsultationNoteResult } from "@/app/actions/admin/consulting";

export const ConsultationNoteForm = ({
  organizationId,
  onCreate,
}: {
  onCreate: (input: {
    body: string;
    nextCheckAt: string | null;
    organizationId: string;
  }) => Promise<ConsultationNoteResult>;
  organizationId: string;
}) => {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [nextCheckAt, setNextCheckAt] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await onCreate({
        organizationId,
        body,
        nextCheckAt: nextCheckAt || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setBody("");
      setNextCheckAt("");
      toast.success("컨설팅 기록을 남겼어요.");
      router.refresh();
    });
  };

  return (
    <section className="findable-card flex flex-col gap-3 p-5">
      <div>
        <h2 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">
          새 컨설팅 기록
        </h2>
        <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          진단 해석, 권고 과제, 고객사와 합의한 내용을 남기세요.
        </p>
      </div>
      <Textarea
        maxLength={2000}
        onChange={(event) => setBody(event.target.value)}
        placeholder="예: 경쟁사 대비 인용 근거가 얕습니다. FAQ 3건을 보강하고 2주 뒤 재측정합니다."
        rows={6}
        value={body}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[color:var(--findable-ink-subtle,#8a8f98)]">
            다음 점검일 (선택)
          </span>
          <Input
            className="w-44"
            onChange={(event) => setNextCheckAt(event.target.value)}
            type="date"
            value={nextCheckAt}
          />
        </label>
        <Button disabled={pending || !body.trim()} onClick={submit} type="button">
          {pending ? "저장 중…" : "기록 남기기"}
        </Button>
      </div>
    </section>
  );
};
