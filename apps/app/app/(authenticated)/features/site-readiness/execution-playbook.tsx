"use client";

import { cn } from "@repo/design-system/lib/utils";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  MapPinIcon,
  RotateCcwIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toggleActionCompletion } from "@/app/actions/brand/complete-action";
import type { SiteReadinessTask } from "@/lib/site-readiness/execution-playbook";

const severityTone = {
  critical: "border-red-500/25 bg-red-500/10 text-red-400",
  high: "border-orange-500/25 bg-orange-500/10 text-orange-300",
  medium: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  low: "border-sky-500/25 bg-sky-500/10 text-sky-300",
};

interface ExecutionPlaybookProps {
  brandId: string;
  completedTaskIds: string[];
  currentTasks: SiteReadinessTask[];
  locale: string;
  previousTasks: SiteReadinessTask[];
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const localized = (isKo: boolean, ko: string, en: string) => (isKo ? ko : en);

function severityLabel(task: SiteReadinessTask, isKo: boolean): string {
  const labels = {
    critical: ["긴급", "Critical"],
    high: ["높음", "High"],
    low: ["낮음", "Low"],
    medium: ["중간", "Medium"],
  } as const;
  const [ko, en] = labels[task.severity];
  return localized(isKo, ko, en);
}

function TaskSampleLinks({ task }: { task: SiteReadinessTask }) {
  const links = task.sampleUrls
    .slice(0, 3)
    .map((value) => ({ href: safeExternalUrl(value), value }))
    .filter((item): item is { href: string; value: string } =>
      Boolean(item.href)
    );
  if (links.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1.5">
      {links.map(({ href, value }) => (
        <a
          className="flex min-w-0 items-center gap-2 truncate font-mono text-orange-300/80 text-xs hover:text-orange-300"
          href={href}
          key={value}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLinkIcon className="size-3 shrink-0" />
          <span className="truncate">{value}</span>
        </a>
      ))}
    </div>
  );
}

function TaskCode({
  copied,
  isKo,
  onCopy,
  task,
}: {
  copied: boolean;
  isKo: boolean;
  onCopy: () => void;
  task: SiteReadinessTask;
}) {
  if (!task.snippet) {
    return null;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-white/8 bg-black/35">
      <div className="flex items-center justify-between border-white/8 border-b px-3 py-2">
        <span className="flex items-center gap-2 text-[11px] text-white/35 uppercase tracking-[0.12em]">
          <TerminalSquareIcon className="size-3.5" />
          {localized(isKo, "예시 코드", "Example code")}
        </span>
        <button
          className="inline-flex items-center gap-1.5 text-white/45 text-xs hover:text-white/80"
          onClick={onCopy}
          type="button"
        >
          {copied ? (
            <CheckCircle2Icon className="size-3.5 text-emerald-400" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
          {copied
            ? localized(isKo, "복사됨", "Copied")
            : localized(isKo, "복사", "Copy")}
        </button>
      </div>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11px] text-white/65 leading-5">
        <code>{task.snippet}</code>
      </pre>
    </div>
  );
}

function TaskCard({
  copied,
  index,
  isCompleted,
  isKo,
  onCopy,
  onToggle,
  pending,
  task,
}: {
  copied: boolean;
  index: number;
  isCompleted: boolean;
  isKo: boolean;
  onCopy: () => void;
  onToggle: () => void;
  pending: boolean;
  task: SiteReadinessTask;
}) {
  const completionLabel = isCompleted
    ? localized(isKo, "완료 표시 취소", "Undo completion")
    : localized(isKo, "수정 완료로 표시", "Mark as complete");
  return (
    <details className="group" open={index === 0}>
      <summary className="grid cursor-pointer list-none gap-4 px-5 py-5 transition-colors hover:bg-white/[0.025] sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:px-6">
        <div className="flex size-11 items-center justify-center rounded-xl border border-white/8 bg-black/20 font-mono text-sm text-white/45">
          {String(index + 1).padStart(2, "0")}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-medium text-[11px]",
                severityTone[task.severity]
              )}
            >
              {severityLabel(task, isKo)}
            </span>
            {isCompleted ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-2 py-0.5 text-[11px] text-emerald-300">
                <CheckCircle2Icon className="size-3" />
                {localized(
                  isKo,
                  "수정 완료 표시됨 · 재실측 필요",
                  "Marked complete · recheck needed"
                )}
              </span>
            ) : null}
          </div>
          <h4 className="mt-2 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-base">
            {task.title}
          </h4>
          <p className="mt-1 truncate font-mono text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
            {task.evidence}
          </p>
        </div>
        <div className="flex items-center gap-3 self-center">
          <span className="hidden font-mono text-white/35 text-xs sm:inline">
            {localized(
              isKo,
              `${task.affectedCount}개 대상`,
              `${task.affectedCount} affected`
            )}
          </span>
          <ChevronDownIcon className="size-4 text-white/35 transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="grid gap-5 bg-black/10 px-5 pt-0 pb-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.78fr)]">
        <div className="space-y-5 sm:pl-[60px]">
          <div>
            <p className="text-[11px] text-white/35 uppercase tracking-[0.14em]">
              {localized(isKo, "왜 중요한가", "Why it matters")}
            </p>
            <p className="mt-2 text-sm text-white/68 leading-6">{task.why}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/35 uppercase tracking-[0.14em]">
              {localized(isKo, "수정 순서", "How to fix")}
            </p>
            <ol className="mt-2 space-y-2">
              {task.steps.map((step, stepIndex) => (
                <li
                  className="flex gap-3 text-sm text-white/68 leading-6"
                  key={step}
                >
                  <span className="mt-0.5 font-mono text-orange-300/70 text-xs">
                    {stepIndex + 1}.
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.045] p-4">
            <p className="flex items-center gap-2 font-medium text-emerald-300 text-xs">
              <RotateCcwIcon className="size-3.5" />
              {localized(isKo, "완료 확인 기준", "Definition of done")}
            </p>
            <p className="mt-2 text-sm text-white/65 leading-6">
              {task.verification}
            </p>
          </div>
        </div>

        <aside className="space-y-4 rounded-xl border border-white/7 bg-[color:var(--findable-surface-0,#090a0b)] p-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] text-white/35 uppercase tracking-[0.14em]">
              <MapPinIcon className="size-3.5" />
              {localized(isKo, "수정 위치", "Where to edit")}
            </p>
            <p className="mt-2 text-sm text-white/68 leading-6">
              {task.location}
            </p>
          </div>
          <TaskSampleLinks task={task} />
          <TaskCode copied={copied} isKo={isKo} onCopy={onCopy} task={task} />
          <button
            className={cn(
              "inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-4 font-medium text-sm transition-colors disabled:cursor-wait disabled:opacity-60",
              isCompleted
                ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/12"
                : "border-orange-500/25 bg-orange-500/10 text-orange-200 hover:bg-orange-500/15"
            )}
            disabled={pending}
            onClick={onToggle}
            type="button"
          >
            {pending ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <CheckCircle2Icon className="size-4" />
            )}
            {completionLabel}
          </button>
        </aside>
      </div>
    </details>
  );
}

