import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("legacy research pages remain accurate and discoverable", () => {
  it("uses the measured seven-engine scope without unsupported claims", () => {
    const benchmark = read(
      "apps/web/app/[locale]/research/k-geo-bench-v0_1/page.tsx"
    );
    const report = read(
      "apps/web/app/[locale]/report/k-beauty-geo-2026q2/page.tsx"
    );
    const combined = `${benchmark}\n${report}`;
    expect(combined).not.toContain("engines: 8");
    expect(combined).not.toContain("5사 모두 다음에서 인용률 50% 이하");
    expect(combined).not.toContain("6주 후 재측정 시 인용률 +30%p");
    expect(combined).not.toContain("학습 풀이 영문 대비 50배");
    expect(combined).not.toContain("가시성 갭이 곧 매출 갭");
  });

  it("gives the open dataset canonical metadata and Dataset JSON-LD", () => {
    const benchmark = read(
      "apps/web/app/[locale]/research/k-geo-bench-v0_1/page.tsx"
    );
    expect(benchmark).toContain("createMetadata");
    expect(benchmark).toContain("<JsonLd");
    expect(benchmark).toContain('"@type": "Dataset"');
  });
});
