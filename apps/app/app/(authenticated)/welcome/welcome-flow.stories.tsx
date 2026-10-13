import koDict from "@repo/internationalization/dictionaries/ko.json";
import type { Meta, StoryObj } from "@storybook/react";
import { WelcomeFlow } from "./welcome-flow";
import { WelcomeIntro } from "./welcome-intro";

/**
 * 온보딩 화면 — **눈으로 확인**하기 위한 스토리.
 *
 * 📕 규율(이 저장소 사고 이력): *"테스트는 아는 것만 검증한다"* — 뮤테이션 23종을 통과하고도
 *   스크린샷을 찍자 버그 3건이 나왔다. 그래서 화면은 **반드시 눈으로 본다**.
 *
 * ⚠️ **빈 화면 함정**(N-43): `env` 나 `server-only` 를 import 하는 컴포넌트는 스토리가
 *   **로드조차 안 되고 빈 화면으로 찍힌다**. 이 파일이 부르는 `WelcomeFlow`·`WelcomeIntro`
 *   는 **순수 클라이언트/프리젠테이션** 이라 그 경로를 타지 않는다
 *   (서버 의존은 `page.tsx` 가 먹고 값만 내려준다 — 📕N-37·N-41 주입 패턴).
 *
 * ⚠️ 1단계(`WelcomeIntro`)는 **폼 없이** 껍데기만 본다 — `AssignBrandForm` 은 서버액션을
 *   import 하므로 스토리에 넣으면 Storybook 이 통째로 죽는다(📕함정 메모리).
 */
/** 스토리용 가짜 저장 — 서버액션을 부르지 않는다(부르면 번들이 죽는다). */
const noopSave = () => Promise.resolve({ ok: true } as const);

/** 스토리용 가짜 서버 동작 — 질문 제안은 샘플 문구를 돌려준다(실제 제안이 아니다). */
const sampleQuestions = [
  ["category", "민감성 피부 보습 크림 추천해줘"],
  ["category", "수분 크림 뭐가 좋아?"],
  ["concern", "환절기에 피부가 당기는데 어떻게 해?"],
  ["alternative", "다른 스킨케어 브랜드 뭐 있어?"],
  ["brand", "이 브랜드 후기 어때?"],
] as const;
const fakeActions = (missing: string[]) => ({
  check: () => Promise.resolve({ missing }),
  save: () => Promise.resolve({ ok: true, saved: 2 } as const),
  start: () => Promise.resolve({ ok: true, jobId: "job-1" } as const),
  suggest: () =>
    Promise.resolve({
      ok: true,
      prompts: sampleQuestions.map(([type, text]) => ({
        category:
          type === "brand" ? ("brand" as const) : ("competitor" as const),
        language: "ko" as const,
        text,
        topic: "recommendation" as const,
        type,
      })),
      remaining: 5,
    } as const),
});

/**
 * 🔴 **실제 사전을 쓴다**(가짜 문구를 만들지 않는다). 스토리가 더미 문자열을 쓰면
 *   **사전에 키가 빠져도 화면이 멀쩡해 보여** 눈확인이 무의미해진다.
 *   ⚠️ JSON 을 직접 import 한다 — `getAppDictionary` 는 `server-only` 라 번들이 죽는다.
 */
const t = koDict.app.onboarding as Record<string, string>;

const meta: Meta<typeof WelcomeFlow> = {
  args: {
    detected: {
      confidence: "high",
      reason: "한국 도메인(.kr)이라 국내 중심으로 잡았습니다.",
      scope: "korea",
    },
    actions: fakeActions([]),
    brandDomain: "example.com",
    industryOther: false,
    initialNoCompetitors: false,
    initialQuestionCount: 0,
    onSave: noopSave,
    questionLabels: koDict.app.questionPicker,
    t,
  },
  component: WelcomeFlow,
  parameters: {
    layout: "fullscreen",
    // 🔴 `nextjs.appDirectory` 필수 — `WelcomeFlow` 가 `useRouter()`(App Router)를 쓴다.
    //   없으면 스토리가 *"Tried to access router mocks"* 로 죽는다(N-44 실측).
    //   📕 `prompt-list.stories.tsx` 가 같은 이유로 이미 쓰고 있다.
    nextjs: { appDirectory: true },
  },
  title: "온보딩/WelcomeFlow",
};

