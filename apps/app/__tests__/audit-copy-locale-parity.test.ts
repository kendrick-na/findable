import { EVIDENCE_GRADE_LABEL } from "@repo/audit/action-rules";
import { inferMarketScope, REGION_LABEL } from "@repo/audit/market-scope";
import {
  directionHint,
  METRICS,
  type MetricKey,
  metricCopy,
} from "@repo/audit/metric-dictionary";
import en from "@repo/internationalization/dictionaries/en.json";
import ko from "@repo/internationalization/dictionaries/ko.json";
import { describe, expect, it } from "vitest";
import { marketScopeReason } from "@/lib/market-scope-reason";

const HANGUL = /[가-힣]/;

/**
 * 측정 엔진(`@repo/audit`) 문구를 앱 사전으로 옮긴 자리(2026-10-06)가
 *   ① 한국어는 패키지 원문과 **글자 그대로** 같고 ② 영어엔 한글이 없는지 묶는다.
 * 패키지 문구가 바뀌면 사전도 같이 바꾸라는 경보다.
 */
describe("측정 엔진 문구의 한·영 대응", () => {
  it("근거 등급 한국어 = 패키지 원문", () => {
    const t = ko.app.actionEvidence;
    expect(t.gradeStrong).toBe(EVIDENCE_GRADE_LABEL.strong.label);
    expect(t.gradeStrongMeaning).toBe(EVIDENCE_GRADE_LABEL.strong.meaning);
    expect(t.gradeMedium).toBe(EVIDENCE_GRADE_LABEL.medium.label);
    expect(t.gradeMediumMeaning).toBe(EVIDENCE_GRADE_LABEL.medium.meaning);
    expect(t.gradeWeak).toBe(EVIDENCE_GRADE_LABEL.weak.label);
    expect(t.gradeWeakMeaning).toBe(EVIDENCE_GRADE_LABEL.weak.meaning);
    expect(t.gradeNone).toBe(EVIDENCE_GRADE_LABEL.none.label);
    expect(t.gradeNoneMeaning).toBe(EVIDENCE_GRADE_LABEL.none.meaning);
  });

  it("시장 라벨 한국어 = 패키지 원문", () => {
    expect(ko.app.sourcesBoard.regionKorea).toBe(REGION_LABEL.korea);
    expect(ko.app.sourcesBoard.regionGlobal).toBe(REGION_LABEL.global);
  });

  it("시장 추정 근거: 한국어 사전 문장 = 패키지 reason, 영어엔 한글 없음", () => {
    const cases = [
      { domain: "brand.co.kr" },
      { domain: "brand.com", industry: "local_service" },
      { domain: "brand.com", language: "ko" as const },
      { domain: "brand.com", language: "en" as const },
      { domain: "brand.com" },
    ];
    for (const input of cases) {
      const detected = inferMarketScope(input);
      expect(marketScopeReason(detected.reasonCode, ko.app.brandForm)).toBe(
        detected.reason
      );
      expect(
        HANGUL.test(marketScopeReason(detected.reasonCode, en.app.brandForm))
      ).toBe(false);
    }
  });

  it("지표 사전: 한국어 기본값 유지 + 영어엔 한글 없음", () => {
    for (const key of Object.keys(METRICS) as MetricKey[]) {
      expect(metricCopy(key).label).toBe(METRICS[key].label);
      const copy = metricCopy(key, false);
      for (const text of [copy.label, copy.question, copy.description]) {
        expect(HANGUL.test(text)).toBe(false);
      }
    }
    expect(directionHint("rank")).toBe("낮을수록 좋음");
    expect(directionHint("rank", false)).toBe("lower is better");
    expect(directionHint("sov", false)).toBeNull();
  });
});
