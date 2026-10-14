"use client";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Spinner } from "@repo/design-system/components/ui/spinner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  saveApprovedPromptsAction,
  suggestPromptsAction,
} from "@/app/actions/brand/suggest-prompts";
import type { AppDictionary } from "@/lib/i18n";
import { QuestionPicker } from "./question-picker";
import { SiteNoteBox } from "./site-note-box";

/**
 * 프롬프트 자동 제안 마법사 (표준 백로그 1, 2026-07-30) + 직접 추가(2026-08-22).
 *
 * 흐름 A(AI 제안): [AI 추적 질문 제안받기] → 서버가 업종·시장·사이트 문구·별칭·경쟁사로
 *   질문 후보 ~20개 생성 → 사용자가 직접 승인(**기본 전부 미선택**, [추천 구성으로 담기] 버튼,
 *   문구 수정 가능 · 2026-10-13 대표 승인) → [선택한 질문 저장] → Prompt 테이블 upsert.
 * 흐름 B(직접 추가): [직접 추가] → 입력창 1개 → 저장 → 같은 upsert 경로.
 *   🔴 경쟁사 5곳 재조사 결과 Profound만 수동 추가를 지원(Otterly·Peec·Scrunch는
 *   AI 제안·CSV 임포트뿐) — 하지만 Findable은 이미 저장 액션이 임의 텍스트를
 *   받는 구조라(`saveApprovedPromptsAction`은 AI 출처를 안 따진다) 새 서버 로직 없이
 *   같은 경로에 `topic: "custom"` 한 건만 흘리면 된다.
 *   저장된 질문은 다음 측정부터 러너가 우선 사용(고정 4개 대신 맥락 맞춤).
 *
 * StartTrackingButton과 같은 클라이언트 패턴(서버 액션 + sonner 토스트 + 라우터 refresh).
 */

type Phase =
  | "idle"
  | "suggesting"
  | "review"
  | "saving"
  | "adding"
  | "addingSaving";

// 한글이 하나라도 있으면 ko, 아니면 en — 언어 선택 UI 없이 텍스트로 판별
// (온보딩 assign-brand-form.tsx가 이미 같은 방식으로 브랜드명 언어를 가른다).
const HANGUL_RE = /[가-힣]/;
const MAX_CUSTOM_PROMPT_LENGTH = 200;

