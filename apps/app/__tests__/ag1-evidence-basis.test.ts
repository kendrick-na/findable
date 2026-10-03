/**
 * AG-1/AG-3 — 액션 카드가 공식 요건·관찰 상관·내부 가설을 섞지 않는다 (2026-10-03).
 *
 * 근거: GEO_Findable_Research_20261003 Finding 7 + 원문 재확인(2026-10-03):
 *   - SEO뉴스 네이버 AI 브리핑: 인용 272건, 49.3% 가 검색 10위 밖. 질의 유형 혼합.
 *     주 1회 기업 블로그 게시 효과는 다루지 않는다.
 *   - Ahrefs best-list: 750개 프롬프트·인용 URL 26,283개 관찰 연구(개입 실험 아님).
 *   - Seer: SearchGPT 인용 약 500건·질문 약 100개(2025-02). Bing 밖 출처도 인용됨.
 *   - Bing AI Performance: Copilot·Bing AI 답변 인용 보고(ChatGPT 언급 없음).
 *   - Google title link: title 길이 제한 없음. web.dev TTFB 0.8초 = "rough guide".
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterStoredGeoActions } from "@repo/audit/action-display-filter";
import {
  DONT_LIST,
  EVIDENCE_BASIS_LABEL,
  RULE_SOURCES,
} from "@repo/audit/action-rules";
import { buildGeoActions, type GeoAction } from "@repo/audit/actions";
import { describe, expect, it } from "vitest";

type Input = Parameters<typeof buildGeoActions>[0];

const REPO = join(process.cwd(), "../..");
const read = (path: string) => readFileSync(join(REPO, path), "utf8");

const counts = (o: Partial<Record<string, number>>) => ({
  absent: 0,
  answered: 10,
  confirmed: 1,
  differentEntity: 0,
  engineError: 0,
  total: 10,
  unclassified: 0,
  unknownBrand: 0,
  unverified: 0,
  ...o,
});

/** 인지 낮음 + 동명 오인 + 공식 인용 0 + 질문 갭 — 거의 모든 카드 종류를 켠다. */
const everything: Input = {
  brandName: "설화수",
  brandDomain: "sulwhasoo.com",
  averageMentionPosition: null,
  enginesMeasured: 4,
  enginesMentioned: 1,
  marketScope: "both",
  prompts: [{ hit: 0, text: "설화수 추천해줘", total: 4 }],
  verdicts: {
    confusedQuotes: [],
    counts: counts({ confirmed: 1, differentEntity: 3, unknownBrand: 6 }),
    differentEntityEngines: ["chatgpt"],
    ownedCitationCount: 0,
  },
};

const cards = () =>
  buildGeoActions({ ...everything, prompts: everything.prompts })
    // MAX_ACTIONS 상한에 걸리지 않게 두 번 나눠 본다(인지 카드 / 나머지).
    .concat(
      buildGeoActions({
        ...everything,
        verdicts: {
          ...(everything.verdicts as NonNullable<Input["verdicts"]>),
          counts: counts({ confirmed: 8, unknownBrand: 1 }),
        },
      }),
      // 해외 시장 + 오인 없음 + 공식 인용 있음 → 추천 목록·Bing·외부 언급 카드가 상한 안에 든다.
      buildGeoActions({
        ...everything,
        marketScope: "global",
        verdicts: {
          confusedQuotes: [],
          counts: counts({ confirmed: 1, unknownBrand: 9 }),
          differentEntityEngines: [],
          ownedCitationCount: 2,
        },
      })
    );

const todo = () => cards().filter((a) => a.kind !== "avoid");
const byKind = (kind: GeoAction["kind"]) =>
  cards().find((a) => a.kind === kind) as GeoAction;
const allText = (a: GeoAction) =>
  `${a.title}\n${a.evidence}\n${a.how}\n${a.verification ?? ""}\n${JSON.stringify(a.guide ?? {})}`;

describe("AG-3 카드 템플릿 — 관측→실행→근거 종류→비보장→게시·색인 확인→재측정", () => {
  it("모든 실행 카드가 근거 종류·보장하지 않는 것·게시 확인 메타데이터를 갖는다", () => {
    const kinds = new Set(todo().map((a) => a.kind));
    for (const k of [
      "entity_clarity",
      "naver_blog",
      "best_lists",
      "bing_webmaster",
      "crawl_access",
      "prompt_gap",
    ]) {
      expect(kinds.has(k as GeoAction["kind"]), `${k} 카드가 안 켜졌다`).toBe(
        true
      );
    }
    for (const a of todo()) {
      const g = a.guide;
      expect(g?.evidenceBasis, `${a.kind} 근거 종류 없음`).toBeTruthy();
      expect(
        Object.keys(EVIDENCE_BASIS_LABEL),
        `${a.kind} 근거 종류 값`
      ).toContain(g?.evidenceBasis);
      expect(g?.notGuaranteed, `${a.kind} 비보장 범위 없음`).toBeTruthy();
      expect(g?.publishCheck, `${a.kind} 게시·색인 확인 없음`).toBeTruthy();
    }
  });

  it("기존 화면 칸에서도 보인다 — 실행 방법 끝에 비보장, 확인 방법 앞에 게시·색인 확인", () => {
    for (const a of todo()) {
      expect(a.how, a.kind).toContain("보장하지 않는 것:");
      expect(a.verification ?? "", a.kind).toMatch(/^게시·색인 확인:/);
    }
  });

  it("출처 이름에 근거 종류 태그가 붙는다(링크 칸에서 바로 읽힌다)", () => {
    for (const [key, source] of Object.entries(RULE_SOURCES)) {
      expect(source.label, key).toMatch(
        /^\[(공식 문서|관찰 연구|사례 분석|법령)\] /
      );
    }
  });
});

