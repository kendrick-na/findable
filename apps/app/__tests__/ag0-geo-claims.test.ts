/**
 * AG-0 — 고객에게 보이는 근거 없는 GEO 처방 차단 (2026-10-03).
 *
 * 근거: GEO_Findable_Research_20261003 Finding 7.
 *   ① `rank_strategy` 는 논문 Table 2 의 **출처 웹사이트 SERP 순위**별 효과를
 *     AI 답변 속 **브랜드 언급 순위**에 옮겨 썼다(변수가 다르다).
 *   ② 러너는 오귀속을 막으려고 외부 인용을 제외한다. 그래서 출처 구성이 늘
 *     「자사 100%」로만 남아 *"AI가 우리 사이트만 본다"* 단정 카드가 나왔다.
 *   ③ 홈·PDF·crew 프롬프트에 Princeton·+40%·Reddit 40% 과장 문구.
 *   ④ 이미 저장된 geoActions 는 코드를 고쳐도 그대로 다시 그려진다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterStoredGeoActions } from "@repo/audit/action-display-filter";
import { buildGeoActions, type GeoAction } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

type Input = Parameters<typeof buildGeoActions>[0];

const REPO = join(process.cwd(), "../..");
const read = (path: string) => readFileSync(join(REPO, path), "utf8");
/** 주석을 걷고 실제로 나가는 코드만 남긴다(금지어를 설명하는 주석이 걸리지 않게). */
const code = (path: string) =>
  read(path)
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const text = (a: GeoAction) =>
  `${a.title}\n${a.evidence}\n${a.how}\n${a.source ?? ""}\n${JSON.stringify(a.guide ?? {})}`;

const base: Input = {
  brandName: "설화수",
  brandDomain: "sulwhasoo.com",
  averageMentionPosition: 3,
  averageMentionListSize: 5,
  enginesMeasured: 4,
  enginesMentioned: 3,
  prompts: [{ hit: 1, text: "설화수 추천해줘", total: 4 }],
};

describe("① rank_strategy — SERP 순위 효과를 브랜드 언급 순위에 쓰지 않는다", () => {
  for (const pos of [1, 1.4, 2, 3, 4.6, 8, 20]) {
    it(`평균 언급 위치 ${pos} 에서 순위별 효과 카드·수치가 없다`, () => {
      const actions = buildGeoActions({
        ...base,
        averageMentionPosition: pos,
      });
      expect(actions.some((a) => a.kind === "rank_strategy")).toBe(false);
      for (const a of actions) {
        expect(text(a)).not.toMatch(/Table 2|−30|-30%|\+2\.5|115|Rank\d/);
      }
    });
  }

  it("1순위권이라는 이유로 공식 페이지 보강 카드를 숨기지 않는다(근거가 같은 오용이었다)", () => {
    const top = buildGeoActions({ ...base, averageMentionPosition: 1 });
    const low = buildGeoActions({ ...base, averageMentionPosition: 8 });
    expect(top.map((a) => a.kind).sort()).toEqual(
      low.map((a) => a.kind).sort()
    );
  });
});

