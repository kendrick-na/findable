/**
 * @vitest-environment jsdom
 *
 * 🔴 이 한 줄이 없으면 **Vercel 빌드가 깨진다**(실제로 깨뜨렸다 — `dpl_7iejFziJ…`).
 *   이 저장소는 vitest 설정 파일이 없어 환경 기본값이 `node` 다 → `window is not defined`.
 *   ⚠️ **로컬에서는 통과했다**: 다른 테스트 파일이 먼저 DOM 을 만들어 놓으면
 *   같은 워커에서 우연히 붙어 돌기 때문이다(파일 단독 실행 시엔 실패).
 *   → 렌더링 테스트를 새로 만들면 **이 지시문을 반드시 붙일 것.**
 *   (`sign-in.test.tsx` 가 지금까지 무사한 건 window 를 안 건드려서다.)
 */
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

// `audit-history-list` → `@/env` 는 **import 시점에** 실 환경변수를 검증한다(t3-env).
// 테스트에 진짜 배포 URL이 필요한 게 아니므로 스텁으로 끊는다
// (다른 테스트 12개가 통과하는 이유는 `@/env` 를 안 타기 때문 — 이 파일이 첫 사례다).
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_WEB_URL: "https://example.test" },
}));

// 🔴 렌더한 것을 매 테스트 후 치운다 — 없으면 **Vercel 빌드가 깨진다**(`dpl_3X2APo4wc`·`dpl_Hw9MH4yJ`).
//   증상: 테스트는 326/326 **통과**하는데 그 뒤 `Uncaught Exception` 3건으로 빌드 실패.
//   기제: 이 파일은 render 를 7번 하고 한 번도 정리하지 않았다 → 컴포넌트가 DOM 에 살아남고
//     React 가 예약한 타이머가 **vitest 가 jsdom 을 철거한 뒤에** 깨어나 `window` 를 찾는다
//     (스택: react-dom → scheduler → `processImmediate node:internal/timers`).
//   ⚠️ **로컬에서는 재현되지 않는다** — 로컬 2.1초 / CI 18.3초로, 느린 환경에서만 타이머가
//     깨어날 시간이 생긴다. 즉 `326/326` 은 경쟁 조건 위에 서 있었다(통과 신호를 믿지 말 것).
//   선례: `history-auto-refresh.test.tsx` 는 `afterEach` 로 정리해서 이 사고를 겪지 않았다.
afterEach(cleanup);

const { AuditHistoryList } = await import(
  "../app/(authenticated)/components/audit-history-list"
);
const { EmptyState } = await import(
  "../app/(authenticated)/components/empty-state"
);

/**
 * S2' 회귀 테스트 (2026-08-11 세션N-19).
 *
 * 🔴 **이 테스트가 막는 실제 사고**: `AuditHistoryList` 에 `jobs.length === 0` 가드가
 *   없어서 `/history` 가 **완전 공백**이었다(제목 아래 아무것도 없음). `jobs.map()` 은
 *   빈 배열에서 조용히 빈 `<ul>` 을 렌더하기 때문에 **tsc·lint·빌드가 전부 통과**했다.
 *   가입자 6명 중 5명이 지나가는 경로였는데 3개월간 아무 신호가 없었다.
 *   → "빈 배열이면 안내가 보인다"를 **테스트로 고정**한다.
 *
 * ⚠️ 스냅샷을 쓰지 않는다 — 문구는 계속 다듬을 것이고, 지켜야 하는 계약은
 *   "문구가 이것이다"가 아니라 **"빈 화면이 아니다 + 다음 행동이 있다"** 다.
 */
describe("EmptyState (공용)", () => {
  test("4요소 중 ①제목 ②설명 ③다음 행동을 렌더한다", () => {
    const { container } = render(
      <EmptyState
        ctaHref="/brand"
        ctaLabel="측정 시작하기"
        description="여기에 무엇이 보일지 설명."
        title="아직 측정한 적이 없어요"
      />
    );
    const scoped = within(container);

    expect(scoped.getByText("아직 측정한 적이 없어요")).toBeDefined();
    expect(scoped.getByText("여기에 무엇이 보일지 설명.")).toBeDefined();
    const cta = scoped.getByRole("link", { name: "측정 시작하기" });
    expect(cta.getAttribute("href")).toBe("/brand");
  });

  test("샘플 링크는 넘겼을 때만 나온다 (지어낸 예시 대신 실제 회차)", () => {
    const { container, rerender } = render(
      <EmptyState description="설명" title="제목" />
    );
    // sampleHref 없으면 외부 링크가 아예 없어야 한다.
    expect(container.querySelectorAll('a[target="_blank"]').length).toBe(0);

    rerender(
      <EmptyState
        description="설명"
        sampleHref="https://example.com/audit/x?shared=1"
        title="제목"
      />
    );
    const sample = container.querySelector('a[target="_blank"]');
    expect(sample?.getAttribute("rel")).toContain("noopener");
  });
});

