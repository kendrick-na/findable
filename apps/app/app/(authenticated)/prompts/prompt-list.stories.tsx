import type { Meta, StoryObj } from "@storybook/nextjs";
import { PromptList } from "./prompt-list";

/**
 * 「추적 질문」 목록 스토리 (세션N-41).
 *
 * 🔴 이 화면은 **지우는 화면**이라 눈으로 봐야 하는 상태가 셋이다:
 *   ① 측정 기록이 있는 질문(삭제하면 시계열이 함께 사라진다 → 확인 문구)
 *   ② 측정 전 질문(잃을 게 없다 → 바로 삭제)
 *   ③ 빈 목록(막다른 길이 되지 않게 다음 행동을 준다)
 *
 * ⚠️ 삭제·수정은 **주입**받는다(`onDelete`·`onEdit`). 스토리는 서버를 타지 않는
 *   스텁을 넘긴다 — 서버액션을 import 하면 `node:*` 가 번들로 끌려와
 *   **preview 빌드가 통째로 죽는다**(N-41 실측 · N-37 과 같은 함정).
 */
const meta = {
  title: "대시보드/추적 질문 목록",
  component: PromptList,
  parameters: {
    layout: "padded",
    /**
     * 🔴 `nextjs.appDirectory` 필수 — 이 컴포넌트는 `useRouter()`(App Router)를 쓴다.
     *   없으면 *"Tried to access router mocks from next/navigation but they were not
     *   created yet"* 로 **스토리가 에러 화면**이 된다(실측 N-41).
     *   ⚠️ 이 저장소의 첫 `useRouter` 스토리라 선례가 없었다 — 파라미터 이름은
     *   설치된 `@storybook/nextjs@10.3.6` 의 `dist/index.d.ts:42` 에서 확인했다
     *   (기억으로 쓰지 않는다).
     */
    nextjs: { appDirectory: true },
  },
  args: {
    // 서버 없이 성공만 반환하는 스텁(측정 기록 3건이 사라진 것처럼).
    onDelete: () => Promise.resolve({ ok: true as const, deletedTrackings: 3 }),
    // RICE#8 — 서버 없이 성공만 반환하는 스텁. 모든 기존 스토리에도 자동으로
    //   편집 버튼이 나타나 시각 검증이 된다.
    onEdit: () => Promise.resolve({ ok: true as const }),
  },
} satisfies Meta<typeof PromptList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 측정 기록이 쌓인 질문들 — 삭제 시 사라지는 양이 보여야 한다. */
export const 측정기록있음: Story = {
  args: {
    prompts: [
      {
        id: "p1",
        text: "설화수 쿠션 추천해줘",
        language: "ko",
        category: "recommendation",
        measuredCount: 7,
      },
      {
        id: "p2",
        text: "40대 여성 안티에이징 화장품 브랜드 비교",
        language: "ko",
        category: "comparison",
        measuredCount: 21,
      },
      {
        id: "p3",
        text: "best korean skincare brands for anti-aging",
        language: "en",
        category: "comparison",
        measuredCount: 14,
      },
    ],
  },
};

/** 아직 측정 전 — 확인 없이 바로 삭제된다(없는 위험에 경고를 물리지 않는다). */
export const 측정전: Story = {
  args: {
    prompts: [
      {
        id: "p9",
        text: "인디고차일드 AI 에이전시 후기",
        language: "ko",
        category: "recommendation",
        measuredCount: 0,
      },
    ],
  },
};

/** 빈 목록 — 다음 행동을 안내한다. */
export const 빈목록: Story = { args: { prompts: [] } };

/** 카테고리가 없는 과거 데이터(스키마상 nullable) — 배지가 사라져도 줄이 안 깨져야 한다. */
export const 카테고리없음: Story = {
  args: {
    prompts: [
      {
        id: "p7",
        text: "카테고리 없이 저장된 옛 질문",
        language: "ko",
        category: null,
        measuredCount: 3,
      },
    ],
  },
};

