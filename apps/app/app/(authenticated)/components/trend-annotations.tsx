"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { PlusIcon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  createAnnotation,
  deleteAnnotation,
} from "../../actions/annotation/manage";
import type { TrendAnnotation } from "./sov-trend-chart";

/**
 * 추세 차트 수동 주석 UI (감사 D2).
 *
 * GSC 패턴(*"차트 날짜 우클릭으로 메모 고정"*)을 폼으로 옮긴 것 — 우클릭은 모바일에서
 * 쓸 수 없고 발견도 안 되기 때문이다. 리서치가 GSC 주석을 *"무료인데 명료함의 기준점"*
 * 으로 꼽은 이유는 **추세에 인과 맥락이 붙는다**는 것이지 우클릭이라는 조작이 아니다.
 *
 * 왜 필요한가: 등장률이 오르내려도 **왜** 그런지는 화면에 없다. 그 원인(보도자료 배포·
 * 콘텐츠 발행·경쟁사 캠페인)은 고객만 안다 → 고객이 직접 남기게 한다.
 */
export const TrendAnnotations = ({
  annotations,
  brandId,
}: {
  annotations: TrendAnnotation[];
  brandId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  // 기본값 = 오늘. 대부분의 주석은 "방금 한 일"을 적는다.
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createAnnotation(brandId, date, label);
      if (result.ok) {
        setLabel("");
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await deleteAnnotation(id);
      if (!result.ok) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="mt-4 border-[color:var(--findable-hairline,#23252a)] border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {annotations.length > 0
            ? "이 기간에 있었던 일"
            : "이 기간에 무슨 일이 있었는지 적어두면, 다음에 그래프를 볼 때 이유가 같이 보여요."}
        </p>
        <Button
          className="h-7 gap-1.5 text-xs"
          onClick={() => setOpen((v) => !v)}
          size="sm"
          variant="ghost"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          메모 추가
        </Button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-[9.5rem] text-xs"
            onChange={(e) => setDate(e.target.value)}
            type="date"
            value={date}
          />
          <Input
            className="h-8 min-w-0 flex-1 text-xs"
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="예: 보도자료 배포, 브랜드 페이지 개편"
            value={label}
          />
          <Button
            className="h-8 text-xs"
            disabled={pending || !label.trim()}
            onClick={submit}
            size="sm"
          >
            {pending ? "저장 중…" : "저장"}
          </Button>
        </div>
      ) : null}

      {/* `--findable-warn` 은 **존재하지 않는 토큰**이었다(globals.css 실측·2026-08-07).
          그리고 이 자리는 경고가 아니라 **저장 실패(에러)** 라 signal-bad 가 맞다. */}
      {error ? (
        <p className="mt-2 text-[color:var(--signal-bad,#f87171)] text-xs">
          {error}
        </p>
      ) : null}

      {annotations.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {annotations.map((a) => (
            <li
              className="flex items-center gap-2 text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs"
              key={a.id}
            >
              <span className="tabular-nums">
                {a.occurredAt.toISOString().slice(0, 10).replaceAll("-", ".")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[color:var(--findable-ink,#f7f8f8)]">
                {a.label}
              </span>
              <button
                aria-label={`${a.label} 메모 삭제`}
                className="shrink-0 rounded p-1 transition-colors hover:text-[color:var(--findable-ink,#f7f8f8)]"
                disabled={pending}
                onClick={() => remove(a.id)}
                type="button"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
