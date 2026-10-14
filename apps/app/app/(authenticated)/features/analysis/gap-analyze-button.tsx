"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { analyzeAnswersAction } from "@/app/actions/brand/analyze-answers";

/** 답변 분석 실행 버튼 — 끝날 때까지(최대 4번) 이어서 돌리고 화면을 새로 고친다. */
const MAX_ROUNDS = 4;

export const GapAnalyzeButton = ({
  brandId,
  label,
  pendingLabel,
}: {
  brandId: string;
  label: string;
  pendingLabel: string;
}) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setPending(true);
    try {
      for (let i = 0; i < MAX_ROUNDS; i += 1) {
        const res = await analyzeAnswersAction({ brandId });
        if ("error" in res) {
          setError(res.error);
          break;
        }
        if (res.done || res.extracted === 0) {
          break;
        }
      }
    } finally {
      setPending(false);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={pending}
        onClick={() => void run()}
        size="sm"
        type="button"
      >
        {pending ? pendingLabel : label}
      </Button>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
};