/**
 * 🔴 **유형별 묶음** — 태깅 정교화(N-42) 이후 실제로 보이는 모양.
 *   순서는 GEO 중요도순(카테고리 1위 → 비교 → 대안 → 추천 → 구매 가이드).
 */
export const 유형별묶음: Story = {
  args: {
    prompts: [
      {
        id: "t1",
        text: "40대 안티에이징 화장품 1위 브랜드는?",
        language: "ko",
        category: "best_in_category",
        measuredCount: 12,
      },
      {
        id: "t2",
        text: "설화수와 헤라 비교해줘",
        language: "ko",
        category: "comparison",
        measuredCount: 9,
      },
      {
        id: "t3",
        text: "설화수 대신 쓸 만한 브랜드",
        language: "ko",
        category: "alternative",
        measuredCount: 4,
      },
      {
        id: "t4",
        text: "설화수 쿠션 추천해줘",
        language: "ko",
        category: "recommendation",
        measuredCount: 7,
      },
      {
        id: "t5",
        text: "안티에이징 화장품 고르는 기준",
        language: "ko",
        category: "buying_guide",
        measuredCount: 0,
      },
      /*
       * ⚠️ 이 6번째 질문이 **이 스토리를 유효하게 만든다.**
       *   앞의 5개는 유형이 전부 달라 **1칸짜리 묶음 5개**여서, 묶음의 값(같은 유형이
       *   몇 개 몰렸는지)을 하나도 보여주지 못했다. `비교` 를 2칸으로 만들어
       *   **제목의 개수 표기(`비교 2`)가 실제로 도는지**까지 이 스토리가 검사하게 한다.
       */
      {
        id: "t6",
        text: "설화수랑 후 중에 뭐가 나아?",
        language: "ko",
        category: "comparison",
        measuredCount: 6,
      },
    ],
  },
};

/**
 * 🔴 **유형이 다 달라 1칸씩이면 묶지 않는다** — 평면 목록으로 떨어진다.
 *
 * > 사고(N-43): 가드가 `groups.length <= 1`(묶음 **개수**)이라 이 경우를 놓쳤고
 * > **1칸짜리 묶음 5개**가 그려졌다. 제목만 5줄 늘고 얻는 정보는 0이다.
 * > `한유형뿐_묶지않음` 은 *한 유형만* 보므로 이 구멍을 잡지 못한다 — 그래서 이 스토리가 필요하다.
 */
export const 다유형_전부1칸_묶지않음: Story = {
  args: {
    prompts: [
      {
        id: "o1",
        text: "40대 안티에이징 화장품 1위 브랜드는?",
        language: "ko",
        category: "best_in_category",
        measuredCount: 12,
      },
      {
        id: "o2",
        text: "설화수와 헤라 비교해줘",
        language: "ko",
        category: "comparison",
        measuredCount: 9,
      },
      {
        id: "o3",
        text: "설화수 대신 쓸 만한 브랜드",
        language: "ko",
        category: "alternative",
        measuredCount: 4,
      },
    ],
  },
};

/** 🔴 **한 유형뿐이면 묶지 않는다** — 아코디언 한 칸은 장식이라 평면 목록으로 떨어진다. */
export const 한유형뿐_묶지않음: Story = {
  args: {
    prompts: [
      {
        id: "s1",
        text: "설화수 추천해줘",
        language: "ko",
        category: "recommendation",
        measuredCount: 3,
      },
      {
        id: "s2",
        text: "설화수 어때?",
        language: "ko",
        category: "recommendation",
        measuredCount: 1,
      },
    ],
  },
};

/** 유형 없는 과거 질문이 섞인 경우 — 「유형 없음」 칸이 **맨 뒤**에 온다. */
export const 유형없음_섞임: Story = {
  args: {
    prompts: [
      {
        id: "m1",
        text: "설화수 쿠션 추천해줘",
        language: "ko",
        category: "recommendation",
        measuredCount: 5,
      },
      {
        id: "m2",
        text: "러너 폴백으로 심긴 옛 질문",
        language: "ko",
        category: null,
        measuredCount: 2,
      },
    ],
  },
};