describe("AG-1 과장·혼동 문구 정정", () => {
  it("FAQ·질문형 제목이 인용 확률을 올린다는 인과 문구가 없다", () => {
    for (const a of cards()) {
      expect(allText(a), a.kind).not.toMatch(
        /확률이 올라|인용하기 좋습니다|그대로 쓰는 것이 핵심/
      );
    }
    const portfolio = read("packages/audit/actions.ts");
    expect(portfolio).not.toMatch(/채택할 확률이 올라갑니다/);
  });

  it("질문 갭은 같은 문구 페이지 대량 생성이 아니라 기존 페이지 보강부터", () => {
    const gap = byKind("prompt_gap");
    expect(gap.how).toMatch(/기존/);
    expect(gap.how).toMatch(/관찰/);
  });

  it("공식 페이지 액션은 기존 보강을 우선하고 질문별 복제를 명령하지 않는다", () => {
    const content = byKind("content_fix");
    expect(content.how).toMatch(/기존 페이지.*보강/);
    expect(content.how).toMatch(/내용이 충분히 다를 때만.*별도 페이지/);
    expect(content.how).toMatch(/복제하지 마세요/);
    expect(content.how).not.toMatch(/질문.*마다 답하는 페이지를 하나씩/);
  });

  it("근거 등급이 있는 신규 카드는 JSON 왕복 뒤에도 모두 보존한다", () => {
    const generated = cards().filter((action) => action.guide?.evidenceBasis);
    const restored = filterStoredGeoActions(
      JSON.parse(JSON.stringify(generated))
    );

    expect(restored.map((action) => action.title)).toEqual(
      generated.map((action) => action.title)
    );
  });

  it("네이버 블로그: 272건 사례 분석을 주간 블로그 효과로 외삽하지 않는다", () => {
    const naver = byKind("naver_blog");
    expect(naver.guide?.evidenceGrade).toBe("weak");
    expect(naver.guide?.evidenceBasis).toBe("internal_hypothesis");
    expect(naver.how).toMatch(/272건/);
    expect(naver.how).not.toMatch(/절반 가까이 인용합니다 —/);
    expect(naver.guide?.notGuaranteed).toMatch(/주 1회|매주/);
    expect(naver.guide?.effectLag).toMatch(/재측정 권장 시점/);
    expect(naver.guide?.effectLag).not.toMatch(/글이 쌓여야 보입니다/);
  });

  it("외부 언급의 반영 시점은 단정하지 않고 재측정으로 확인한다", () => {
    const mentions = byKind("web_mentions");
    expect(mentions.guide?.effectLag).toMatch(/재측정 권장 시점/);
    expect(mentions.guide?.effectLag).not.toMatch(/가장 느리지만 오래 갑니다/);
  });

  it("Bing: 등록을 ChatGPT 노출의 필요조건처럼 말하지 않고, 공식 Bing 보고서를 관측 수단으로 안내한다", () => {
    const bing = byKind("bing_webmaster");
    expect(allText(bing)).not.toMatch(/나오기 어렵습니다|반드시|필수/);
    expect(bing.guide?.evidenceGrade).toBe("weak");
    expect(bing.guide?.sources.map((s) => s.url)).toContain(
      RULE_SOURCES.bingAiPerformance.url
    );
    expect(bing.how).toMatch(/AI Performance/);
    expect(bing.guide?.notGuaranteed).toMatch(/ChatGPT/);
  });

  it("llms.txt: 「만들지 마라」가 아니라 「그것만으로 노출을 기대하지 마라」 — 사이트 점검의 '선택·참고'와 같은 말", () => {
    const llms = DONT_LIST.find((d) => d.title.includes("llms.txt"));
    expect(llms?.title).not.toBe("llms.txt 파일 만들기");
    expect(llms?.title).toMatch(/만으로|기대/);
    expect(llms?.reason).toMatch(/선택/);
    expect(llms?.reason).not.toMatch(/밝힌 적이 없고/);
    const ko = read("packages/internationalization/dictionaries/ko.json");
    expect(ko).toMatch(/llms\.txt도 아직 보편적인 표준이 아니어서/);
  });
});

describe("AG-3 SiteReadiness — 내부 점검 기준을 공식 요건과 분리", () => {
  const playbook = read("apps/app/lib/site-readiness/execution-playbook.ts");

  it("제목 70자: Google 공식 길이 제한이 없음을 밝힌다", () => {
    expect(playbook).toMatch(
      /70자는 Findable 점검 기준이며 Google 공식 길이 제한은 없습니다/
    );
  });

  it("메타 설명 50~180자: 공식 고정 길이가 아님을 밝힌다", () => {
    expect(playbook).toMatch(
      /50~180자는 Findable 점검 기준이며 공식 고정 길이가 아닙니다/
    );
  });

  it("H1 1개: 필수 요건이 아님을 밝힌다", () => {
    expect(playbook).toMatch(
      /H1 1개는 Findable 점검 기준이며 검색엔진의 필수 요건은 아닙니다/
    );
  });

  it("TTFB 0.8초: web.dev 의 대략적 기준이라고 밝힌다", () => {
    expect(playbook).toMatch(/web\.dev가 제시하는 대략적 기준/);
  });

  it("전체 응답 2.5초·아티클 500단어·서버 본문 300자: 내부 기준이라고 밝힌다", () => {
    expect(playbook).toMatch(/2\.5초는 Findable 내부 점검 기준/);
    expect(playbook).toMatch(/500단어는 Findable 내부 점검 기준/);
    expect(playbook).toMatch(
      /300자 미만을 주의로 표시하는 것은 Findable 내부 점검 기준/
    );
  });
});
