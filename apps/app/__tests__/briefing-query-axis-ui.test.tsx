/**
 * 🔴 **브리핑은 질의 축이 다르다는 걸 화면이 말하는가**(N-45 · #4-b B-5).
 * 📕 설계 = `docs/_적용/브리핑_본류편입_기획_2026-08-17.md` §2·§5-c
 *
 * 7엔진은 *추천형*("{브랜드} 추천")을 묻고 브리핑은 *정보형*(효과·후기·장단점)을 묻는다.
 * 화면이 이 사실을 말하지 않으면 브리핑의 「안 뜸」이 7엔진의 「안 말함」과
 * **같은 뜻으로 읽힌다** — 실제로는 *"다른 질문에서 안 떴다"* 인데
 * *"네이버가 우리를 모른다"* 로 오독된다.
 * 📕 이 저장소 최다 사고 유형(「못 잰 것·다르게 잰 것을 0 이라 부르기」).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "../..");

const stripComments = (src: string) =>
  src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

const APP_MIRROR = stripComments(
  readFileSync(
    join(
      ROOT,
      "apps/app/app/(authenticated)/features/analysis/truth-mirror-section.tsx"
    ),
    "utf8"
  )
);
const WEB_MIRROR = stripComments(
  readFileSync(
    join(
      ROOT,
      "apps/web/app/[locale]/audit/[jobId]/components/truth-mirror.tsx"
    ),
    "utf8"
  )
);
const PDF = stripComments(
  readFileSync(join(ROOT, "packages/audit/pdf-template.ts"), "utf8")
);

describe("B-5 질의 축 표기 — 브리핑이 다른 질문임을 화면이 말한다", () => {
  it("🔴 앱·웹 **둘 다** 브리핑에 라벨이 있다 (없으면 raw ID 가 노출된다)", () => {
    // `naver-briefing` 이라는 내부 ID 가 고객 화면에 그대로 찍히면 안 된다.
    for (const [name, src] of [
      ["app", APP_MIRROR],
      ["web", WEB_MIRROR],
      ["pdf", PDF],
    ] as const) {
      expect(src, `${name} 에 브리핑 라벨이 없다`).toMatch(
        /"naver-briefing":\s*"/
      );
    }
  });

  it("🔴 미노출 문구가 **7엔진과 다르다** (같으면 오독된다)", () => {
    // app: 「우리를 안 말함」 대신 브리핑 전용 문구가 있어야 한다.
    //   ⚠️ 파일 전체에서 `engineId === BRIEFING_ENGINE_ID` 를 찾으면 **질의축 안내**가
    //     통과시킨다(첫 작성에서 실제로 새어나갔다) → **배지 함수 본문**만 본다.
    expect(APP_MIRROR).toContain("BRIEFING_ENGINE_ID");
    const appBadgeAt = APP_MIRROR.indexOf("const renderMentionBadge");
    expect(appBadgeAt, "app 배지 헬퍼가 없다").toBeGreaterThan(-1);
    const appBadge = APP_MIRROR.slice(
      appBadgeAt,
      APP_MIRROR.indexOf("\n};", appBadgeAt)
    );
    expect(
      appBadge,
      "app 이 브리핑에도 7엔진과 같은 미노출 문구를 쓴다"
    ).toContain("BRIEFING_ENGINE_ID");
    // web: 「당신을 모름」 **배지**가 브리핑에도 붙으면 안 된다.
    //   ⚠️ `indexOf` 로 찾으면 **섹션 설명문**의 같은 단어를 먼저 잡는다
    //     (첫 작성에서 실제로 그랬다) → 배지를 그리는 `!brandMentioned` 분기만 본다.
    expect(WEB_MIRROR).toContain("BRIEFING_ENGINE_ID");
    const webBadgeAt = WEB_MIRROR.indexOf("if (!engine.brandMentioned) {");
    expect(webBadgeAt, "web 미노출 배지 분기가 없다").toBeGreaterThan(-1);
    const badge = WEB_MIRROR.slice(
      webBadgeAt,
      WEB_MIRROR.indexOf("\n  }", webBadgeAt)
    );
    expect(badge, "web 이 브리핑에도 「당신을 모름」을 쓴다").toContain(
      "BRIEFING_ENGINE_ID"
    );
  });

  it("🔴 **질의 축이 다르다는 안내**가 카드 안에 있다", () => {
    // 「효과·후기·장단점」으로 물었다는 사실을 그 자리에서 밝혀야 한다.
    for (const [name, src] of [
      ["app", APP_MIRROR],
      ["web", WEB_MIRROR],
    ] as const) {
      expect(src, `${name} 에 질의 축 안내가 없다`).toMatch(
        /효과·후기·장단점|효과.{0,3}후기.{0,3}장단점/
      );
    }
  });

  it("⛔ 브리핑 판정이 **엔진 ID 로** 이뤄진다 (라벨 문구로 분기하지 않는다)", () => {
    // 라벨은 계속 다듬는다 — 문구로 분기하면 라벨을 바꿀 때마다 조용히 깨진다.
    for (const [name, src] of [
      ["app", APP_MIRROR],
      ["web", WEB_MIRROR],
    ] as const) {
      expect(src, `${name} 상수가 없다`).toMatch(
        /BRIEFING_ENGINE_ID\s*=\s*"naver-briefing"/
      );
    }
  });
});

/**
 * 🔴 **「같은 질문」을 전제로 하는 계산에서 브리핑을 뺀다**(N-45 · #4-b B-5).
 *
 * B-2 가 브리핑을 `Tracking` 에 적재하면서, 브리핑 행이 **다른 집계에도 흘러든다**.
 * 그런데 경쟁사 순위는 *"같은 질문에 AI 가 어떤 브랜드를 먼저 말하나"* 를 세는 것이고
 * (`/compare` 화면이 그렇게 약속한다), 브리핑의 「{브랜드} 효과·후기」는
 * **경쟁 브랜드를 나열하는 질의가 아니다**.
 *
 * 섞이면 ① 분모가 달라져 점유율이 왜곡되고 ② 후기 글에 우연히 나온 이름이
 * 「경쟁사」로 승격된다. 📕 N-30 *"축이 다른 두 숫자를 나란히 두면 검산하려 든다"*.
 */
