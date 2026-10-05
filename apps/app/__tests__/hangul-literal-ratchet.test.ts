import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 **새 한국어 하드코딩을 막는 래칫**(2026-10-06 · `docs/_적용/영어화면_범위_20261006.md` 4장).
 *
 * 왜: `apps/app` 화면 문자열은 `@repo/internationalization` 사전을 거쳐야 영어가 된다(CLAUDE.md §2).
 *   [실측] 2026-10-06 기준 `.tsx` 65개 파일·1,019줄(admin·stories 제외)에 한글 하드코딩이 남아 있다. 한 번에 다 옮기면
 *   그 자체가 회귀 위험이라 **"지금보다 늘지 않게"만** 막는다(줄면 통과).
 *
 * 세는 법: 주석(`/* *\/`·`{/* *\/}`·`//`)을 지운 뒤 한글이 들어간 **줄 수**. 문장 수의 근사치다.
 * 제외: `*.stories.tsx`(개발용 미리보기) · `admin/`(운영자 전용, 영어화 범위 밖 — 👤 D6 미정).
 *
 * ⚠️ 이 테스트가 실패하면:
 *   - 새 문구는 `packages/internationalization/dictionaries/{ko,en}.json` 의 `app` 아래에 넣고
 *     `getAppDictionary()` 로 읽는다.
 *   - 문구를 사전으로 **옮겨서 줄었다면** 기준표를 낮춘다:
 *     `UPDATE_HANGUL_BASELINE=1 pnpm --filter app exec vitest run __tests__/hangul-literal-ratchet.test.ts`
 *   - 기준표를 **올리는** 건 사전 이관이 불가능한 이유가 있을 때만(리뷰에서 근거 확인).
 */

const APP_ROOT = join(import.meta.dirname, "..");
const SCAN_ROOT = join(APP_ROOT, "app");
const BASELINE_PATH = join(import.meta.dirname, "hangul-literal-baseline.json");

const HANGUL_RE = /[\uac00-\ud7a3]/;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /^\s*\/\//;
const TRAILING_COMMENT_RE = /(?<![:"'`])\/\/.*$/;

const isExcluded = (rel: string) =>
  rel.endsWith(".stories.tsx") || rel.includes("/admin/");

const listTsx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsx(full);
    }
    return entry.name.endsWith(".tsx") ? [full] : [];
  });

const countHangulLines = (source: string): number =>
  source
    .replace(BLOCK_COMMENT_RE, "")
    .split("\n")
    .filter((line) => !LINE_COMMENT_RE.test(line))
    .map((line) => line.replace(TRAILING_COMMENT_RE, ""))
    .filter((line) => HANGUL_RE.test(line)).length;

const measure = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const file of listTsx(SCAN_ROOT).sort()) {
    const rel = relative(APP_ROOT, file).split("\\").join("/");
    if (isExcluded(rel)) {
      continue;
    }
    const n = countHangulLines(readFileSync(file, "utf8"));
    if (n > 0) {
      counts[rel] = n;
    }
  }
  return counts;
};

describe("hangul literal ratchet (apps/app TSX)", () => {
  it("counts only non-comment Hangul lines", () => {
    const src = [
      "/** 주석 */",
      "// 주석",
      "{/* JSX 주석 */}",
      'const a = "본문"; // 끝 주석',
      'const url = "https://x.kr"; // 끝 주석',
      "<p>안내</p>",
    ].join("\n");
    expect(countHangulLines(src)).toBe(2);
  });

  it("no TSX file gains hardcoded Hangul beyond the baseline", () => {
    const current = measure();

    if (process.env.UPDATE_HANGUL_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<
      string,
      number
    >;

    const grew = Object.entries(current)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(
        ([file, n]) =>
          `${file}: ${baseline[file] ?? 0} → ${n} (사전으로 옮기세요)`
      );

    expect(grew).toEqual([]);
  });
});
