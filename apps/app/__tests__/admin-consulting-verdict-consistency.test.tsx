import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@repo/auth/admin", () => ({
  requireAdmin: vi.fn().mockResolvedValue("admin"),
}));
vi.mock("@repo/database", () => ({
  database: { organization: { findUnique: mocks.findUnique } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_WEB_URL: "https://findable.example" },
}));

import { CustomerDataPanel } from "../app/(authenticated)/admin/orgs/[orgId]/customer-data-panel";
import { getConsultingWorkspace } from "../app/actions/admin/consulting";

it("does not expose pre-verdict stored mention booleans as confirmed customer evidence", async () => {
  mocks.findUnique.mockResolvedValue({
    id: "org-1",
    name: "Customer",
    plan: "Starter",
    consultationNotes: [],
    brands: [
      {
        id: "brand-1",
        name: "Synthetic",
        domain: "example.test",
        _count: { prompts: 10, trackings: 0 },
        siteReadinessRuns: [],
        searchPerformanceConnections: [],
        auditJobs: [
          {
            id: "audit-1",
            status: "completed",
            createdAt: new Date("2026-09-01T00:00:00Z"),
            completedAt: new Date("2026-09-01T00:01:00Z"),
            errorMessage: null,
            result: {
              brandName: "Synthetic",
              domain: "example.test",
              metrics: {
                sov: 100,
                enginesCovered: ["chatgpt"],
                enginesWithMention: ["chatgpt"],
              },
              engineResponses: Array.from({ length: 10 }, () => ({
                engineId: "chatgpt",
                brandMentioned: true,
                mentionQuality: "confirmed",
                errorMessage: null,
              })),
            },
          },
        ],
      },
    ],
  });

  const workspace = await getConsultingWorkspace("org-1");
  const audit = workspace?.brands[0]?.lastAudit;
  expect(audit?.usable).toBe(false);
  expect(audit?.geoScore).toBeNull();
  expect(audit?.sov).toBeNull();
  expect(audit?.mentionedResponses).toBe(0);
  expect(audit?.engineResponses.every((row) => !row.brandMentioned)).toBe(true);
  const html = renderToStaticMarkup(
    <CustomerDataPanel brands={workspace?.brands ?? []} />
  );
  expect(html).toContain("판정보류");
  expect(html).not.toContain("AI 언급률");
  expect(html).not.toContain("브랜드 미확인");
});