describe("B-5 축 분리 — 브리핑이 다른 집계를 오염시키지 않는다", () => {
  const ANALYSIS = stripComments(
    readFileSync(
      join(ROOT, "apps/app/app/(authenticated)/lib/analysis-data.ts"),
      "utf8"
    )
  );
  const RUNNER = stripComments(
    readFileSync(join(ROOT, "packages/audit/runner.ts"), "utf8")
  );

  it("🔴 경쟁사 집계가 브리핑 행을 **거른다**", () => {
    const at = ANALYSIS.indexOf("export function buildCompetitorAnalysis");
    expect(at, "경쟁사 집계 함수가 없다").toBeGreaterThan(-1);
    const body = ANALYSIS.slice(at, ANALYSIS.indexOf("\nexport ", at + 10));
    expect(body, "브리핑 답변(효과·후기)이 경쟁사 순위에 섞인다").toMatch(
      /engineId !== BRIEFING_ENGINE_ID/
    );
  });

  it("🔴 진실의 거울 **숫자 문장의 분모**에서 브리핑을 뺀다", () => {
    // 「측정한 AI 8곳 중 N곳」처럼 같은 분모에 세우면
    //   *"AI 8곳에 같은 걸 물었다"* 로 읽힌다 — 사실이 아니다.
    // ⚠️ 카드는 그대로 남는다. 빠지는 건 **분모**뿐이다.
    const MIRROR_DATA = stripComments(
      readFileSync(
        join(ROOT, "apps/app/app/(authenticated)/lib/truth-mirror-data.ts"),
        "utf8"
      )
    );
    expect(MIRROR_DATA).toMatch(
      /mainAxis\s*=\s*engines\.filter\(\(e\) => e\.engineId !== BRIEFING_ENGINE_ID\)/
    );
    // 분모·분자 **둘 다** mainAxis 를 써야 한다(하나만 쓰면 비율이 틀어진다).
    expect(MIRROR_DATA).toMatch(/measuredCount:\s*mainAxis\.length/);
    expect(MIRROR_DATA).toMatch(/knownCount:\s*mainAxis\.filter/);
    // ⛔ 그래도 카드 목록에는 브리핑이 남아야 한다(빼면 측정 사실이 사라진다).
    expect(MIRROR_DATA).toMatch(/\n\s*engines,/);
  });

  it("🔴 등장률 분모(`metrics`)가 **브리핑 앞에서** 확정된다", () => {
    // 뒤에 있으면 브리핑이 「측정한 AI N곳」에 들어가 분모가 8이 된다.
    //   그러면 7엔진 등장률이 조용히 희석된다(축이 다른데 같은 분모).
    const metrics = RUNNER.indexOf("const metrics = aggregateAudit");
    const call = RUNNER.indexOf("runBriefingForAuditJob({");
    expect(metrics).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(metrics, "점수 확정이 브리핑 뒤에 있다").toBeLessThan(call);
  });
});
