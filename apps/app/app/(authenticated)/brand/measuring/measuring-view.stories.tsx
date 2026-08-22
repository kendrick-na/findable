import type { Meta, StoryObj } from "@storybook/react";
import { MeasuringView } from "./measuring-view";

/**
 * 측정 대기 화면 — 온보딩 직후 사용자가 **1~3분 동안 보는 화면**.
 *
 * ⚠️ 폴링은 **주입**이라 스토리에서는 가짜를 넣는다(서버액션을 부르면 번들이 죽는다).
 *   여기서 눈으로 볼 것은 **여백·중앙정렬·문구**이지 폴링 동작이 아니다.
 */
const meta: Meta<typeof MeasuringView> = {
  args: {
    domain: "amorepacific.com",
    jobId: "job-1",
    // 계속 측정 중인 상태로 둔다(화면을 그대로 보기 위해).
    pollStatus: () => Promise.resolve("processing"),
    sampleUrl: "https://findable.co.kr/audit/sample?shared=1",
  },
  component: MeasuringView,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  title: "온보딩/MeasuringView",
};

export default meta;

/** 측정 중 — 샘플 리포트 한 줄이 보여야 한다(기다리는 것의 설명). */
export const Measuring: StoryObj<typeof MeasuringView> = {};
