/**
 * 🔬 **실제 렌더해서 확인한다** — N-48 파싱 수정이 **화면에 보이는지**.
 *
 * ## 왜 이 테스트가 필요한가 (이번 세션이 실제로 당한 것)
 *
 * `extractPerplexitySources()` 로 출처를 되살렸는데, `market-scope.ts` 의
 * `NO_WEB_SEARCH_ENGINES` 에 **perplexity 가 박혀 있었다**. 그 상태면
 * `sources-board` 는 인용 수를 **아예 렌더하지 않고** 「출처 미수집」만 찍는다.
 *
 * → **출처를 고쳐놓고 화면은 계속 «못 받아왔다»고 말한다.**
 *   📕 *"가드가 버그의 호위병이 된다"* 의 전형. 파서만 고치고 끝냈으면
 *   👤 가 라이브에서 «안 고쳐졌네» 를 보게 됐을 것이다.
 *
 * ## 왜 소스 가드로는 부족한가
 * `engine-source-state.test.ts` 는 **판정 함수의 반환값**만 본다. 판정이 맞아도
 * 화면이 그 값을 **안 쓰거나 다른 문구로** 찍으면 고객은 여전히 틀린 말을 본다.
 * 📕 N-45: *"소스 가드는 통과하고 렌더 테스트가 4건 잡았다"*.
 *
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourcesBoard } from "../app/(authenticated)/features/analysis/sources-board";
import type { SourcesAnalysis } from "../app/(authenticated)/lib/analysis-data";

function makeData(engines: SourcesAnalysis["engines"]): SourcesAnalysis {
  return {
    brandDomain: "sulwhasoo.com",
    brandName: "설화수",
    domains: [],
    engines,
    filteredCitations: 0,
    kinds: [],
    measuredAt: new Date("2026-08-20T00:00:00Z"),
    mentionRate: { mentioned: 3, total: 4 },
    ownedCitations: { owned: 1, total: 6 },
  };
}

describe("SourcesBoard — perplexity 인용이 화면에 보인다(N-48)", () => {
  afterEach(cleanup);

  it("🔴🔴 perplexity 인용 수가 **렌더된다**(「출처 미수집」이 아니다)", () => {
    render(
      <SourcesBoard
        data={makeData([
          { engineId: "perplexity", citations: 7, mentioned: 3, total: 3 },
        ])}
      />
    );
    // ⭐ 핵심: 인용 수가 실제로 화면에 있어야 한다.
    expect(screen.getByText(/인용 7/)).toBeTruthy();
    // 🔴 그리고 「출처 미수집」이 **사라져야** 한다 — 이게 원래 버그의 얼굴이다.
    expect(screen.queryByText(/출처 미수집/)).toBeNull();
  });

  it("⚠️ perplexity 인용 0 은 **정직한 0** 이라 「인용 0」으로 찍힌다", () => {
    render(
      <SourcesBoard
        data={makeData([
          { engineId: "perplexity", citations: 0, mentioned: 2, total: 3 },
        ])}
      />
    );
    // 이제 수집 경로가 정상이므로 0 은 "진짜로 인용이 없었다"는 뜻이다.
    expect(screen.getByText(/인용 0/)).toBeTruthy();
    expect(screen.queryByText(/출처 미수집/)).toBeNull();
  });

  it("🔴 claude 는 **플래그로 갈린다** — OFF 면 「출처 미수집」", () => {
    render(
      <SourcesBoard
        data={makeData([
          { citations: 0, engineId: "claude", mentioned: 4, total: 4 },
        ])}
      />
    );
    // 🔴 perplexity 를 빼면서 claude 까지 같이 빼버리면 **반대 방향 거짓말**이 된다
    //   (웹을 안 읽는 엔진에 「인용 0」= "이 AI 가 우리를 안 읽었다"로 읽힌다).
    //
    // ⚠️⚠️ **환경값을 단정하지 않는다**(N-48 · 이 테스트가 실제로 배포를 막았다).
    //   웹검색 플래그가 켜지면 claude 는 `collected` 라 「인용 0」이 정직해진다.
    //   📕 N-47: *"가드가 개선을 막는 것도 사고다."*
    const on = process.env.FINDABLE_CLAUDE_WEB_SEARCH === "1";
    if (on) {
      expect(screen.getByText(/인용 0/)).toBeTruthy();
      expect(screen.queryByText(/출처 미수집/)).toBeNull();
    } else {
      expect(screen.getByText(/출처 미수집/)).toBeTruthy();
      expect(screen.queryByText(/인용 0/)).toBeNull();
    }
  });

  it("🔴🔴 chatgpt 는 「출처 미수집」 — 「인용 0」이라 하면 거짓말이다(N-48)", () => {
    render(
      <SourcesBoard
        data={makeData([
          // 등장은 4/4 인데 인용이 0 인 상황 = 폴백을 끊은 뒤의 실제 모습.
          { engineId: "chatgpt", citations: 0, mentioned: 4, total: 4 },
        ])}
      />
    );
    // ⭐ 등장 4/4 인 엔진에 「인용 0」을 찍으면 고객은
    //   *"ChatGPT 가 우리를 안 읽었다"* 로 읽는다 — 사실은 **출처를 안 밝히는 것**이다.
    expect(screen.getByText(/출처 미수집/)).toBeTruthy();
    expect(screen.queryByText(/인용 0/)).toBeNull();
    // 등장 수는 그대로 보여야 한다(측정 자체는 성공했다).
    expect(screen.getByText(/등장 4\/4/)).toBeTruthy();
  });

  it("✅ hyperclova 는 「출처 안 밝힘」 — 구조적으로 API 가 안 준다(회귀 방지)", () => {
    render(
      <SourcesBoard
        data={makeData([
          { engineId: "hyperclova", citations: 0, mentioned: 2, total: 2 },
        ])}
      />
    );
    expect(screen.getByText(/출처 안 밝힘/)).toBeTruthy();
  });
});
