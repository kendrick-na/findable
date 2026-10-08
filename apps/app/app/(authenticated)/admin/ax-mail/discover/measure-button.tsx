"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { measureCompany } from "@/app/actions/admin/sales-discovery";
import type { AppDictionary } from "@/lib/i18n";
import { measureConfirmText, measureMessage } from "./measure-text";

type Labels = AppDictionary["salesDiscover"];

/**
 * [측정] — 새 측정 경로를 만들지 않는다. 서버액션 measureCompany 가
 * 영업 전용 내부 조직의 브랜드(없으면 만든다)로 관리자 1건 측정(runMeasureOne)을 건다.
 * 🔒 실제 돈이 드는 동작이라 누르면 먼저 확인 창을 띄운다(측정 콘솔과 같은 방식).
 */
export function MeasureButton({
  companyId,
  disabled,
  labels,
  lastMeasuredAt,
  size = "sm",
}: {
  companyId: string;
  disabled?: boolean;
  labels: Labels;
  /** 영업 내부 조직의 마지막 완료 측정(ISO) */
  lastMeasuredAt?: string | null;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        disabled={disabled || pending}
        onClick={(event) => {
          event.stopPropagation();
          if (
            // 운영자 전용 화면이라 브라우저 기본 확인창이 가장 확실하다(measure-console 과 같은 이유).
            // biome-ignore lint/suspicious/noAlert: 유료 측정 전 사람 확인
            !window.confirm(measureConfirmText(labels, lastMeasuredAt))
          ) {
            return;
          }
          startTransition(async () => {
            try {
              const result = await measureCompany(companyId);
              setMessage(measureMessage(labels, result));
              if (result.ok) {
                // 카드가 새 회차(진행 중)를 보고 스스로 새로 고치게 한다.
                router.refresh();
              }
            } catch {
              setMessage(labels.errors.unexpected);
            }
          });
        }}
        size={size}
        type="button"
        variant="outline"
      >
        {pending ? labels.measuring : labels.measure}
      </Button>
      {message && (
        <output className="max-w-56 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {message}
        </output>
      )}
    </span>
  );
}
