"use client";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import {
  QUESTION_TYPE_PRIORITY,
  type QuestionType,
  recommendedBundle,
} from "@repo/ai/lib/question-plan";
import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Input } from "@repo/design-system/components/ui/input";

/**
 * 추적 질문 고르기 — 온보딩 질문 단계와 브랜드 화면 질문 마법사가 **같이 쓰는** 순수 뷰(2026-10-13).
 *
 * 원칙(대표 승인 2026-10-12): 질문은 자동 제안 → **사람이 승인** → 승인한 것만 측정한다.
 *  - 기본은 **전부 미선택**이다(전자상거래법 「특정옵션 사전선택」 · 온보딩 v4 §7-D-4 와 같은 결).
 *    대신 [추천 구성으로 담기] 버튼 — 누르는 것이 명시 선택이다.
 *  - 문구는 고쳐서 담을 수 있다(저장은 '새 질문').
 *  - 담을 수 있는 수는 플랜 상한(`max`)을 넘지 못한다.
 *
 * 🔴 서버액션을 import 하지 않는다(Storybook 주입 패턴) — 저장·제안은 부모가 한다.
 */

export interface QuestionPickerLabels {
  clear: string;
  editAria: string;
  recommend: string;
  /** "{n}개 선택 · 최대 {max}개" */
  selectedOfMax: string;
  typeAlternative: string;
  typeBrand: string;
  typeCategory: string;
  typeConcern: string;
  /** 유형이 없는 옛 제안·직접 입력 */
  typeOther: string;
  typeRepresentative: string;
}

const TYPE_LABEL_KEY: Record<QuestionType, keyof QuestionPickerLabels> = {
  category: "typeCategory",
  concern: "typeConcern",
  representative: "typeRepresentative",
  alternative: "typeAlternative",
  brand: "typeBrand",
};

export const QuestionPicker = ({
  labels,
  max,
  onEdit,
  onSelectedChange,
  prompts,
  selected,
}: {
  labels: QuestionPickerLabels;
  /** 더 담을 수 있는 최대 개수(플랜 상한 − 이미 저장된 질문). */
  max: number;
  onEdit: (index: number, text: string) => void;
  onSelectedChange: (next: Set<number>) => void;
  prompts: SuggestedPrompt[];
  /** 선택한 질문의 **인덱스**(문구를 고쳐도 선택이 유지되도록). */
  selected: Set<number>;
}) => {
  const toggle = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else if (next.size < max) {
      next.add(index);
    }
    onSelectedChange(next);
  };

  const groups: Array<{ items: number[]; label: string }> = [
    ...QUESTION_TYPE_PRIORITY,
    undefined,
  ]
    .map((type) => ({
      label: labels[type ? TYPE_LABEL_KEY[type] : "typeOther"],
      items: prompts.flatMap((p, i) => (p.type === type ? [i] : [])),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          aria-live="polite"
          className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs tabular-nums"
        >
          {labels.selectedOfMax
            .replace("{n}", String(selected.size))
            .replace("{max}", String(max))}
        </span>
        <div className="flex items-center gap-2">
          <Button
            className="findable-btn-secondary"
            onClick={() =>
              onSelectedChange(
                new Set(
                  recommendedBundle(
                    // 유형이 없는 옛 제안은 가장 낮은 우선순위로 취급한다.
                    prompts.map((p) => ({ ...p, type: p.type ?? "brand" })),
                    max
                  )
                )
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {labels.recommend}
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => onSelectedChange(new Set())}
            size="sm"
            type="button"
            variant="ghost"
          >
            {labels.clear}
          </Button>
        </div>
      </div>

      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
        {groups.map((group) => (
          <section className="flex flex-col gap-1" key={group.label}>
            <h3 className="font-medium text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
              {group.label}
            </h3>
            <ul className="flex flex-col gap-1">
              {group.items.map((index) => {
                const prompt = prompts[index] as SuggestedPrompt;
                const checked = selected.has(index);
                return (
                  <li
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[color:var(--findable-surface-2,#17181a)]"
                    key={`${index}-${prompt.language}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!checked && selected.size >= max}
                      id={`question-pick-${index}`}
                      onCheckedChange={() => toggle(index)}
                    />
                    <Input
                      aria-label={labels.editAria}
                      className="h-8 flex-1 text-sm"
                      maxLength={200}
                      onChange={(e) => onEdit(index, e.target.value)}
                      value={prompt.text}
                    />
                    <span className="text-[10px] text-[color:var(--findable-ink-tertiary,#7e8289)]">
                      {prompt.language === "ko" ? "KO" : "EN"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
