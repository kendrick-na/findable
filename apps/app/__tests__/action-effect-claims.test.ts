import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(appRoot, path), "utf8");

describe("unattributed action effects are not presented as results", () => {
  it("does not show a current-minus-completion percentage-point badge", () => {
    const list = read("app/(authenticated)/features/analysis/action-list.tsx");
    expect(list).not.toContain("currentSov - action.completedSov");
    expect(list).not.toContain("완료 후 {delta");
  });

  it("does not promise measured effects in the customer action entry points", () => {
    const copy =
      read("app/(authenticated)/actions/page.tsx") +
      read("app/(authenticated)/components/next-actions-card.tsx");
    expect(copy).not.toContain("효과가 큰 순서");
    expect(copy).not.toContain("다음 측정에서 점수 변화");
  });

  it("does not pair unlinked Tracking rows on the admin evidence screen", () => {
    const page = read("app/(authenticated)/admin/evidence/page.tsx");
    expect(page).not.toContain("database.tracking.findMany");
    expect(page).toContain("buildUnattributedEvidenceRow");
  });
});
