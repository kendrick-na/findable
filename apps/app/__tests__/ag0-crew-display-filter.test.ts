/**
 * AG-0 후속 — 저장된 crewResult 의 허위 수치 문장 표시 차단 (2026-10-03).
 *
 * 75550e0 이전 crew 프롬프트는 수진에게 *"Reddit이 모든 LLM 인용의 약 40%를 차지한다는
 * 점을 명시적으로 언급"* 을 **강제**했고, 준호에게 세 기법을 *"visibility +40%"* 로 알려줬다.
 * 저장된 crewResult 는 그 출력 그대로라 화면이 다시 그린다. DB 는 고치지 않고
 * 그 **문장만** 표시 직전에 뺀다 — 구조(항목 수·필드)는 그대로 둔다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeStoredCrewResult } from "@repo/audit/crew-display-filter";
import { describe, expect, it } from "vitest";

const REPO = join(process.cwd(), "../..");
const read = (path: string) => readFileSync(join(REPO, path), "utf8");

const stored = {
  isStub: false,
  totalDurationMs: 1200,
  analysts: [
    {
      agentId: "sujin",
      rawText: null,
      output: {
        executiveSummary:
          "Reddit이 모든 LLM 인용의 약 40%를 차지하지만 이 브랜드는 0건입니다.",
        findings: [
          {
            title: "커뮤니티 출처 부재",
            whyItMatters: "제3자 근거가 약합니다.",
            detail:
              "관측된 인용 12건 중 자사 도메인이 5건입니다. 업계 전체로는 Reddit이 LLM 인용의 40%를 차지합니다. blog.naver.com 은 3건입니다.",
            severity: "amber",
          },
          {
            title: "자사 인용 비중",
            whyItMatters: "측정값입니다.",
            detail: "이번 측정에서 자사 도메인 인용은 40%였습니다.",
            severity: "green",
          },
        ],
        observation: "Reddit 인용 비중이 높은 업종입니다.",
        dataGaps: [],
      },
    },
  ],
  strategist: {
    agentId: "junho",
    rawText: null,
    output: {
      executiveSummary: "인용문·통계 추가가 우선입니다.",
      mondayActionOne: {
        title: "제품 페이지에 통계 추가",
        whyThisOne: "Princeton 연구에서 통계 추가는 가시성을 +40% 높였습니다.",
        expectedOutcome: "다음 측정에서 인용 변화를 확인합니다.",
      },
      topActions: [
        {
          rank: 1,
          title: "FAQ 섹션 보강",
          princetonStrategy: "statistics_addition",
          rationale:
            "질문 3개에서 미등장했습니다. 이 3가지 기법이 visibility +40%를 냅니다.",
          steps: ["FAQ 5개 작성"],
          impact: 4,
          effort: 2,
          expectedTimeframe: "4주 내 확인",
          channel: "owned_site",
        },
      ],
    },
  },
};

describe("저장된 crewResult — 허위 수치 문장만 뺀다", () => {
  const clean = sanitizeStoredCrewResult(stored);
  const sujin = clean?.analysts?.[0]?.output;
  const junho = clean?.strategist?.output;

  it("Reddit 이 모든 LLM 인용의 40% 라는 업계 일반 주장 문장을 뺀다", () => {
    const all = JSON.stringify(clean);
    expect(all).not.toMatch(/Reddit이 모든 LLM 인용/);
    expect(all).not.toMatch(/Reddit이 LLM 인용의 40%/);
    expect(sujin?.executiveSummary).toBe("");
  });

  it("논문 기법의 +40% 가시성 효과 문장을 뺀다", () => {
    expect(junho?.mondayActionOne?.whyThisOne).toBe("");
    expect(junho?.topActions?.[0]?.rationale).toBe(
      "질문 3개에서 미등장했습니다."
    );
  });

  it("같은 필드의 측정 사실 문장은 남긴다", () => {
    expect(sujin?.findings?.[0]?.detail).toBe(
      "관측된 인용 12건 중 자사 도메인이 5건입니다. blog.naver.com 은 3건입니다."
    );
  });

  it("측정값 40% 와 수치 없는 Reddit 언급은 건드리지 않는다", () => {
    expect(sujin?.findings?.[1]?.detail).toBe(
      "이번 측정에서 자사 도메인 인용은 40%였습니다."
    );
    expect(sujin?.observation).toBe("Reddit 인용 비중이 높은 업종입니다.");
  });

  it("구조는 그대로다 — 항목 수·숫자·enum 필드 유지", () => {
    expect(sujin?.findings).toHaveLength(2);
    expect(junho?.topActions).toHaveLength(1);
    expect(junho?.topActions?.[0]?.impact).toBe(4);
    expect(junho?.topActions?.[0]?.princetonStrategy).toBe(
      "statistics_addition"
    );
    expect(clean?.totalDurationMs).toBe(1200);
  });

  it("문제 문장이 없으면 같은 객체를 그대로 돌려준다", () => {
    const ok = { isStub: false, note: "자사 인용 40%" };
    expect(sanitizeStoredCrewResult(ok)).toBe(ok);
    expect(sanitizeStoredCrewResult(null)).toBeNull();
  });

  it("원본(저장 데이터)을 바꾸지 않는다", () => {
    expect(stored.analysts[0]?.output.executiveSummary).toMatch(/Reddit/);
  });

  it("웹 진단 결과·앱 대시보드가 crewResult 를 그리기 전에 이 필터를 쓴다", () => {
    const web = read(
      "apps/web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
    );
    expect(web).toMatch(/sanitizeStoredCrewResult\(data\.crewResult\)/);
    const app = read("apps/app/app/(authenticated)/page.tsx");
    expect(app).toMatch(
      /sanitizeStoredCrewResult\(\s*currentRunAnalysis\?\.crewResult/
    );
  });
});
