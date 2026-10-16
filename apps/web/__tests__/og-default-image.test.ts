import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path));

/** PNG 헤더에서 가로·세로를 읽는다(IHDR: 바이트 16~23). */
const pngSize = (buf: Buffer) => ({
  height: buf.readUInt32BE(20),
  width: buf.readUInt32BE(16),
});

describe("기본 공유 이미지(og)", () => {
  test("메타 기본값이 새 파일명을 가리키고 옛 템플릿 파일명은 기본값이 아니다", () => {
    const metadata = read("packages/seo/metadata.ts").toString("utf8");
    expect(metadata).toContain("/og-default-v2.png`");
    expect(metadata).not.toMatch(/image \?\? `[^`]*\/opengraph-image\.png`/);
  });

  test("새 파일은 1200×630 PNG 이고 옛 파일명도 같은 그림이다(템플릿 재발 방지)", () => {
    const next = read("apps/web/public/og-default-v2.png");
    const legacy = read("apps/web/public/opengraph-image.png");
    expect(existsSync(join(root, "apps/web/public/og-default-v2.png"))).toBe(
      true
    );
    expect(pngSize(next)).toEqual({ height: 630, width: 1200 });
    expect(legacy.equals(next)).toBe(true);
  });
});
