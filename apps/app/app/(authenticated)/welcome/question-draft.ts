import type { SuggestedPrompt } from "@repo/ai/lib/prompt-suggestions";

/**
 * 5단계 질문 제안·선택을 브라우저 `sessionStorage` 에 보존한다(2026-10-14).
 *
 * 🔴 왜: 단계를 오가거나 새로고침하면 상태가 사라져 **AI 제안을 다시 받아야** 했다(원가·시간).
 *   서버 DB 에 쓰지 않는다(제안은 '후보'일 뿐이다) — 이 브라우저 탭 안에서만 산다.
 * ⚠️ 저장소가 막힌 환경(시크릿 창·차단)에서도 화면은 그대로 동작해야 한다 → 모든 접근을 try/catch.
 */
export interface QuestionDraft {
  max: number;
  prompts: SuggestedPrompt[];
  /** 선택한 질문의 인덱스. */
  selected: number[];
}

const keyOf = (brandId: string) => `findable.question-draft.${brandId}`;

const isDraft = (value: unknown): value is QuestionDraft => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.max === "number" &&
    Array.isArray(v.prompts) &&
    v.prompts.length > 0 &&
    v.prompts.every(
      (p) =>
        p &&
        typeof p === "object" &&
        typeof (p as { text?: unknown }).text === "string"
    ) &&
    Array.isArray(v.selected) &&
    v.selected.every(
      (i) =>
        Number.isInteger(i) && i >= 0 && i < (v.prompts as unknown[]).length
    )
  );
};

export function readQuestionDraft(brandId: string): QuestionDraft | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(brandId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeQuestionDraft(
  brandId: string,
  draft: QuestionDraft
): void {
  try {
    window.sessionStorage.setItem(keyOf(brandId), JSON.stringify(draft));
  } catch {
    // 저장소가 막혀 있어도 화면은 그대로 동작한다.
  }
}

export function clearQuestionDraft(brandId: string): void {
  try {
    window.sessionStorage.removeItem(keyOf(brandId));
  } catch {
    // 위와 같다.
  }
}
