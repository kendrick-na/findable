/**
 * 🔬 헤더를 **실제로 그려서** KO/EN 토글이 안 보이는지 확인한다.
 * 왜 렌더까지: `app-locale-switcher-visibility.test.ts` 는 소스 문자열만 본다.
 *   조건식이 남아 있어도 다른 곳에서 토글을 또 그리면 소스 검사는 통과한다.
 *   (범위 문서 `docs/_적용/영어화면_범위_20261006.md` 5장)
 */
import { SidebarProvider } from "@repo/design-system/components/ui/sidebar";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/scoped", () => ({ scopedHeaderMetric: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// SidebarProvider 의 모바일 판정(useIsMobile)이 matchMedia 를 쓴다 — jsdom 에는 없다.
Object.defineProperty(window, "matchMedia", {
  value: (query: string) => ({
    addEventListener: () => undefined,
    matches: false,
    media: query,
    removeEventListener: () => undefined,
  }),
  writable: true,
});

describe("dashboard header", () => {
  it("does not render the KO/EN switcher while English is closed", async () => {
    const { Header } = await import("@/app/(authenticated)/components/header");
    const { container, queryByRole } = render(
      <SidebarProvider>
        <Header page="개요" pages={[]} />
      </SidebarProvider>
    );

    expect(container.textContent).toContain("개요");
    expect(queryByRole("navigation", { name: "Language" })).toBeNull();
    expect(container.querySelector('a[href^="/locale"]')).toBeNull();
  });
});