describe("② source_portfolio — 외부 인용을 제외한 집계로 자사 100% 를 단정하지 않는다", () => {
  it("러너 경로(외부 인용 0, 자사만 남음)에서는 출처 편중 카드를 만들지 않는다", () => {
    const actions = buildGeoActions({
      ...base,
      sourceMix: { community: 0, media: 0, other: 0, owned: 3, reference: 0 },
      topDomains: [{ count: 3, domain: "sulwhasoo.com", owned: true }],
      ownedCitationUrls: ["https://sulwhasoo.com/about"],
    });
    expect(actions.some((a) => a.kind === "source_portfolio")).toBe(false);
    for (const a of actions) {
      expect(text(a)).not.toMatch(/우리 사이트만|100%가 자사|외부 0%/);
    }
  });

  it("외부 인용이 실제로 집계된 경우에도 「우리 사이트만 본다」고 단정하지 않는다", () => {
    const portfolio = buildGeoActions({
      ...base,
      sourceMix: { community: 10, media: 5, other: 0, owned: 80, reference: 5 },
      topDomains: [
        { count: 20, domain: "sulwhasoo.com", owned: true },
        { count: 5, domain: "news.example.com", owned: false },
      ],
    }).find((a) => a.kind === "source_portfolio");
    expect(portfolio, "자사 편중 카드는 유지된다").toBeTruthy();
    expect(text(portfolio as GeoAction)).not.toMatch(
      /우리 사이트만|우리 주장만/
    );
  });

  it("외부 URL 귀속 안전 필터는 그대로다 — 확인된 언급 답변의 외부 인용은 브랜드에 귀속하지 않는다", () => {
    const runner = read("packages/audit/runner.ts");
    expect(runner).toMatch(
      /sourceAdviceIsSupported\s*=\s*\n?\s*citationEvidence\.unattributedCitationCount === 0/
    );
    const aggregate = read("packages/ai/lib/engines/aggregate.ts");
    expect(aggregate).toMatch(
      /if \(!isOwned\) \{\s*unattributedCitationCount \+= 1;\s*return \[\];/
    );
  });
});

describe("③ 신규 생성 템플릿·프롬프트의 과장 문구", () => {
  it("홈: 점유율을 Princeton GEO-Bench 산식으로 잰다고 말하지 않는다", () => {
    const home = code(
      "apps/web/app/[locale]/(home)/components/step-sections.tsx"
    );
    expect(home).not.toMatch(/Princeton GEO-Bench/);
  });

  it("문의 페이지 사전: 액션 플랜이 Princeton 알고리즘 기반이라고 말하지 않는다", () => {
    for (const locale of ["ko", "en"]) {
      const dict = read(
        `packages/internationalization/dictionaries/${locale}.json`
      );
      expect(dict).not.toMatch(/Princeton/);
    }
  });

  it("PDF: 추천 전체를 Princeton 알고리즘 기반으로 표기하지 않는다", () => {
    const pdf = code("packages/audit/pdf-template.ts");
    expect(pdf).not.toMatch(/Princeton GEO 알고리즘 기반/);
    expect(pdf).not.toMatch(/알고리즘 한국어 적용/);
  });

  it("PDF: 한국 엔진 추적을 「독점」이라 하지 않는다 — 경쟁 제품도 네이버 AI 브리핑을 추적한다", () => {
    const pdf = code("packages/audit/pdf-template.ts");
    expect(pdf).not.toMatch(/독점|유일|exclusive/i);
    // 네이버·다음은 AI 답변이 아니라 검색 노출로 집계한다 — AI 엔진으로 묶지 않는다.
    expect(pdf).not.toMatch(/한국 AI 엔진[^<]*Naver/);
  });

  it("PDF: 검증되지 않은 시장·투자·팀 성과 주장을 싣지 않는다", () => {
    const pdf = code("packages/audit/pdf-template.ts");
    expect(pdf).not.toMatch(
      /Profound|\$96M|\$1B|CAGR|1\.48B|17\.02B|Ahrefs 75K|6년 K-콘텐츠|노동부|동국대|무료 진단 무제한/
    );
  });

  it("PDF: 현재 기본 측정에서 제외된 HyperCLOVA를 지원 엔진으로 약속하지 않는다", () => {
    const pdf = code("packages/audit/pdf-template.ts");
    expect(pdf).not.toMatch(/HyperCLOVA|하이퍼클로바/);
    expect(pdf).toMatch(/AI 답변과 검색 노출은 서로 다른 채널/);
    expect(pdf).toMatch(/측정 언어는 이 리포트 하단에 표시/);
  });

  it("runner: 결과 교체 시 이전 PDF 링크를 먼저 지운다", () => {
    const runner = code("packages/audit/runner.ts");
    const commit = code("packages/audit/commit-audit-result.ts");
    expect(runner).toContain("commitAuditResult(");
    expect(commit).toMatch(
      /status:\s*"completed"[\s\S]*result,[\s\S]*pdfUrl:\s*null/
    );
  });

  it("crew: +40%·Reddit 40% 를 LLM 에 필수 사실로 지시하지 않는다", () => {
    const prompts =
      code("packages/ai/lib/crew/agents.ts") +
      code("packages/ai/lib/crew/orchestrator.ts");
    expect(prompts).not.toMatch(/visibility \+40%/);
    expect(prompts).not.toMatch(/Reddit이 모든 LLM 인용의 약 40%/);
  });
});

describe("④ 저장된 과거 geoActions — 렌더 시점 보수적 필터", () => {
  const stored: GeoAction[] = [
    {
      kind: "rank_strategy",
      priority: 2,
      title: "이미 1순위 — 지금은 '더 밀어붙이기'보다 방어가 낫습니다",
      evidence: "AI 답변에서 평균 1번째로 언급됩니다(사실상 1순위).",
      how: "1위 사이트 −30%",
      source: "Princeton GEO 논문(KDD 2024) Table 2 — Rank1 −30.3%",
    },
    {
      kind: "source_portfolio",
      priority: 3,
      title: "AI가 우리 사이트만 보고 있습니다 — 제3자 언급이 필요합니다",
      evidence: "인용 출처의 100%가 자사 도메인입니다(외부 0%).",
      how: "업계 매체 기고",
      source: "Ahrefs 75K 브랜드 분석",
    },
    {
      kind: "content_fix",
      priority: 3,
      title: "인용되는 페이지에 '근거 문장'을 추가하세요 (실험 평균 +41%)",
      evidence: "측정한 AI 7곳 중 3곳이 인지했습니다.",
      how: "①인용문 추가(+41%)",
      source: "Princeton GEO 논문(KDD 2024) Table 1 — 인용문 추가 시 평균 +41%",
    },
    {
      kind: "prompt_gap",
      priority: 3,
      title: '"설화수 추천해줘" — 등록 브랜드로 확인된 답변이 없습니다',
      evidence: "AI 4곳에 물었지만 0개였습니다.",
      how: "이 질문에 답하는 페이지를 만드세요.",
      source: "우리 측정 데이터 — 프롬프트별 언급 여부",
    },
    {
      kind: "avoid",
      priority: 1,
      title: "이건 하지 마세요 — 효과가 없거나 역효과입니다",
      evidence: "효과가 확인되지 않은 방법들입니다.",
      how: "①키워드 반복 삽입",
      source: "Princeton GEO 논문 Table 1 · SE Ranking 30만 도메인",
    },
  ];

  it("순위 효과·자사 100% 단정·Princeton 효과 수치 카드를 걸러낸다", () => {
    const kept = filterStoredGeoActions(stored);
    expect(kept.map((a) => a.kind)).toEqual(["prompt_gap", "avoid"]);
    for (const a of kept.filter((item) => item.kind !== "avoid")) {
      expect(text(a)).not.toMatch(/Princeton|우리 사이트만|Table 2/);
    }
  });

  it("정상 카드는 손대지 않는다(같은 객체·같은 순서)", () => {
    const kept = filterStoredGeoActions(stored);
    expect(kept[0]).toBe(stored[3]);
    expect(kept[1]).toBe(stored[4]);
  });

  it("배열이 아니면 빈 배열", () => {
    expect(filterStoredGeoActions(undefined)).toEqual([]);
  });

  it("웹 무료 진단·앱 「지금 할 일」 화면이 저장 결과에 이 필터를 쓴다", () => {
    const web = read(
      "apps/web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
    );
    expect(web).toMatch(/filterStoredGeoActions\(result\.geoActions\)/);
    const app = read("apps/app/app/(authenticated)/actions/page.tsx");
    expect(
      app.match(/filterStoredGeoActions\(/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(2);
    const ssr = read("packages/audit/ssr-summary.ts");
    expect(ssr).toMatch(/filterStoredGeoActions\(/);
  });
});
