"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useState, useTransition } from "react";
import {
  type MeasureCompanyResult,
  measureCompany,
} from "@/app/actions/admin/sales-discovery";
import type { AppDictionary } from "@/lib/i18n";

type Labels = AppDictionary["salesDiscover"];

export function measureMessage(
  labels: Labels,
  result: MeasureCompanyResult
): string {
  if (!result.ok) {
    if (result.error === "no_domain") {
      return labels.measureNoDomain;
    }
    return result.error === "failed"
      ? (result.message ?? labels.measureFailed)
      : labels.errors[result.error];
  }
  switch (result.outcome) {
    case "started":
      return result.path === "brand_register"
        ? labels.measureRegistered
        : labels.measureStarted;
    case "already_running":
      return labels.measureRunning;
    case "rate_limited":
      return result.message ?? labels.measureRateLimited;
    default:
      return result.message ?? labels.measureFailed;
  }
}

/**
 * [측정] — 새 측정 경로를 만들지 않는다. 서버액션 measureCompany 가
 * 같은 도메인 브랜드면 관리자 1건 측정(runMeasureOne), 없으면 브랜드 등록 흐름(assignBrandOwner)을 부른다.
 */
export function MeasureButton({
  companyId,
  disabled,
  labels,
  size = "sm",
}: {
  companyId: string;
  disabled?: boolean;
  labels: Labels;
  size?: "sm" | "default";
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        disabled={disabled || pending}
        onClick={(event) => {
          event.stopPropagation();
          startTransition(async () => {
            setMessage(measureMessage(labels, await measureCompany(companyId)));
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
