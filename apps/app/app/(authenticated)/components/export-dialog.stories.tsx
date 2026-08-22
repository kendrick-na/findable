import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ExportDialog, type ExportDialogLabels } from "./export-dialog";

/**
 * RICE#5(2026-08-22 N-52) — 사이드바 "데이터 내보내기" 클릭 즉시 다운로드를
 * 확인 모달(기간·컬럼 선택)로 바꾼 것. 서버액션을 import하지 않아
 * Storybook 빌드 함정(PromptWizard 류)에 안 걸린다.
 *
 * 🔴 이 스토리가 눈으로 확인할 것:
 *   ① 기간 4개(7/30/90/전체)가 라디오로 그려지는가, 기본값이 30일인가
 *   ② 인용출처 체크박스가 기본 컬럼 설명과 분리돼 보이는가
 *   ③ 다운로드 버튼이 눌리는가(실제 API 호출은 이 스토리 범위 밖)
 */
const KO_LABELS: ExportDialogLabels = {
  cancel: "그만두기",
  columnsBase: "측정일시·브랜드·엔진·언급여부·순위·감성·점유율 (기본)",
  columnsLabel: "포함할 컬럼",
  description: "측정 데이터를 CSV로 받아요. 기간과 포함할 컬럼을 골라주세요.",
  download: "다운로드",
  downloading: "받는 중…",
  includeSources: "인용출처 추가 (AI가 근거로 든 URL 목록)",
  period30: "최근 30일",
  period7: "최근 7일",
  period90: "최근 90일",
  periodAll: "전체 기간",
  periodLabel: "기간",
  title: "데이터 내보내기",
};

const Wrapper = (props: { labels: ExportDialogLabels }) => {
  const [open, setOpen] = useState(true);
  return (
    <ExportDialog labels={props.labels} onOpenChange={setOpen} open={open} />
  );
};

const meta = {
  component: Wrapper,
  parameters: { layout: "centered" },
  title: "사이드바/데이터 내보내기 모달",
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ⭐ 기본 — 열린 상태. 라디오 기본값·체크박스·버튼 배치 확인. */
export const 열림_기본: Story = {
  args: { labels: KO_LABELS },
};
