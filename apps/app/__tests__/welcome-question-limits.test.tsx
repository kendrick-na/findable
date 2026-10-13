import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 5단계 질문 단계 — 한도 안내 · 제안 보존 (2026-10-14).
 *
 * 🔴 계약:
 *   ① 일부만 저장되면(플랜 상한) 조용히 넘어가지 않고 「N개 중 M개」 + [요금제 보기] 로 알린다
 *   ② 한도 초과 오류는 [요금제 보기] 길을 함께 준다
 *   ③ 이미 상한이면 AI 제안(원가)을 막고 안내만 한다
 *   ④ 받아 둔 제안·선택은 단계를 오가거나 새로고침해도 되살아난다(AI 재호출 없음), 저장 뒤엔 비운다
 *   ⑤ 저장소가 막힌 브라우저에서도 화면은 동작한다
 *
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, refresh: vi.fn() }),
}));
vi.mock("@repo/design-system/components/ui/sonner", () => ({
  toast: {
    warning: h.warning,
    error: h.error,
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import type { WelcomeActions } from "../app/(authenticated)/welcome/welcome-flow";
import { WelcomeQuestionStep } from "../app/(authenticated)/welcome/welcome-question-step";

const t = koDict.app.onboarding as Record<string, string>;
const prompt = (text: string, type: string) => ({
  category: "competitor" as const,
  language: "ko" as const,
  text,
  topic: "best_in_category" as const,
  type: type as never,
});
const suggestions = [
  prompt("민감성 피부 크림 추천해줘", "category"),
  prompt("수분 크림 뭐가 좋아?", "category"),
  prompt("피부가 당기면 어떻게 해?", "concern"),
];

const makeActions = (
  save: WelcomeActions["save"] = () => Promise.resolve({ ok: true, saved: 1 })
) => ({
  check: vi.fn(() => Promise.resolve({ missing: [] })),
  save: vi.fn(save),
  start: vi.fn(() => Promise.resolve({ ok: true, jobId: "j" } as const)),
  suggest: vi.fn(() =>
    Promise.resolve({ ok: true, prompts: suggestions, remaining: 3 } as const)
  ),
});

const renderStep = (
  actions: ReturnType<typeof makeActions>,
  over: {
    questionLimit?: number | null;
    savedCount?: number;
    onNext?: () => Promise<void>;
  } = {}
) =>
  render(
    <WelcomeQuestionStep
      actions={actions}
      brandId="brand-1"
      busy={false}
      industryOther={false}
      labels={koDict.app.questionPicker}
      onNext={over.onNext ?? (() => Promise.resolve())}
      onSkip={vi.fn()}
      questionLimit={over.questionLimit ?? null}
      quickStart={{ label: t.quickStart, onClick: vi.fn() }}
      savedCount={over.savedCount ?? 0}
      t={t}
      total={6}
    />
  );

const pickAllAndNext = async () => {
  fireEvent.click(
    await screen.findByRole("button", { name: "추천 구성으로 담기" })
  );
  fireEvent.click(screen.getByRole("button", { name: t.next }));
};

beforeEach(() => {
  window.sessionStorage.clear();
  for (const fn of Object.values(h)) {
    fn.mockReset();
  }
});
afterEach(() => cleanup());

describe("저장 결과 안내", () => {
  it("일부만 저장되면 「N개 중 M개」 경고와 [요금제 보기]를 준다", async () => {
    const actions = makeActions(() =>
      Promise.resolve({
        capped: true,
        limit: 5,
        ok: true,
        requested: 3,
        saved: 2,
      })
    );
    renderStep(actions);
    fireEvent.click(screen.getByRole("button", { name: t.questionSuggest }));
    await pickAllAndNext();
    await waitFor(() => expect(h.warning).toHaveBeenCalled());
    const [message, opts] = h.warning.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toContain("3개 중 2개");
    expect(message).toContain("5개");
    expect(opts.action.label).toBe("요금제 보기");
    opts.action.onClick();
    expect(h.push).toHaveBeenCalledWith("/billing");
  });

  it("한도 초과 오류는 [요금제 보기]를 함께 준다", async () => {
    const actions = makeActions(() =>
      Promise.resolve({ code: "prompt_limit", error: "한도 도달", limit: 5 })
    );
    renderStep(actions);
    fireEvent.click(screen.getByRole("button", { name: t.questionSuggest }));
    await pickAllAndNext();
    await waitFor(() => expect(h.error).toHaveBeenCalled());
    const [message, opts] = h.error.mock.calls[0] as [
      string,
      { action?: { label: string } },
    ];
    expect(message).toBe("한도 도달");
    expect(opts.action?.label).toBe("요금제 보기");
  });
});

describe("이미 상한이면 AI 제안을 막는다", () => {
  it("저장된 수 ≥ 상한 → 제안 버튼 없음(원가 보호) + 안내 + [요금제 보기]", () => {
    const actions = makeActions();
    renderStep(actions, { questionLimit: 5, savedCount: 5 });
    expect(
      screen.queryByRole("button", { name: t.questionSuggest })
    ).toBeNull();
    expect(screen.getByText(/추적 질문 한도\(5개\)에 도달/)).toBeTruthy();
    expect(actions.suggest).not.toHaveBeenCalled();
  });

  it("상한 아래면 제안 버튼이 있다 · 상한이 없으면(null) 항상 있다", () => {
    renderStep(makeActions(), { questionLimit: 30, savedCount: 5 });
    expect(
      screen.getByRole("button", { name: t.questionSuggest })
    ).toBeTruthy();
    cleanup();
    renderStep(makeActions(), { questionLimit: null, savedCount: 999 });
    expect(
      screen.getByRole("button", { name: t.questionSuggest })
    ).toBeTruthy();
  });
});

describe("제안·선택 보존", () => {
  it("단계를 떠났다 돌아오면 받아 둔 제안·선택이 되살아나고 AI 를 다시 부르지 않는다", async () => {
    const first = makeActions();
    renderStep(first);
    fireEvent.click(screen.getByRole("button", { name: t.questionSuggest }));
    fireEvent.click(
      await screen.findByRole("button", { name: "추천 구성으로 담기" })
    );
    expect(screen.getByText("3개 선택 · 최대 3개")).toBeTruthy();
    cleanup(); // 다른 단계로 갔다 옴

    const second = makeActions();
    renderStep(second);
    await screen.findByText("3개 선택 · 최대 3개");
    expect(second.suggest).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("질문 문구 수정")).toHaveLength(3);
  });

  it("저장에 성공하면 보존한 제안을 비운다", async () => {
    const actions = makeActions();
    renderStep(actions);
    fireEvent.click(screen.getByRole("button", { name: t.questionSuggest }));
    await pickAllAndNext();
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem("findable.question-draft.brand-1")
      ).toBeNull()
    );
  });

  it("저장소가 막혀 있어도(예외) 화면은 동작한다", async () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const actions = makeActions();
    renderStep(actions);
    fireEvent.click(screen.getByRole("button", { name: t.questionSuggest }));
    await screen.findByRole("button", { name: "추천 구성으로 담기" });
    spy.mockRestore();
    setSpy.mockRestore();
  });

  it("옛/이상한 보존값은 무시한다", () => {
    window.sessionStorage.setItem(
      "findable.question-draft.brand-1",
      JSON.stringify({ max: 3, prompts: [{ nope: 1 }], selected: [9] })
    );
    renderStep(makeActions());
    expect(
      screen.getByRole("button", { name: t.questionSuggest })
    ).toBeTruthy();
  });
});
