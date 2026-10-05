import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("existing brand measurement identity guard", () => {
  it("does not create an audit with an unconfirmed industry or market", () => {
    const action = read("app/actions/brand/start-tracking.ts");

    expect(action).toContain('code: "identity_incomplete"');
    expect(action).toMatch(
      /brandRecord\?\.industry && brandRecord\.marketScope/
    );
  });

  it("explains the block beside the disabled measurement CTA", () => {
    const page = read("app/(authenticated)/brand/page.tsx");
    const button = read(
      "app/(authenticated)/features/brand/start-tracking-button.tsx"
    );

    // 🔴 2026-10-06 — 문구는 사전(`app.brandPage`·`app.trackButton`)으로 옮겨졌다.
    expect(page).toMatch(
      /!identityReady[\s\S]{0,200}dict\.brandPage\.identityMissing/
    );
    expect(button).toContain("t.identityNeeded");
    expect(button).toContain("!identityReady");
    const ko = JSON.parse(
      read("../../packages/internationalization/dictionaries/ko.json")
    ).app;
    expect(ko.brandPage.identityMissing).toContain(
      "정확한 측정을 위해 아래에서 브랜드명·업종·타깃 시장을"
    );
    expect(ko.trackButton.identityNeeded).toBe("측정 기준 확인 필요");
  });
});
