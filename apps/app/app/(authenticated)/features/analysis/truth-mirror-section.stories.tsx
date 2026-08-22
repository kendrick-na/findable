import type { Meta, StoryObj } from "@storybook/react";
import { TruthMirrorSection } from "./truth-mirror-section";

/**
 * 「진실의 거울」 — 2026-08-17 세션N-37 (v4 탭7).
 *
 * ⚠️ 숫자·문장은 **실측 분포**를 따른다(지어내지 않는다):
 *   원문 평균 수천 자(샘플 2,496자) · 감성 `neutral` 73% · `negative` 전 데이터셋 0건 ·
 *   7엔진 중 네이버 92 / 다음 41.
 *
 * 세 스토리가 **서로 다른 것을 검사한다**(픽셀이 같은 장식 스토리 금지):
 *   ① 보통(일부는 알고 일부는 모름)  ② 오류가 섞인 경우  ③ 원문이 없는 행
 */
const meta = {
  component: TruthMirrorSection,
  parameters: { layout: "padded" },
  title: "대시보드/진실의 거울",
} satisfies Meta<typeof TruthMirrorSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const excerpt =
  "설화수는 아모레퍼시픽의 프리미엄 한방 화장품 브랜드입니다. 인삼과 한방 성분을 활용한 안티에이징 라인으로 잘 알려져 있으며, 대표 제품으로는 자음생 크림과 윤조 에센스가 있습니다.";

export const 보통: Story = {
  args: {
    brandName: "설화수",
    data: {
      engines: [
        {
          brandMentioned: true,
          engineId: "chatgpt",
          errorMessage: null,
          excerpt,
          mentionPosition: 1,
          sentiment: "neutral",
        },
        {
          brandMentioned: true,
          engineId: "naver",
          errorMessage: null,
          excerpt,
          mentionPosition: 2,
          sentiment: "positive",
        },
        {
          brandMentioned: false,
          engineId: "daum",
          errorMessage: null,
          excerpt: "검색 결과에서 관련 브랜드를 찾지 못했습니다.",
          mentionPosition: null,
          sentiment: null,
        },
      ],
      erroredCount: 0,
      knownCount: 2,
      measuredCount: 3,
    },
  },
};

/** 🔴 오류가 있으면 **분모에서 뺐다는 사실**을 밝혀야 한다(모른다가 아니다). */
export const 오류섞임: Story = {
  args: {
    brandName: "설화수",
    data: {
      engines: [
        {
          brandMentioned: true,
          engineId: "chatgpt",
          errorMessage: null,
          excerpt,
          mentionPosition: 1,
          sentiment: "neutral",
        },
      ],
      erroredCount: 2,
      knownCount: 1,
      measuredCount: 1,
    },
  },
};

/** 원문이 없으면 **지어내지 않고** 없다고 말한다. */
export const 원문없음: Story = {
  args: {
    brandName: "설화수",
    data: {
      engines: [
        {
          brandMentioned: true,
          engineId: "hyperclova",
          errorMessage: null,
          excerpt: "",
          mentionPosition: null,
          sentiment: null,
        },
      ],
      erroredCount: 0,
      knownCount: 1,
      measuredCount: 1,
    },
  },
};

/**
 * 🔬 **브리핑 행 — 질의 축이 다름을 화면이 말하는가**(N-45 · #4-b B-5).
 *
 * 확인할 것 3가지:
 *   ① 라벨이 「네이버 AI 브리핑」인가(`naver-briefing` 슬러그가 노출되면 안 된다)
 *   ② 미노출 배지가 **「이 질문엔 안 떠요」**인가(7엔진의 「우리를 안 말함」과 달라야 한다)
 *   ③ 「효과·후기·장단점으로 물었어요」 안내가 그 줄에 붙는가
 */
export const 브리핑_미노출: Story = {
  args: {
    brandName: "설화수",
    data: {
      engines: [
        {
          brandMentioned: true,
          engineId: "chatgpt",
          errorMessage: null,
          excerpt,
          mentionPosition: 1,
          sentiment: "neutral",
        },
        {
          brandMentioned: false,
          engineId: "naver-briefing",
          errorMessage: null,
          excerpt: "",
          mentionPosition: null,
          sentiment: null,
        },
      ],
      erroredCount: 0,
      knownCount: 1,
      measuredCount: 2,
    },
  },
};

/** 브리핑이 실제로 뜬 경우 — 질의축 안내는 **뜬 경우에도** 붙어야 한다. */
export const 브리핑_노출: Story = {
  args: {
    brandName: "설화수",
    data: {
      engines: [
        {
          brandMentioned: true,
          engineId: "naver-briefing",
          errorMessage: null,
          excerpt:
            "설화수는 아모레퍼시픽의 한방 화장품 브랜드로, 자음생 라인이 대표적입니다.",
          mentionPosition: 1,
          sentiment: "positive",
        },
      ],
      erroredCount: 0,
      knownCount: 1,
      measuredCount: 1,
    },
  },
};