export function ExecutionPlaybook({
  brandId,
  completedTaskIds,
  currentTasks,
  locale,
  previousTasks,
}: ExecutionPlaybookProps) {
  const isKo = locale.startsWith("ko");
  const [completed, setCompleted] = useState(() => new Set(completedTaskIds));
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const currentIds = useMemo(
    () => new Set(currentTasks.map((task) => task.id)),
    [currentTasks]
  );
  const resolvedTasks = previousTasks.filter(
    (task) => completed.has(task.id) && !currentIds.has(task.id)
  );

  const copySnippet = async (task: SiteReadinessTask) => {
    if (!task.snippet) {
      return;
    }
    await navigator.clipboard.writeText(task.snippet);
    setCopied(task.id);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const toggle = (task: SiteReadinessTask) => {
    setError(null);
    startTransition(async () => {
      const result = await toggleActionCompletion({
        brandId,
        kind: "site_readiness",
        target: task.id,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setCompleted((value) => {
        const next = new Set(value);
        if (result.completed) {
          next.add(task.id);
        } else {
          next.delete(task.id);
        }
        return next;
      });
    });
  };

  if (currentTasks.length === 0 && resolvedTasks.length === 0) {
    return (
      <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/6 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-400" />
          <div>
            <h3 className="font-semibold text-[color:var(--findable-ink,#f7f8f8)]">
              {isKo
                ? "현재 확인된 필수 작업이 없습니다"
                : "No required tasks found"}
            </h3>
            <p className="mt-1 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
              {isKo
                ? "새 페이지를 공개하거나 사이트 구조를 바꾼 뒤 다시 실측하세요."
                : "Run another measurement after publishing pages or changing the site structure."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)]">
      <div className="pointer-events-none absolute -top-32 right-0 size-64 rounded-full bg-orange-500/8 blur-3xl" />
      <header className="relative border-[color:var(--findable-hairline,#23252a)] border-b px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-orange-300 text-xs uppercase tracking-[0.16em]">
              <ClipboardCheckIcon className="size-4" />
              {isKo ? "Execution playbook" : "Execution playbook"}
            </div>
            <h3 className="mt-2 font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-xl">
              {isKo ? "바로 실행할 SEO 작업" : "SEO tasks ready to execute"}
            </h3>
            <p className="mt-1 max-w-2xl text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-6">
              {isKo
                ? "위험도가 높은 순서입니다. 수정 위치와 예시 코드를 확인하고 완료로 표시한 뒤 다시 실측하세요."
                : "Ordered by risk. Review the location and code example, mark the task complete, then measure again."}
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="rounded-full border border-orange-500/20 bg-orange-500/8 px-3 py-1.5 text-orange-300">
              {isKo
                ? `진행 중 ${currentTasks.length}`
                : `${currentTasks.length} active`}
            </span>
            {resolvedTasks.length > 0 ? (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1.5 text-emerald-300">
                {isKo
                  ? `해결 확인 ${resolvedTasks.length}`
                  : `${resolvedTasks.length} resolved`}
              </span>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-red-300 text-sm">
            {error}
          </p>
        ) : null}
      </header>

      <div className="relative divide-y divide-[color:var(--findable-hairline,#23252a)]">
        {currentTasks.map((task, index) => (
          <TaskCard
            copied={copied === task.id}
            index={index}
            isCompleted={completed.has(task.id)}
            isKo={isKo}
            key={task.id}
            onCopy={() => copySnippet(task)}
            onToggle={() => toggle(task)}
            pending={pending}
            task={task}
          />
        ))}
      </div>

      {resolvedTasks.length > 0 ? (
        <div className="border-emerald-500/15 border-t bg-emerald-500/[0.035] px-5 py-5 sm:px-6">
          <p className="font-medium text-emerald-300 text-sm">
            {isKo
              ? "재실측에서 해결 확인됨"
              : "Resolved in the latest measurement"}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {resolvedTasks.map((task) => (
              <li
                className="flex items-center gap-2 text-sm text-white/65"
                key={task.id}
              >
                <CheckCircle2Icon className="size-4 shrink-0 text-emerald-400" />
                {task.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
