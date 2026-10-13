"use client";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useState } from "react";
import {
  QuestionPicker,
  type QuestionPickerLabels,
} from "../features/brand/question-picker";
import type { WelcomeActions } from "./welcome-flow";
import { WelcomeShell } from "./welcome-shell";

/**
 * 온보딩 5단계 — 질문 승인(2026-10-13 · 대표 승인).
 *
 * 흐름: [질문 제안받기] → 후보 ~20개(업종·시장·사이트·별칭·경쟁사 재료) → 사람이 직접 고른다
 *   (**기본 전부 미선택**, [추천 구성으로 담기], 문구 수정 가능) → [다음]에서 **고른 것만** 저장.
 *   고른 게 없으면 저장 없이 넘어간다(건너뛰기). 아무것도 자동으로 담기지 않는다.
 *
 * 서버 동작은 주입받는다(Storybook 주입 패턴). 자기 상태(제안·선택)는 여기서만 든다 — 부모
 *   `WelcomeFlow` 가 커지지 않게 분리했다.
 */
type Phase = "idle" | "loading" | "review";

export const WelcomeQuestionStep = ({
  actions,
  brandId,
  busy,
  labels,
  onNext,
  onSkip,
  quickStart,
  t,
  total,
}: {
  actions: WelcomeActions;
  brandId: string;
  /** 부모가 저장·측정 중이면 버튼을 잠근다. */
  busy: boolean;
  labels: QuestionPickerLabels;
  /** 고른 질문을 저장한 뒤 호출된다(`saved` = 새로 저장된 개수, 0이면 고른 게 없다). */
  onNext: (saved: number) => Promise<void>;
  onSkip: () => void;
  quickStart: { disabled?: boolean; label: string; onClick: () => void };
  t: Record<string, string>;
  total: number;
}) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompts, setPrompts] = useState<SuggestedPrompt[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [max, setMax] = useState(0);
  const [saving, setSaving] = useState(false);

  const suggest = async () => {
    setPhase("loading");
    const result = await actions.suggest(brandId);
    if ("error" in result) {
      setPhase("idle");
      toast.error(result.error || t.questionFailed);
      return;
    }
    setPrompts(result.prompts);
    setMax(result.remaining);
    setSelected(new Set());
    setPhase("review");
  };

  const next = async () => {
    const approved = prompts
      .filter((_, i) => selected.has(i))
      .map((p) => ({ ...p, text: p.text.trim() }));
    if (approved.length === 0) {
      await onNext(0);
      return;
    }
    setSaving(true);
    const result = await actions.save({ brandId, prompts: approved });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error, { description: t.saveFailedHint });
      return;
    }
    await onNext(result.saved);
  };

  const empty = phase === "review" && prompts.length === 0;

  return (
    <WelcomeShell
      aside={
        <>
          <p className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
            {t.questionWhyTitle}
          </p>
          <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm leading-relaxed">
            {t.questionWhyBody}
          </p>
        </>
      }
      current={5}
      description={empty ? t.questionLedeEmpty : t.questionLede}
      primary={{
        disabled: busy || saving || phase === "loading",
        label: saving ? t.saving : t.next,
        onClick: next,
      }}
      quickStart={quickStart}
      skip={{ label: t.skip, onClick: onSkip }}
      stepOfTemplate={t.stepOf}
      title={t.questionTitle}
      total={total}
    >
      {phase === "review" && prompts.length > 0 ? (
        <QuestionPicker
          labels={labels}
          max={max}
          onEdit={(index, text) =>
            setPrompts((prev) =>
              prev.map((p, i) => (i === index ? { ...p, text } : p))
            )
          }
          onSelectedChange={setSelected}
          prompts={prompts}
          selected={selected}
        />
      ) : (
        <button
          className="w-fit rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 py-2 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm disabled:opacity-50"
          disabled={phase === "loading"}
          onClick={suggest}
          type="button"
        >
          {phase === "loading" ? t.questionSuggesting : t.questionSuggest}
        </button>
      )}
    </WelcomeShell>
  );
};
