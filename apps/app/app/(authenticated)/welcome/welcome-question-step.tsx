"use client";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import { toast } from "@repo/design-system/components/ui/sonner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  QuestionPicker,
  type QuestionPickerLabels,
} from "../features/brand/question-picker";
import {
  clearQuestionDraft,
  readQuestionDraft,
  writeQuestionDraft,
} from "./question-draft";
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
  industryOther,
  labels,
  onNext,
  onSkip,
  questionLimit,
  quickStart,
  savedCount,
  t,
  total,
}: {
  actions: WelcomeActions;
  brandId: string;
  /** 부모가 저장·측정 중이면 버튼을 잠근다. */
  busy: boolean;
  /** 업종이 '기타'인가 — 질문 재료가 적다는 안내를 보인다. */
  industryOther: boolean;
  labels: QuestionPickerLabels;
  /** 고른 질문을 저장한 뒤 호출된다(`saved` = 새로 저장된 개수, 0이면 고른 게 없다). */
  onNext: (saved: number) => Promise<void>;
  onSkip: () => void;
  /** 플랜의 추적 질문 상한. null = 제한 없음. 이미 저장된 수가 상한이면 제안(AI 호출)을 막고 안내한다. */
  questionLimit: number | null;
  quickStart: { disabled?: boolean; label: string; onClick: () => void };
  /** 이미 저장된 추적 질문 수(없으면 0). 처음 보는 사람이 "아직 아무것도 없다"고 오해하지 않게 보여 준다. */
  savedCount: number;
  t: Record<string, string>;
  total: number;
}) => {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompts, setPrompts] = useState<SuggestedPrompt[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [max, setMax] = useState(0);
  const [saving, setSaving] = useState(false);
  const limitReached = questionLimit !== null && savedCount >= questionLimit;
  const viewPlans = {
    label: t.viewPlans,
    onClick: () => router.push("/billing"),
  };

  // 단계를 오가거나 새로고침해도 받아 둔 제안·선택을 되살린다(AI 재호출 없음) — 이 브라우저 탭 안에서만.
  useEffect(() => {
    const draft = readQuestionDraft(brandId);
    if (draft) {
      setPrompts(draft.prompts);
      setSelected(new Set(draft.selected));
      setMax(draft.max);
      setPhase("review");
    }
  }, [brandId]);
  useEffect(() => {
    if (phase === "review" && prompts.length > 0) {
      writeQuestionDraft(brandId, {
        max,
        prompts,
        selected: [...selected],
      });
    }
  }, [brandId, max, phase, prompts, selected]);

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
      // 한도 초과는 업그레이드 길을 함께 준다(기존 마법사와 같은 동작).
      toast.error(
        result.error,
        result.code === "prompt_limit"
          ? { action: viewPlans }
          : { description: t.saveFailedHint }
      );
      return;
    }
    if (result.capped) {
      // 일부만 저장됐다 — 조용히 넘어가지 않고 몇 개가 빠졌는지 알린다.
      toast.warning(
        t.questionSavedCapped
          .replace("{requested}", String(result.requested))
          .replace("{saved}", String(result.saved))
          .replace("{limit}", String(result.limit)),
        { action: viewPlans }
      );
    }
    clearQuestionDraft(brandId);
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
      {industryOther && (
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.industryOtherNote}
        </p>
      )}
      {savedCount > 0 && (
        <p className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
          {t.summaryQuestions.replace("{count}", String(savedCount))}
        </p>
      )}
      {limitReached && (
        <p className="flex flex-wrap items-center gap-2 text-amber-600 text-sm dark:text-amber-400">
          {t.questionLimitReached.replace("{limit}", String(questionLimit))}
          <button
            className="font-medium underline underline-offset-4"
            onClick={viewPlans.onClick}
            type="button"
          >
            {t.viewPlans}
          </button>
        </p>
      )}
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
        !limitReached && (
          <button
            className="w-fit rounded-md border border-[color:var(--findable-hairline,#23252a)] px-3 py-2 font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm disabled:opacity-50"
            disabled={phase === "loading"}
            onClick={suggest}
            type="button"
          >
            {phase === "loading" ? t.questionSuggesting : t.questionSuggest}
          </button>
        )
      )}
    </WelcomeShell>
  );
};