export const PromptWizard = ({
  brandId,
  industry,
  pickerLabels,
  t,
}: {
  brandId: string;
  /** 업종(Industry enum 값). '기타'면 질문 재료가 적다는 안내를 보인다. */
  industry?: string | null;
  /** 사전 `app.questionPicker` — 질문 고르기 화면 문구. */
  pickerLabels: AppDictionary["questionPicker"];
  /** 사전 `app.promptWizard` (client 라 서버가 넘긴다). */
  t: AppDictionary["promptWizard"];
}) => {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompts, setPrompts] = useState<SuggestedPrompt[]>([]);
  // 승인한 질문의 인덱스. **기본은 전부 미선택**이다(사람이 고른 것만 측정 — 2026-10-13).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // 플랜 상한에서 이미 저장된 질문을 뺀, 더 담을 수 있는 개수.
  const [maxPick, setMaxPick] = useState(0);
  const [customText, setCustomText] = useState("");
  // 사이트 글자가 거의 안 읽혔을 때만 "한 줄 소개" 칸을 보인다.
  const [siteThin, setSiteThin] = useState(false);
  const [siteNote, setSiteNote] = useState("");

  const addCustom = async () => {
    const text = customText.trim();
    if (text.length < 3) {
      toast.error(t.tooShort);
      return;
    }
    if (text.length > MAX_CUSTOM_PROMPT_LENGTH) {
      toast.error(t.tooLong.replace("{max}", String(MAX_CUSTOM_PROMPT_LENGTH)));
      return;
    }
    setPhase("addingSaving");
    try {
      const result = await saveApprovedPromptsAction({
        brandId,
        prompts: [
          {
            text,
            language: HANGUL_RE.test(text) ? "ko" : "en",
            category: "brand",
            topic: "custom",
          },
        ],
      });
      if ("error" in result) {
        setPhase("adding");
        // 🔴 상한 도달 에러만 saveApprovedPromptsAction이 remaining===0일 때
        //   "상한"이 들어간 문구로 반환한다(단건 요청이라 부분저장 케이스는 없음) —
        //   이때만 업그레이드 경로를 함께 준다. 로그인 만료 등 다른 에러는 그대로.
        toast.error(
          result.error,
          "code" in result && result.code === "prompt_limit"
            ? {
                action: {
                  label: t.viewPlans,
                  onClick: () => router.push("/billing"),
                },
              }
            : undefined
        );
        return;
      }
      toast.success(t.added);
      setPhase("idle");
      setCustomText("");
      router.refresh();
    } catch {
      setPhase("adding");
      toast.error(t.addFailed);
    }
  };

  const suggest = async (note?: string) => {
    setPhase("suggesting");
    try {
      const result = await suggestPromptsAction({ brandId, siteNote: note });
      if ("error" in result) {
        setPhase("idle");
        toast.error(result.error);
        return;
      }
      const next = result.suggestions.prompts;
      if (next.length === 0) {
        setPhase("idle");
        toast.error(t.noSuggestions);
        return;
      }
      setPrompts(next);
      setMaxPick(result.remaining);
      setSelected(new Set());
      setSiteThin(Boolean(result.siteThin));
      setPhase("review");
    } catch {
      setPhase("idle");
      toast.error(t.suggestFailed);
    }
  };

  const edit = (index: number, text: string) =>
    setPrompts((prev) =>
      prev.map((p, i) => (i === index ? { ...p, text } : p))
    );

  const save = async () => {
    const approved = prompts
      .filter((_, i) => selected.has(i))
      .map((p) => ({ ...p, text: p.text.trim() }));
    if (approved.length === 0) {
      toast.error(t.selectOne);
      return;
    }
    setPhase("saving");
    try {
      const result = await saveApprovedPromptsAction({
        brandId,
        prompts: approved,
      });
      if ("error" in result) {
        setPhase("review");
        toast.error(result.error);
        return;
      }
      if (result.capped) {
        // 플랜 상한 때문에 일부만 저장됨 — 저장 사실 + 업그레이드 경로를 함께 안내.
        toast.warning(
          t.savedCapped
            .replace("{requested}", String(result.requested))
            .replace("{saved}", String(result.saved))
            .replace("{limit}", String(result.limit)),
          {
            action: {
              label: t.viewPlans,
              onClick: () => router.push("/billing"),
            },
          }
        );
      } else {
        toast.success(t.saved.replace("{n}", String(result.saved)));
      }
      setPhase("idle");
      setPrompts([]);
      setSelected(new Set());
      router.refresh();
    } catch {
      setPhase("review");
      toast.error(t.saveFailed);
    }
  };

  if (phase === "idle" || phase === "suggesting") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {industry === "other" && (
          <p className="w-full text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
            {t.industryOtherNote}
          </p>
        )}
        <Button
          className="findable-btn-secondary"
          disabled={phase === "suggesting"}
          onClick={() => suggest()}
          size="sm"
          type="button"
          variant="outline"
        >
          {phase === "suggesting" ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-3" /> {t.suggesting}
            </span>
          ) : (
            t.suggest
          )}
        </Button>
        <Button
          disabled={phase === "suggesting"}
          onClick={() => setPhase("adding")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t.addManual}
        </Button>
      </div>
    );
  }

  if (phase === "adding" || phase === "addingSaving") {
    const isSaving = phase === "addingSaving";
    return (
      <div className="flex w-full flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
        <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
          {t.addManualTitle}
        </span>
        <Input
          disabled={isSaving}
          maxLength={MAX_CUSTOM_PROMPT_LENGTH}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              addCustom();
            }
          }}
          placeholder={t.placeholder}
          value={customText}
        />
        <span className="text-right text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs tabular-nums">
          {customText.length}/{MAX_CUSTOM_PROMPT_LENGTH}
        </span>
        <p className="text-amber-600 text-xs dark:text-amber-400">
          {t.baselineChange}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button
            disabled={isSaving}
            onClick={() => {
              setPhase("idle");
              setCustomText("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t.cancel}
          </Button>
          <Button
            className="findable-btn-primary"
            disabled={isSaving}
            onClick={addCustom}
            size="sm"
            type="button"
          >
            {isSaving ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-3" /> {t.adding}
              </span>
            ) : (
              t.add
            )}
          </Button>
        </div>
      </div>
    );
  }

  // review / saving — 승인 패널.
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
          {t.suggestedTitle.replace("{n}", String(prompts.length))}
        </span>
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {t.suggestedLede}
        </span>
      </div>

      {siteThin && (
        <SiteNoteBox
          busy={phase === "saving"}
          labels={{
            hint: t.siteNoteHint,
            placeholder: t.siteNotePlaceholder,
            submit: t.siteNoteSubmit,
            title: t.siteNoteTitle,
          }}
          onChange={setSiteNote}
          onSubmit={() => suggest(siteNote)}
          value={siteNote}
        />
      )}
      <QuestionPicker
        labels={pickerLabels}
        max={maxPick}
        onEdit={edit}
        onSelectedChange={setSelected}
        prompts={prompts}
        selected={selected}
      />

      <p className="text-amber-600 text-xs dark:text-amber-400">
        {t.baselineChange}
      </p>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {t.selectedCount.replace("{n}", String(selected.size))}
        </span>
        <div className="flex items-center gap-2">
          <Button
            disabled={phase === "saving"}
            onClick={() => {
              setPhase("idle");
              setPrompts([]);
              setSelected(new Set());
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t.cancel}
          </Button>
          <Button
            className="findable-btn-primary"
            disabled={phase === "saving" || selected.size === 0}
            onClick={save}
            size="sm"
            type="button"
          >
            {phase === "saving" ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-3" /> {t.saving}
              </span>
            ) : (
              t.saveSelected.replace("{n}", String(selected.size))
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
