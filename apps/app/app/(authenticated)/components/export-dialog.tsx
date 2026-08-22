"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Label } from "@repo/design-system/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@repo/design-system/components/ui/radio-group";
import { useState } from "react";

export interface ExportDialogLabels {
  cancel: string;
  columnsBase: string;
  columnsLabel: string;
  description: string;
  download: string;
  downloading: string;
  includeSources: string;
  period7: string;
  period30: string;
  period90: string;
  periodAll: string;
  periodLabel: string;
  title: string;
}

type Period = "7" | "30" | "90" | "all";

/**
 * RICE#5 — 내보내기 확인 모달. 클릭 즉시 다운로드(기존)를 기간·컬럼 선택
 * 확인 단계로 바꾼다. 다운로드는 `<a>` 클릭으로 트리거한다 — `fetch` 로
 * 받으면 브라우저 저장 대화상자 대신 응답을 메모리에 들고 있어야 해서,
 * `/api/export/tracking.csv` 가 이미 제공하는 `Content-Disposition` 을 그대로 쓴다.
 */
export const ExportDialog = ({
  labels,
  onOpenChange,
  open,
}: {
  labels: ExportDialogLabels;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => {
  const [period, setPeriod] = useState<Period>("30");
  const [includeSources, setIncludeSources] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const href = `/api/export/tracking.csv?period=${period}${
    includeSources ? "&includeSources=1" : ""
  }`;

  const onDownload = () => {
    setDownloading(true);
    // 다운로드 자체는 네비게이션이라 완료 이벤트가 없다 — 짧게 로딩 표시만 하고 닫는다.
    window.location.href = href;
    setTimeout(() => {
      setDownloading(false);
      onOpenChange(false);
    }, 600);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{labels.periodLabel}</Label>
            <RadioGroup
              onValueChange={(v) => setPeriod(v as Period)}
              value={period}
            >
              {(
                [
                  ["7", labels.period7],
                  ["30", labels.period30],
                  ["90", labels.period90],
                  ["all", labels.periodAll],
                ] as const
              ).map(([value, label]) => (
                <div className="flex items-center gap-2" key={value}>
                  <RadioGroupItem id={`export-period-${value}`} value={value} />
                  <Label
                    className="font-normal"
                    htmlFor={`export-period-${value}`}
                  >
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{labels.columnsLabel}</Label>
            <p className="text-muted-foreground text-sm">
              {labels.columnsBase}
            </p>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={includeSources}
                id="export-include-sources"
                onCheckedChange={(v) => setIncludeSources(v === true)}
              />
              <Label className="font-normal" htmlFor="export-include-sources">
                {labels.includeSources}
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {labels.cancel}
          </Button>
          <Button disabled={downloading} onClick={onDownload}>
            {downloading ? labels.downloading : labels.download}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
