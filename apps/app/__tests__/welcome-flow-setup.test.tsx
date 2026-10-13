import koDict from "@repo/internationalization/dictionaries/ko.json";
/**
 * 온보딩 4~6단계 동작(2026-10-13) — 경쟁사 없음 · 질문 승인 · 측정 시작.
 *
 * 🔬 검증 계약: ①'경쟁사 없음'은 경쟁사가 비었을 때만 체크할 수 있고 저장에 noCompetitors 로 실린다
 *   ②6단계는 서버 규칙(check)이 비어 있다고 한 항목이 있으면 안내 + 「기본값으로 진행」(skippedSetup=true)
 *   ③다 갖췄으면 「측정 시작」(skippedSetup=false) ④한도 초과·실패를 "시작됐어요"로 말하지 않는다
 *   ⑤2~5단계에 「지금은 기본값으로 바로 측정」 지름길이 있고 누르면 skippedSetup=true 로 시작한다
 *   ⑥'브랜드 추가'(persistStep=false)는 조직의 온보딩 단계·완료를 건드리지 않는다.
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
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));
vi.mock("recharts", () => ({
  Line: () => null,
  LineChart: () => null,
  ResponsiveContainer: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import {
  type WelcomeActions,
  WelcomeFlow,
} from "../app/(authenticated)/welcome/welcome-flow";

const t = koDict.app.onboarding as Record<string, string>;

const makeActions = (
  missing: string[],
  startResult: Awaited<ReturnType<WelcomeActions["start"]>> = {
    jobId: "job-1",
    ok: true,
  }
) => ({
  check: vi.fn(
    (): ReturnType<WelcomeActions["check"]> => Promise.resolve({ missing })
  ),
  save: vi.fn(
    (): ReturnType<WelcomeActions["save"]> =>
      Promise.resolve({ ok: true, saved: 1 })
  ),
  start: vi.fn(
    (
      _input: Parameters<WelcomeActions["start"]>[0]
    ): ReturnType<WelcomeActions["start"]> => Promise.resolve(startResult)
  ),
  suggest: vi.fn(
    (): ReturnType<WelcomeActions["suggest"]> =>
      Promise.resolve({ ok: true, prompts: [], remaining: 5 })
  ),
});

const renderFlow = (
  props: Partial<React.ComponentProps<typeof WelcomeFlow>> & {
    actions: ReturnType<typeof makeActions>;
  }
) => {
  const onSave = vi.fn(
    (
      _input: Parameters<React.ComponentProps<typeof WelcomeFlow>["onSave"]>[0]
    ): ReturnType<React.ComponentProps<typeof WelcomeFlow>["onSave"]> =>
      Promise.resolve({ ok: true })
  );
  render(
    <WelcomeFlow
      brandDomain="franz.example"
      brandId="brand-1"
      brandName="프란츠"
      detected={{ confidence: "high", reason: "r", scope: "korea" }}
      initialNoCompetitors={false}
      initialQuestionCount={0}
      onSave={onSave}
      questionLabels={koDict.app.questionPicker}
      t={t}
      {...props}
    />
  );
  return { onSave };
};

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("4단계 — 경쟁사 없음", () => {
  it("체크하고 다음을 누르면 noCompetitors 로 저장한다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({ actions, initialStep: 4 });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /비교할 경쟁사가 없어요/ })
    );
    fireEvent.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      competitors: [],
      noCompetitors: true,
    });
  });

  it("경쟁사가 있으면 '없음'을 체크할 수 없다", () => {
    renderFlow({
      actions: makeActions([]),
      initialCompetitors: ["라운드랩"],
      initialStep: 4,
    });
    const box = screen.getByRole("checkbox", {
      name: /비교할 경쟁사가 없어요/,
    });
    expect(box.getAttribute("data-disabled")).not.toBeNull();
  });
});

describe("6단계 — 확인하고 측정 시작", () => {
  it("질문·경쟁사가 비었으면 안내하고 「기본값으로 진행」(skippedSetup=true)으로 시작한다", async () => {
    const actions = makeActions(["competitors", "discovery_prompt"]);
    renderFlow({ actions, initialStep: 6 });
    await screen.findByText(t.setupMissingTitle);
    // 측정이 이미 시작됐다고 말하지 않는다.
    expect(screen.queryByText(/이미 시작됐/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.startDefault }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(actions.start).toHaveBeenCalledWith({
      brandName: "프란츠",
      domain: "franz.example",
      skippedSetup: true,
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/brand/measuring?job=job-1")
    );
  });

  it("다 갖췄으면 안내 없이 「측정 시작」(skippedSetup=false)", async () => {
    const actions = makeActions([]);
    renderFlow({ actions, initialStep: 6 });
    const button = await screen.findByRole("button", { name: t.startMeasure });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.queryByText(t.setupMissingTitle)).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(actions.start.mock.calls[0]?.[0].skippedSetup).toBe(false);
  });

  it("한도 초과(rate_limited)는 성공처럼 말하지 않고 대시보드로 안내한다", async () => {
    const actions = makeActions([], {
      code: "rate_limited",
      error: "오늘은 이미 측정했어요.",
    });
    renderFlow({ actions, initialStep: 6 });
    const button = await screen.findByRole("button", { name: t.startMeasure });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("설정 저장이 실패하면 측정을 시작하지 않는다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({ actions, initialStep: 6 });
    onSave.mockResolvedValueOnce({ error: "저장 실패" });
    const button = await screen.findByRole("button", { name: t.startMeasure });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(button);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(actions.start).not.toHaveBeenCalled();
  });
});

describe("지름길과 '브랜드 추가' 모드", () => {
  it("2~5단계에 「지금은 기본값으로 바로 측정」이 있고 누르면 skippedSetup=true 로 시작한다", async () => {
    for (const step of [2, 3, 4, 5]) {
      const actions = makeActions([]);
      renderFlow({ actions, initialStep: step });
      fireEvent.click(screen.getByRole("button", { name: t.quickStart }));
      await waitFor(() => expect(actions.start).toHaveBeenCalled());
      expect(actions.start.mock.calls[0]?.[0].skippedSetup).toBe(true);
      cleanup();
    }
  });

  it("persistStep=false 는 조직의 온보딩 단계·완료를 저장하지 않는다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({
      actions,
      initialStep: 3,
      persistStep: false,
    });
    fireEvent.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sent = onSave.mock.calls[0]?.[0] ?? {};
    expect(sent).not.toHaveProperty("onboardingStep");
    expect(sent).not.toHaveProperty("completeOnboarding");
  });

  it("첫 온보딩(persistStep 기본)은 단계를 저장한다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({ actions, initialStep: 3 });
    fireEvent.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ onboardingStep: 4 });
  });
});

describe("저장값 우선 · AI 후보는 확인 전엔 저장하지 않는다 (2026-10-13 회귀)", () => {
  const ai = ["AI후보1", "AI후보2"];
  const lastSave = (onSave: { mock: { calls: unknown[][] } }) =>
    (onSave.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;

  it("저장된 경쟁사가 있으면 '설정 이어가기'(2단계 시작)에서도 AI 후보로 덮어쓰지 않는다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({
      actions,
      initialCompetitors: ["라운드랩"],
      initialStep: 2,
      persistStep: false,
      suggestedCompetitors: ai,
    });
    fireEvent.click(screen.getByRole("button", { name: t.quickStart }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(lastSave(onSave).competitors).toEqual(["라운드랩"]);
  });

  it("'없음'을 저장했으면 AI 후보를 채우지 않고 그대로 '없음'으로 저장한다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({
      actions,
      initialNoCompetitors: true,
      initialStep: 2,
      persistStep: false,
      suggestedCompetitors: ai,
    });
    fireEvent.click(screen.getByRole("button", { name: t.quickStart }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(lastSave(onSave)).toMatchObject({
      competitors: [],
      noCompetitors: true,
    });
  });

  it("4단계를 건너뛰고 바로 측정해도 AI 후보를 저장하지 않는다(사용자가 확인한 값만)", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({
      actions,
      initialStep: 4,
      suggestedCompetitors: ai,
    });
    // 화면에는 미리 채워져 보이지만…
    expect(screen.getByText("AI후보1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.skip }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // …건너뛰기 저장에는 경쟁사가 없다.
    expect(lastSave(onSave)).not.toHaveProperty("competitors");
    fireEvent.click(await screen.findByRole("button", { name: t.quickStart }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(lastSave(onSave)).not.toHaveProperty("competitors");
    expect(lastSave(onSave)).not.toHaveProperty("noCompetitors");
  });

  it("2단계에서 바로 측정해도(4단계 안 거침) AI 후보를 저장하지 않는다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({
      actions,
      initialStep: 2,
      suggestedCompetitors: ai,
    });
    fireEvent.click(screen.getByRole("button", { name: t.quickStart }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(lastSave(onSave)).not.toHaveProperty("competitors");
  });

  it("4단계 [다음]으로 확인한 값은 이후 측정 시작에도 저장된다", async () => {
    const actions = makeActions([]);
    const { onSave } = renderFlow({
      actions,
      initialStep: 4,
      suggestedCompetitors: ai,
    });
    fireEvent.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(lastSave(onSave).competitors).toEqual(ai);
    fireEvent.click(await screen.findByRole("button", { name: t.quickStart }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    expect(lastSave(onSave).competitors).toEqual(ai);
  });

  it("이미 저장된 질문 수를 5단계에 보여 준다", () => {
    renderFlow({
      actions: makeActions([]),
      initialQuestionCount: 7,
      initialStep: 5,
    });
    expect(screen.getByText("추적 질문 7개")).toBeTruthy();
  });
});
