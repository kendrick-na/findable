import en from "@repo/internationalization/dictionaries/en.json";
import ko from "@repo/internationalization/dictionaries/ko.json";
import type { Meta, StoryObj } from "@storybook/react";
import {
  DashboardEmptyStateView,
  type EmptyStateDictionary,
} from "./dashboard-empty-state";

/*
 * 가입 직후 **첫 화면**. 📕 v4 §7-A-1 — 이 화면이 온보딩 표면이다.
 *
 * 🔴 **왜 이 스토리가 필요한가**(N-43): 문구를 사전으로 옮기면서 이 컴포넌트가
 *   `async` + `server-only` 가 됐고, **Storybook 렌더가 통째로 죽었다**
 *   (빈 화면 가드가 6건 전부 잡았다 — tsc 0 · 584/584 통과였는데 화면만 안 나왔다).
 *   → 뷰를 분리하고, 스토리는 **뷰**를 렌더한다.
 *
 * 🔴 **사전을 실제로 읽는다**(고정 문구를 베끼지 않는다). 베끼면 사전을 고쳤을 때
 *   스토리만 옛 문구로 남아 **거짓 안심**을 준다(📕 "가짜 안심을 주는 검사는 없는 것보다 나쁘다").
 */
const t = ko.app.emptyState as EmptyStateDictionary;

const meta = {
  title: "대시보드/가입 직후 첫 화면",
  component: DashboardEmptyStateView,
  parameters: { layout: "padded" },
  // 🔴 `sampleUrl` 을 주입한다 — 뷰가 `env` 를 타면 스토리가 통째로 죽는다(위 주석).
  args: { t, sampleUrl: "https://findable.co.kr/audit/example?shared=1" },
} satisfies Meta<typeof DashboardEmptyStateView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 로그인 이메일이 있을 때 — 무료진단 회수 안내에 주소가 박힌다. */
export const 이메일있음: Story = {
  args: { signedInEmail: "nayoy2@gmail.com" },
};

/**
 * 🔴 **긴 이메일** — 200% 확대(195px)에서 355px 로 삐져나가 가로 스크롤을 만든 이력
 * (WCAG 1.4.10). `[overflow-wrap:anywhere]` 가 살아 있는지 **눈으로** 본다.
 */
export const 긴이메일: Story = {
  args: {
    signedInEmail: "kendrick.verylongaddress+findable@indigochild-global.co.kr",
  },
};

/** 이메일이 없을 때(익명) — 문장이 다른 분기로 떨어진다. */
export const 이메일없음: Story = { args: { signedInEmail: null } };

/** 🌏 영어 사전으로 그린 같은 화면 — 어순·길이가 깨지지 않는지 본다. */
export const 영어: Story = {
  args: {
    signedInEmail: "nayoy2@gmail.com",
    t: en.app.emptyState as EmptyStateDictionary,
  },
};
