import koDict from "@repo/internationalization/dictionaries/ko.json";
import type { Meta, StoryObj } from "@storybook/react";
import { BrandProfileEditor } from "./brand-profile-editor";

/**
 * 별칭·경쟁사 편집 — 온보딩을 건너뛴 사람의 **유일한 경로**(남은일 1-c).
 * ⚠️ 저장은 주입이라 스토리에서는 가짜를 넣는다(서버액션을 부르면 번들이 죽는다).
 */
const meta: Meta<typeof BrandProfileEditor> = {
  args: {
    brandId: "brand-1",
    onSave: () => Promise.resolve({ ok: true } as const),
    // 실제 사전을 쓴다 — 더미 문구면 키 누락을 눈으로 못 잡는다.
    t: koDict.app.onboarding as Record<string, string>,
  },
  component: BrandProfileEditor,
  parameters: { layout: "padded", nextjs: { appDirectory: true } },
  title: "온보딩/BrandProfileEditor",
};

export default meta;
type Story = StoryObj<typeof BrandProfileEditor>;

/** 아직 아무것도 안 넣은 상태 — 온보딩을 건너뛴 사람이 보는 모습. */
export const Empty: Story = {
  args: { competitors: [], entityVariants: [] },
};

/** 이미 값이 있는 상태 — 온보딩에서 넣고 나중에 고치러 온 경우. */
export const Filled: Story = {
  args: {
    competitors: ["LG생활건강", "올리브영"],
    entityVariants: ["아모레", "Amorepacific"],
  },
};
