/**
 * 이어가기 중 측정 화면 안내(2026-10-06 · 문구 승인 대기).
 *
 * @vitest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../packages/internationalization/dictionaries/en.json";
import ko from "../../../packages/internationalization/dictionaries/ko.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const { MeasuringView } = await import(
  "../app/(authenticated)/brand/measuring/measuring-view"
);

// 이어가기 문구는 사전 `app.measuring.continuing` 을 `t` 로 받는다(영어화면 병합 2026-10-07).
const render = (props: {
  initialContinuing?: boolean;
  t?: typeof ko.app.measuring;
}) =>
  renderToStaticMarkup(
    <MeasuringView
      createdAt="2026-10-06T03:00:00.000Z"
      dateLocale="ko-KR"
      domain="example.com"
      initialStatus="queued"
      jobId="job_12345678"
      pollStatus={() => Promise.resolve("queued")}
      sampleUrl="https://www.test/sample"
      t={ko.app.measuring}
      {...props}
    />
  );

describe("measuring screen during a continuation", () => {
  it("ko/en dictionaries both carry the continuation copy", () => {
    expect(ko.app.measuring.continuing).toBe(
      "남은 질문을 이어서 측정하고 있어요"
    );
    expect(en.app.measuring.continuing).toBe(
      "Measuring the remaining questions"
    );
  });

  it("shows the continuation copy when the job is already waiting to continue", () => {
    const html = render({ initialContinuing: true });
    expect(html).toContain("남은 질문을 이어서 측정하고 있어요");
    expect(html).not.toContain("측정 대기 중이에요");
  });

  it("keeps the existing copy for a normal measurement", () => {
    const html = render({});
    expect(html).toContain("측정 대기 중이에요");
    expect(html).not.toContain("남은 질문을 이어서");
  });

  it("uses the English copy on an English screen", () => {
    const html = render({ initialContinuing: true, t: en.app.measuring });
    expect(html).toContain("Measuring the remaining questions");
    expect(html).not.toContain("남은 질문");
  });
});
