/**
 * 🔬 **실제 렌더해서 확인한다**(N-45) — 「못 잰 것」과 「미노출」이 화면에서 다른 말을 하는지.
 *
 * 왜 렌더까지 하나: 소스 가드(`briefing-firecrawl-failure-classify.test.ts`)는
 * **분기가 있는지**만 본다. 분기가 있어도 **두 갈래가 같은 문구**면 화면에선 똑같다.
 * 📕 이 저장소는 그 실수를 반복했다 — N-45 온보딩 4단계도 「분기는 있는데 설명이 고정」이었다.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BriefingNotSurfaced } from "../../web/app/[locale]/audit/[jobId]/components/audit-result";

const CREDITS = "[크레딧소진] Firecrawl 크레딧이 모두 소진됐습니다";
const AUTH =
  "[인증실패] Firecrawl API 키가 무효하거나 권한이 없습니다(HTTP 401).";
const RATE = "[속도제한] Firecrawl 속도·동시성 제한에 걸렸습니다";

describe("BriefingNotSurfaced — 사유별로 다른 말을 한다", () => {
  // ⚠️ 정리하지 않으면 DOM 이 누적돼 `Found multiple elements` 로 죽는다
  //   (첫 작성에서 실제로 그랬다 — 코드가 아니라 **테스트**의 결함이었다).
  afterEach(cleanup);

  it("🔴 크레딧 소진 = **못 쟀다** (「안 나와요」라고 하지 않는다)", () => {
    render(<BriefingNotSurfaced errorMessage={CREDITS} isKo={true} />);
    expect(screen.getByText(/측정하지 못했어요/)).toBeTruthy();
    // 🔴 핵심: 못 잰 것을 「네이버가 우리를 안 말한다」로 말하면 안 된다.
    expect(screen.queryByText(/안 나와요/)).toBeNull();
    // 오해를 막는 한 줄이 반드시 함께 있어야 한다.
    expect(screen.getByText(/뜻은 아니에요|확인하지 못한/)).toBeTruthy();
  });

  it("🔴 인증 실패도 **못 쟀다** 쪽이다", () => {
    render(<BriefingNotSurfaced errorMessage={AUTH} isKo={true} />);
    expect(screen.getByText(/측정하지 못했어요/)).toBeTruthy();
    expect(screen.queryByText(/안 나와요/)).toBeNull();
  });

  it("⚠️ 속도제한은 **잠시 뒤 된다**고 말한다 (영구 장애처럼 보이면 안 된다)", () => {
    render(<BriefingNotSurfaced errorMessage={RATE} isKo={true} />);
    expect(screen.getByText(/측정하지 못했어요/)).toBeTruthy();
    expect(screen.getByText(/조금 뒤에 다시|잠시/)).toBeTruthy();
  });

  it("✅ 사유 없음 = **쟀고 안 나왔다** (정상 결과 · GEO 기회)", () => {
    render(<BriefingNotSurfaced errorMessage={null} isKo={true} />);
    expect(screen.getByText(/안 나와요/)).toBeTruthy();
    expect(screen.queryByText(/측정하지 못했어요/)).toBeNull();
    // 기회 프레이밍이 유지돼야 한다(이게 이 카드의 원래 목적이다).
    expect(screen.getByText(/선점/)).toBeTruthy();
  });

  it("⛔ 분류 안 되는 오류는 **미노출로 취급**한다 (기존 동작 보존)", () => {
    render(
      <BriefingNotSurfaced errorMessage="timeout after 60s" isKo={true} />
    );
    expect(screen.getByText(/안 나와요/)).toBeTruthy();
  });

  it("🌐 영어도 두 갈래가 **서로 다른 문구**다", () => {
    const { unmount } = render(
      <BriefingNotSurfaced errorMessage={CREDITS} isKo={false} />
    );
    expect(screen.getByText(/couldn't measure/i)).toBeTruthy();
    unmount();

    render(<BriefingNotSurfaced errorMessage={null} isKo={false} />);
    expect(screen.getByText(/Not yet surfaced/i)).toBeTruthy();
  });
});
