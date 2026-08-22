"use client";

import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Input } from "@repo/design-system/components/ui/input";
import { toast } from "@repo/design-system/components/ui/sonner";
import { Spinner } from "@repo/design-system/components/ui/spinner";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  saveApprovedPromptsAction,
  suggestPromptsAction,
} from "@/app/actions/brand/suggest-prompts";

/**
 * 프롬프트 자동 제안 마법사 (표준 백로그 1, 2026-07-30) + 직접 추가(2026-08-22).
 *
 * 흐름 A(AI 제안): [AI 추적 질문 제안받기] → 서버가 브랜드 맥락으로 질문 ~20개·경쟁사
 *   후보 생성 → 사용자가 체크박스로 승인(기본 전체 선택) → [선택한 질문 저장] →
 *   Prompt 테이블 upsert.
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

const CATEGORY_LABEL: Record<SuggestedPrompt["category"], string> = {
  brand: "브랜드",
  competitor: "경쟁·카테고리",
};

const LANG_LABEL: Record<SuggestedPrompt["language"], string> = {
  ko: "KO",
  en: "EN",
};

// 제안 프롬프트의 안정 키(텍스트 소문자) — 선택 상태 Set의 원소.
const promptKey = (p: SuggestedPrompt): string => p.text.toLowerCase();

export const PromptWizard = ({ brandId }: { brandId: string }) => {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompts, setPrompts] = useState<SuggestedPrompt[]>([]);
  const [competitors, setCompetitors] = useState<string[]>([]);
  // 승인된 프롬프트 키 집합. 제안받으면 전체 선택으로 시작(대부분 채택 전제).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customText, setCustomText] = useState("");

  const addCustom = async () => {
    const text = customText.trim();
    if (text.length < 3) {
      toast.error("질문을 3자 이상 입력해 주세요.");
      return;
    }
    if (text.length > MAX_CUSTOM_PROMPT_LENGTH) {
      toast.error(`질문은 ${MAX_CUSTOM_PROMPT_LENGTH}자 이내로 입력해 주세요.`);
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
          result.error.includes("상한")
            ? {
                action: {
                  label: "요금제 보기",
                  onClick: () => router.push("/billing"),
                },
              }
            : undefined
        );
        return;
      }
      toast.success(
        "추적 질문을 추가했어요. 다음 측정부터 이 질문으로 측정돼요."
      );
      setPhase("idle");
      setCustomText("");
      router.refresh();
    } catch {
      setPhase("adding");
      toast.error("추가하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const suggest = async () => {
    setPhase("suggesting");
    try {
      const result = await suggestPromptsAction({ brandId });
      if ("error" in result) {
        setPhase("idle");
        toast.error(result.error);
        return;
      }
      const next = result.suggestions.prompts;
      setPrompts(next);
      setCompetitors(result.suggestions.competitors);
      setSelected(new Set(next.map(promptKey)));
      setPhase("review");
    } catch {
      setPhase("idle");
      toast.error("제안을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const toggle = (p: SuggestedPrompt) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = promptKey(p);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const save = async () => {
    const approved = prompts.filter((p) => selected.has(promptKey(p)));
    if (approved.length === 0) {
      toast.error("저장할 질문을 하나 이상 선택해 주세요.");
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
          `선택한 ${result.requested}개 중 ${result.saved}개를 저장했어요. 현재 플랜 상한(${result.limit}개)을 넘는 분은 저장되지 않았어요.`,
          {
            action: {
              label: "요금제 보기",
              onClick: () => router.push("/billing"),
            },
          }
        );
      } else {
        toast.success(
          `추적 질문 ${result.saved}개를 저장했어요. 다음 측정부터 이 질문으로 측정돼요.`
        );
      }
      setPhase("idle");
      setPrompts([]);
      setCompetitors([]);
      setSelected(new Set());
      router.refresh();
    } catch {
      setPhase("review");
      toast.error("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  if (phase === "idle" || phase === "suggesting") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="findable-btn-secondary"
          disabled={phase === "suggesting"}
          onClick={suggest}
          size="sm"
          type="button"
          variant="outline"
        >
          {phase === "suggesting" ? (
            <span className="inline-flex items-center gap-2">
              <Spinner className="size-3" /> 제안 생성 중…
            </span>
          ) : (
            "AI 추적 질문 제안받기"
          )}
        </Button>
        <Button
          disabled={phase === "suggesting"}
          onClick={() => setPhase("adding")}
          size="sm"
          type="button"
          variant="ghost"
        >
          직접 추가
        </Button>
      </div>
    );
  }

  if (phase === "adding" || phase === "addingSaving") {
    const isSaving = phase === "addingSaving";
    return (
      <div className="flex w-full flex-col gap-2 rounded-lg border border-[color:var(--findable-hairline,#23252a)] bg-[color:var(--findable-surface-1,#0f1011)] p-4">
        <span className="font-medium text-[color:var(--findable-ink,#f7f8f8)] text-sm">
          추적 질문 직접 추가
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
          placeholder="예: 우리 브랜드 어때?"
          value={customText}
        />
        <span className="text-right text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs tabular-nums">
          {customText.length}/{MAX_CUSTOM_PROMPT_LENGTH}
        </span>
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
            취소
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
                <Spinner className="size-3" /> 추가 중…
              </span>
            ) : (
              "추가하기"
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
          AI가 제안한 추적 질문 ({prompts.length})
        </span>
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          측정에 사용할 질문을 골라 저장하세요. 저장한 질문으로 다음 측정부터
          ChatGPT·Perplexity 등에 물어봅니다.
        </span>
      </div>

      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {prompts.map((p, i) => {
          const key = promptKey(p);
          const inputId = `prompt-${brandId}-${i}`;
          return (
            <li key={key}>
              <label
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[color:var(--findable-surface-2,#17181a)]"
                htmlFor={inputId}
              >
                <Checkbox
                  checked={selected.has(key)}
                  className="mt-0.5"
                  id={inputId}
                  onCheckedChange={() => toggle(p)}
                />
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-[color:var(--findable-ink,#f7f8f8)] text-sm">
                    {p.text}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Badge
                      className="border-transparent bg-[color:var(--findable-surface-2,#17181a)] text-[10px] text-[color:var(--findable-ink-subtle,#8a8f98)]"
                      variant="outline"
                    >
                      {CATEGORY_LABEL[p.category]}
                    </Badge>
                    <span className="text-[10px] text-[color:var(--findable-ink-tertiary,#7e8289)]">
                      {LANG_LABEL[p.language]}
                    </span>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {competitors.length > 0 && (
        <div className="flex flex-col gap-1.5 border-[color:var(--findable-hairline,#23252a)] border-t pt-2">
          <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
            제안된 경쟁 브랜드 — 경쟁·카테고리 질문의 답변에서 이 브랜드들과의
            비교가 잡힙니다.
          </span>
          <div className="flex flex-wrap gap-1.5">
            {competitors.map((name) => (
              <Badge
                className="border-[color:var(--findable-hairline,#23252a)] text-[color:var(--findable-ink-subtle,#8a8f98)]"
                key={name}
                variant="outline"
              >
                {name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs">
          {selected.size}개 선택됨
        </span>
        <div className="flex items-center gap-2">
          <Button
            disabled={phase === "saving"}
            onClick={() => {
              setPhase("idle");
              setPrompts([]);
              setCompetitors([]);
              setSelected(new Set());
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            취소
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
                <Spinner className="size-3" /> 저장 중…
              </span>
            ) : (
              `선택한 질문 저장 (${selected.size})`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
