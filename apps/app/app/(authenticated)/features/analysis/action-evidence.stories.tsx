import { DONT_LIST } from "@repo/audit/action-rules";
import type { Meta, StoryObj } from "@storybook/react";
import { ActionEvidenceGuide, DontList } from "./action-evidence";

/**
 * 근거 등급 6칸 카드 — 2026-09-28.
 *
 * 🔴 눈으로 확인할 것: ① 등급이 **글자 배지**로 보이는가(색만으로 구분 X)
 *   ② 6칸(적용 AI·작업 시간·효과 시차·재측정 숫자·실패 조건·출처)이 모바일에서 줄바꿈되며 안 잘리는가
 *   ③ 착각 인용 3개가 AI 이름과 함께 읽히는가.
 * 데이터 = 공개 진단 b7f319e1(노우버스)에서 `buildGeoActions` 가 실제로 만든 첫 카드.
 */
const meta = {
  component: ActionEvidenceGuide,
  parameters: { layout: "padded" },
  title: "대시보드/지금 할 일 — 근거 등급",
} satisfies Meta<typeof ActionEvidenceGuide>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 동명_오인_노우버스: Story = {
  args: {
    guide: {
      evidenceGrade: "medium",
      sources: [
        {
          label: "Google 검색 센터 — Organization 구조화 데이터(sameAs)",
          url: "https://developers.google.com/search/docs/appearance/structured-data/organization",
        },
      ],
      engines: ["google", "gemini"],
      effortHours: {
        min: 2,
        max: 4,
        per: "total",
      },
      effectLag:
        "구글이 페이지를 다시 읽어 간 뒤부터(보통 며칠~몇 주). 다른 AI는 반영 시점이 공개돼 있지 않습니다.",
      remeasureMetric: "다른 회사로 착각한 답변 수 (지금 22건 중 8건)",
      failCondition:
        "두 번 다시 재도 착각 비율이 20% 아래로 내려가지 않으면, 소개 문구에 대표 서비스 이름·주소처럼 다른 회사와 겹치지 않는 사실을 더 넣으세요.",
      quotes: [
        {
          engineId: "chatgpt",
          excerpt:
            "노우버스(Knowverse)는 에듀테크 기반의 AI 교육 서비스 브랜드로 알려져 있습니다. 주로 학습용 AI 튜터, 교육 콘텐츠 추천, 맞춤형 학습 지원 같은 서비스를 제공하는 방향의 브랜드로 소개됩니다. 다만, “노우버스”라는 이름을 쓰는 기업/서비…",
        },
        {
          engineId: "claude",
          excerpt:
            '…n about "Noworbus" (노우버스) to give you an accurate answer. 검색 결과를 바탕으로, "노우버스"라는 브랜드에 대해 두 가지 가능한 결과를 찾았습니다. 하나는 광학 기술 기업 NOVUS(노버스), 다른 하나는…',
        },
        {
          engineId: "perplexity",
          excerpt:
            "검색 결과상 ‘노우버스’라는 이름은 여러 곳에서 쓰여 혼동될 수 있습니다. • 노우버스(노우버스): 경기도 성남시에 등록된 온라인 판매 사업자로, 컴퓨터·사무용품 등을 인터넷으로 판매하는 것으로 확인됩니다. 공개된 정보만으로는 별도의 브랜드 서비스나…",
        },
      ],
    },
  },
};

export const 하지_마세요: Story = {
  args: {
    guide: {
      evidenceGrade: "medium",
      sources: [
        {
          label: "Google 검색 센터 — Organization 구조화 데이터(sameAs)",
          url: "https://developers.google.com/search/docs/appearance/structured-data/organization",
        },
      ],
      engines: ["google", "gemini"],
      effortHours: { min: 2, max: 4, per: "total" },
      effectLag:
        "구글이 페이지를 다시 읽어 간 뒤부터(보통 며칠~몇 주). 다른 AI는 반영 시점이 공개돼 있지 않습니다.",
      remeasureMetric: "다른 회사로 착각한 답변 수 (지금 22건 중 8건)",
      failCondition:
        "두 번 다시 재도 착각 비율이 20% 아래로 내려가지 않으면, 소개 문구에 대표 서비스 이름·주소처럼 다른 회사와 겹치지 않는 사실을 더 넣으세요.",
      quotes: [
        {
          engineId: "chatgpt",
          excerpt:
            "노우버스(Knowverse)는 에듀테크 기반의 AI 교육 서비스 브랜드로 알려져 있습니다. 주로 학습용 AI 튜터, 교육 콘텐츠 추천, 맞춤형 학습 지원 같은 서비스를 제공하는 방향의 브랜드로 소개됩니다. 다만, “노우버스”라는 이름을 쓰는 기업/서비…",
        },
        {
          engineId: "claude",
          excerpt:
            '…n about "Noworbus" (노우버스) to give you an accurate answer. 검색 결과를 바탕으로, "노우버스"라는 브랜드에 대해 두 가지 가능한 결과를 찾았습니다. 하나는 광학 기술 기업 NOVUS(노버스), 다른 하나는…',
        },
        {
          engineId: "perplexity",
          excerpt:
            "검색 결과상 ‘노우버스’라는 이름은 여러 곳에서 쓰여 혼동될 수 있습니다. • 노우버스(노우버스): 경기도 성남시에 등록된 온라인 판매 사업자로, 컴퓨터·사무용품 등을 인터넷으로 판매하는 것으로 확인됩니다. 공개된 정보만으로는 별도의 브랜드 서비스나…",
        },
      ],
    },
  },
  render: () => <DontList donts={DONT_LIST} />,
};
