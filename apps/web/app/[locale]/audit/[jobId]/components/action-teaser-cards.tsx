import type { ActionGuide } from "@repo/audit/action-rules";
import { stripMarkdown } from "@repo/audit/strip-markdown";
import { ChevronDown } from "lucide-react";
import { ActionEvidenceGuide } from "./action-evidence-guide";

export interface ActionTeaserAction {
  evidence: string;
  guide?: ActionGuide;
  how: string;
  kind: string;
  priority: 1 | 2 | 3;
  source?: string;
  title: string;
  verification?: string;
  where?: string;
}

function ActionDetailsContent({
  action,
  isKo,
}: {
  action: ActionTeaserAction;
  isKo: boolean;
}) {
  return (
    <>
      <p className="whitespace-pre-line text-sm text-zinc-300 leading-relaxed">
        {stripMarkdown(action.how)}
      </p>
      {(action.where || action.verification) && (
        <div className="mt-4 space-y-2 rounded-lg border border-sky-300/15 bg-sky-300/[0.04] p-3 text-sm leading-relaxed">
          {action.where && (
            <p className="text-zinc-300">
              <span className="font-medium text-sky-300">
                {isKo ? "수정 위치 · " : "Where to change · "}
              </span>
              {stripMarkdown(action.where)}
            </p>
          )}
          {action.verification && (
            <p className="text-zinc-400">
              <span className="font-medium text-sky-300">
                {isKo ? "검증 방법 · " : "How to verify · "}
              </span>
              {stripMarkdown(action.verification)}
            </p>
          )}
        </div>
      )}
      <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-1.5 font-medium text-[11px] text-zinc-400">
          {isKo ? "이 처방이 나온 근거 (실측)" : "Evidence (measured)"}
        </div>
        <p className="whitespace-pre-line text-sm text-zinc-400 leading-relaxed">
          {stripMarkdown(action.evidence)}
        </p>
      </div>
      {action.source && (
        <p className="mt-3 text-xs text-zinc-400">{action.source}</p>
      )}
      {action.guide && <ActionEvidenceGuide guide={action.guide} isKo={isKo} />}
    </>
  );
}

export function ActionLead({
  action,
  isKo,
}: {
  action: ActionTeaserAction;
  isKo: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="font-semibold text-base text-zinc-50 leading-snug md:text-lg">
        {action.title}
      </h3>
      <ActionDetailsContent action={action} isKo={isKo} />
    </div>
  );
}

export function ActionDetails({
  action,
  index,
  isKo,
}: {
  action: ActionTeaserAction;
  index: number;
  isKo: boolean;
}) {
  const isAvoid = action.kind === "avoid";
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold text-[11px] tabular-nums ${
            isAvoid
              ? "bg-white/10 text-zinc-400"
              : "bg-[var(--brand-3)]/15 text-[var(--brand-3)]"
          }`}
        >
          {isAvoid ? "!" : index}
        </div>
        <h4 className="min-w-0 flex-1 font-medium text-sm text-zinc-100 leading-snug">
          {action.title}
        </h4>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-white/5 border-t px-4 pt-4 pb-4">
        <ActionDetailsContent action={action} isKo={isKo} />
      </div>
    </details>
  );
}