/**
 * S6-c#4 회귀 테스트 (2026-08-11).
 *
 * 🔴 **막는 사고**: `/history` 가 **상태와 무관하게** 행 전체를 결과 링크로 걸고
 *   "결과 보기 →" 를 항상 띄웠다. 실패·대기 중인 측정에는 **볼 결과가 없다**
 *   → 없는 것을 약속하는 표시 정직성 결함(설계 v3 원인②).
 *   같은 저장소의 `brand/page.tsx` 는 `completed` 일 때만 링크를 걸고 있어 **자기모순**이었다.
 *
 * ⚠️ 상태별 목적지는 다르다: 대기·측정 중은 실시간 상태, 실패·완료는 내부 상세.
 * 무료진단 공개 페이지로 조직 이력을 내보내지 않는다.
 */
const jobFixture = (status: string, id: string) =>
  ({
    createdAt: new Date("2026-08-01T00:00:00Z"),
    domain: "example.com",
    id,
    result: null,
    status,
  }) as never;

describe("AuditHistoryList 상태별 결과 링크", () => {
  test("대기·측정중 행은 실제 상태 화면으로 연결한다", () => {
    for (const status of ["queued", "processing"]) {
      const { container } = render(
        <AuditHistoryList jobs={[jobFixture(status, `job-${status}`)]} />
      );
      const link = container.querySelector("a");
      expect(link?.getAttribute("href")).toContain(
        `/brand/measuring?job=job-${status}`
      );
      expect(container.textContent).toContain("실시간 상태 보기");
    }
  });

  test("실패 행은 내부 상세의 실패 사유로 연결한다", () => {
    const { container } = render(
      <AuditHistoryList jobs={[jobFixture("failed", "job-failed")]} />
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/history/job-failed"
    );
    expect(container.textContent).toContain("실패 사유 보기");
  });

  test("완료 행은 정식 공개 리포트로 연결한다", () => {
    const { container } = render(
      <AuditHistoryList jobs={[jobFixture("completed", "job-done")]} />
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toContain("/ko/audit/job-done");
    expect(container.textContent).toContain("측정 상세");
  });
});

describe("AuditHistoryList 빈 상태 가드", () => {
  test("🔴 측정 0건이면 빈 화면이 아니라 안내를 보여준다", () => {
    // ⚠️ `screen` 은 document 전체를 본다 — 이 저장소는 자동 cleanup 이 없어
    //   앞 테스트의 DOM 이 남아 "여러 개 찾음"으로 실패한다(실제로 겪음).
    //   → 이 블록은 **렌더한 container 안에서만** 조회한다.
    const { container } = render(<AuditHistoryList jobs={[]} />);
    const scoped = within(container);

    // 예전 회귀: 빈 <ul> 만 남아 본문이 사실상 비었다.
    expect(container.querySelectorAll("li").length).toBe(0);
    expect(scoped.getByText("아직 측정한 적이 없어요")).toBeDefined();

    // 🔴 2026-08-14 — **문구가 아니라 계약을 검사한다.**
    //   예전엔 `name: "측정 시작하기"` 로 라벨을 하드코딩했다. 그러면 등록·측정 흐름이
    //   바뀔 때 **문구가 거짓이 돼도 테스트는 통과**하고(가드가 거짓말을 지킨다),
    //   반대로 문구만 다듬어도 멀쩡한 화면이 실패한다(양방향으로 터진다).
    //   지켜야 하는 계약은 **"막다른 화면이 아니다 = 측정으로 가는 길이 있다"** 뿐이다.
    const links = Array.from(container.querySelectorAll("a"));
    const cta = links.find((a) => a.getAttribute("href") === "/brand");
    expect(cta).toBeDefined();
    // 링크에 읽을 수 있는 이름이 있어야 한다(빈 링크 = 스크린리더에 막다른 길).
    expect((cta?.textContent ?? "").trim().length).toBeGreaterThan(0);

    // "공백"의 정의를 텍스트 길이로도 고정한다.
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(30);
  });
});