export default meta;

type Story = StoryObj<typeof WelcomeFlow>;

/** 2단계 — 별칭 입력(빈 상태). 「비워두고 넘어가도 괜찮아요」가 보여야 한다. */
export const Step2Variants: Story = {
  args: {
    brandId: "brand-1",
    brandName: "아모레퍼시픽",
    suggestedCompetitors: ["LG생활건강", "올리브영", "미샤"],
  },
};

/** 브랜드명이 긴 경우 — 한국어 줄바꿈(`keep-all`)이 깨지지 않는지. */
export const LongBrandName: Story = {
  args: {
    brandId: "brand-2",
    brandName: "주식회사 대한민국화장품연구소인터내셔널",
    suggestedCompetitors: [
      "엘지생활건강주식회사",
      "씨제이올리브영주식회사",
      "아모레퍼시픽그룹",
    ],
  },
};

/** 제안 경쟁사가 없는 경우 — 「직접 추가」만 남아야 한다(빈 블록 금지). */
export const NoSuggestions: Story = {
  args: {
    brandId: "brand-3",
    brandName: "인디고차일드",
    suggestedCompetitors: [],
  },
};

/** 1단계 껍데기 — 제목·설명·2단 배치. 폼은 서버액션이라 여기 넣지 않는다. */
export const Step1Intro: StoryObj<typeof WelcomeIntro> = {
  render: () => (
    <WelcomeIntro t={t}>
      <div className="findable-card p-6 text-[color:var(--findable-ink-subtle,#8a8f98)] text-sm">
        (여기에 기존 AssignBrandForm 이 들어갑니다 — 서버액션이라 스토리에서는
        제외)
      </div>
    </WelcomeIntro>
  ),
};

/** 추정 확신도가 낮은 경우 — 「한 번 봐주세요」 한 줄이 더 붙어야 한다. */
export const LowConfidenceScope: Story = {
  args: {
    brandId: "brand-4",
    brandName: "example",
    detected: {
      confidence: "low",
      reason:
        "도메인만으로는 시장을 좁히기 어려워 국내·해외 함께로 두었습니다.",
      scope: "both",
    },
  },
};

/** 5단계 — 질문 승인. 처음엔 [질문 제안받기]만 보이고, 받은 뒤에도 **아무것도 선택돼 있지 않다**. */
export const Step5Questions: Story = {
  args: { brandId: "brand-5", brandName: "아모레퍼시픽", initialStep: 5 },
};

/** 6단계 — 모두 갖춤: [설정 저장하고 측정 시작]. */
export const Step6Ready: Story = {
  args: {
    brandId: "brand-6",
    brandName: "아모레퍼시픽",
    initialStep: 6,
    initialVariants: ["아모레", "Amorepacific"],
    initialCompetitors: ["LG생활건강"],
  },
};

/**
 * 6단계 — 질문·경쟁사가 비어 있음: 안내 + **[기본값으로 진행하고 측정 시작]**(명시 선택이 기록된다).
 * 🔴 "측정은 이미 시작됐어요"라고 말하지 않는다 — 아직 시작 전이다.
 */
export const Step6SetupGap: Story = {
  args: {
    actions: fakeActions(["competitors", "discovery_prompt"]),
    brandId: "brand-7",
    brandName: "아모레퍼시픽",
    initialStep: 6,
  },
};

/** 4단계 — '경쟁사 없음' 선택지. 경쟁사가 있으면 비활성이다. */
export const Step4NoCompetitors: Story = {
  args: {
    brandId: "brand-8",
    brandName: "아모레퍼시픽",
    initialNoCompetitors: true,
    initialStep: 4,
    suggestedCompetitors: [],
  },
};
