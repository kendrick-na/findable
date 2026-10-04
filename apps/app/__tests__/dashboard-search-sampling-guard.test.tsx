/**
 * W1 policy (2026-10-05): the dashboard's SoV / rank / sentiment mix in Naver
 * search exposure rows, so a run measured with the new Naver search sample
 * (`interleave-v1`) is never compared with a run measured another way.
 *
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DashboardKpis,
  SearchSamplingTrendNote,
} from "../app/(authenticated)/components/dashboard-kpis";
import {
  buildTrackingDashboardData,
  type TrackingRowInput,
  trackingRunSearchSamplingVersions,
} from "../app/(authenticated)/lib/dashboard-data";

const V1 = "interleave-v1";
const RUN_1 = new Date("2026-10-01T00:00:00Z");
const RUN_2 = new Date("2026-10-03T00:00:00Z");
const RUN_3 = new Date("2026-10-05T00:00:00Z");

function rows(trackedAt: Date, mentioned: number, total: number) {
  return Array.from(
    { length: total },
    (_, index): TrackingRowInput => ({
      brand: { domain: "example.com", name: "Example" },
      brandId: "brand-1",
      brandMentioned: index < mentioned,
      engineId: index % 2 === 0 ? "chatgpt" : "naver",
      mentionPosition: index < mentioned ? 2 : null,
      sentiment: index < mentioned ? "positive" : null,
      trackedAt,
    })
  );
}

const trackingRows = [
  ...rows(RUN_1, 2, 4),
  ...rows(RUN_2, 2, 4),
  ...rows(RUN_3, 3, 4),
];

function naverResult(version?: string) {
  return {
    engineResponses: [
      { engineId: "chatgpt" },
      {
        engineId: "naver",
        naverSource: "search_results",
        ...(version ? { naverSamplingVersion: version } : {}),
      },
    ],
  };
}

describe("dashboard search sampling guard", () => {
  afterEach(cleanup);

  it("keeps the delta and full trend when every run used the same sample", () => {
    const versions = trackingRunSearchSamplingVersions([
      { completedAt: RUN_1, result: naverResult(V1) },
      { completedAt: RUN_2, result: naverResult(V1) },
      { completedAt: RUN_3, result: naverResult(V1) },
    ]);
    const data = buildTrackingDashboardData(trackingRows, undefined, versions);
    expect(data?.comparisonBlockedReason).toBeNull();
    expect(data?.sovDeltaPoints).toBe(25);
    expect(data?.previousMentionPosition).toBe(2);
    expect(data?.trend).toHaveLength(3);
    expect(data?.trendExcludedRuns).toBe(0);
    expect(data?.searchSamplingVersion).toBe(V1);
  });

  it("blocks the delta and previous values across legacy → interleave-v1", () => {
    const versions = trackingRunSearchSamplingVersions([
      { completedAt: RUN_1, result: naverResult() },
      { completedAt: RUN_2, result: naverResult() },
      { completedAt: RUN_3, result: naverResult(V1) },
    ]);
    const data = buildTrackingDashboardData(trackingRows, undefined, versions);
    expect(data?.comparisonBlockedReason).toBe("search_sampling_changed");
    expect(data?.sovDeltaPoints).toBeNull();
    expect(data?.previousMentionPosition).toBeNull();
    expect(data?.previousSentiment).toBeNull();
    // The trend line never connects two sampling methods.
    expect(data?.trend.map((point) => point.timestamp)).toEqual([
      RUN_3.getTime(),
    ]);
    expect(data?.trendExcludedRuns).toBe(2);
  });

  it("treats a run with no AuditJob version as legacy (fail closed)", () => {
    const versions = trackingRunSearchSamplingVersions([
      { completedAt: RUN_3, result: naverResult(V1) },
    ]);
    const data = buildTrackingDashboardData(trackingRows, undefined, versions);
    expect(data?.sovDeltaPoints).toBeNull();
    expect(data?.comparisonBlockedReason).toBe("search_sampling_changed");
  });

  it("renders 비교 불가 instead of a number on the KPI cards and trend note", () => {
    const versions = trackingRunSearchSamplingVersions([
      { completedAt: RUN_1, result: naverResult() },
      { completedAt: RUN_2, result: naverResult() },
      { completedAt: RUN_3, result: naverResult(V1) },
    ]);
    const data = buildTrackingDashboardData(trackingRows, undefined, versions);
    if (!data) {
      throw new Error("expected dashboard data");
    }
    render(
      <>
        <DashboardKpis data={data} paid={true} />
        <SearchSamplingTrendNote data={data} />
      </>
    );
    expect(screen.getByTestId("sov-comparison-blocked").textContent).toBe(
      "비교 불가(측정 방식 변경)"
    );
    expect(document.body.textContent).not.toMatch(/[+−-]\d+%p/);
    expect(document.body.textContent).not.toContain("지난 측정");
    expect(document.body.textContent).not.toContain("2회차 측정부터");
    expect(document.body.textContent).toContain("검색 표본 v2");
    expect(
      screen.getByTestId("search-sampling-trend-note").textContent
    ).toContain("이전 2회는 추세에서 뺐어요");
  });

  it("still renders the delta badge for comparable runs", () => {
    const versions = trackingRunSearchSamplingVersions([
      { completedAt: RUN_1, result: naverResult(V1) },
      { completedAt: RUN_2, result: naverResult(V1) },
      { completedAt: RUN_3, result: naverResult(V1) },
    ]);
    const data = buildTrackingDashboardData(trackingRows, undefined, versions);
    if (!data) {
      throw new Error("expected dashboard data");
    }
    render(<DashboardKpis data={data} paid={true} />);
    expect(screen.queryByTestId("sov-comparison-blocked")).toBeNull();
    expect(document.body.textContent).toContain("+25%p");
  });
});
