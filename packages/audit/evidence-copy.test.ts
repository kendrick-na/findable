import { describe, expect, it } from "vitest";
import { ANSWER_BUCKET_COPY_EN, ANSWER_BUCKET_COPY_KO } from "./answer-buckets";
import {
  allCopyStrings,
  buildEvidenceSheetView,
  buildLimits,
  buildLimitsBlock,
  EVIDENCE_COPY,
  flattenView,
  formatPercent,
  isNegativeAllowedSentence,
  PROOF_ALLOWED_SENTENCES,
  PROOF_BANNED_PHRASES,
  scanBannedPhrases,
  valueStateOf,
} from "./evidence-copy";
import {
  assembleEvidenceSheet,
  type EvidenceSheetParts,
} from "./evidence-sheet";
import {
  type Known,
  NOT_COMPARABLE_REASONS,
  type ObservedValues,
  type ProofLanguage,
} from "./proof-types";

const KO_KEY = { language: "ko", script: "Hang" } as const;

function observed(
  repeat: number,
  over: Partial<ObservedValues> = {}
): ObservedValues {
  return {
    buckets: {
      confirmed: 4,
      different_entity: 1,
      engine_error: 1,
      unknown: 5,
      unverified: 0,
    },
    collection: {
      attempted: 7,
      measured: 6,
      rate: 6 / 7,
      repeat_count: repeat,
      suppressed: false,
      suppression_threshold: null,
      unit: "engine",
    },
    denominator: 10,
    exposure_count: 4,
    exposure_rate: 0.4,
    group: "ai_brand",
    interval: {
      as_of: "2026-10-21",
      status: "known",
      value: { confidence: 0.95, high: 0.7, low: 0.17, method: "wilson" },
    },
    ...over,
  };
}

function parts(
  lang: ProofLanguage,
  repeat: number,
  pilot?: number
): EvidenceSheetParts {
  return {
    as_of: "2026-10-21",
    before_after: null,
    brand_ref: { brand_id: "A-30", display_name: null },
    language: KO_KEY,
    limits: buildLimitsBlock({ pilot_review_count: pilot }),
    min_repeats: 3,
    observed: {
      as_of: "2026-10-21",
      status: "known",
      value: observed(repeat),
    } as Known<ObservedValues>,
    ui_language: lang,
    unmeasured: [
      {
        action_ko: "엔진 키·한도·장애 확인 후 재측정",
        code: "engine_error",
        count: 1,
        denominator: 7,
        label_ko: "엔진 오류",
        rate: 1 / 7,
      },
    ],
  };
}

describe("금칙어 검사", () => {
  it("필수 한계 문장 「독립이 아님」은 통과한다(허용 목록)", () => {
    expect(scanBannedPhrases("반복 답변은 독립이 아님")).toEqual([]);
    expect(scanBannedPhrases("독립 검증셋이 아님")).toEqual([]);
    expect(scanBannedPhrases("독립 표본으로 세지 않음")).toEqual([]);
    expect(scanBannedPhrases("효과 입증 아님")).toEqual([]);
    expect(scanBannedPhrases("최초 측정일은 10월")).toEqual([]);
    expect(scanBannedPhrases("Repeats are not independent")).toEqual([]);
  });

  it("금지 표현은 걸린다", () => {
    for (const bad of [
      "효과 입증 완료",
      "독립 기관 검증",
      "독립 검증된 결과",
      "독립적으로 검증했다",
      "정확도를 보장합니다",
      "한국 최초의 서비스",
      "유일한 도구",
      "노출을 높여드립니다",
      "검증됨",
      "SOC 2 인증",
      "GDPR 준수",
      "글로벌 플랫폼",
      "독립 기관이 아님 그러나 독립 기관 인증", // 허용 문장 뒤의 진짜 금칙어도 잡는다
      "This proves the effect",
      "Verified by an independent audit",
      "world's first",
    ]) {
      expect(scanBannedPhrases(bad).length, bad).toBeGreaterThan(0);
    }
  });

  it("허용 문장은 전부 부정형이다(「최초 측정」 제외)", () => {
    for (const sentence of PROOF_ALLOWED_SENTENCES) {
      expect(isNegativeAllowedSentence(sentence), sentence).toBe(true);
    }
  });

  it("금칙어 목록에 계약 요지의 핵심어가 들어 있다", () => {
    for (const must of [
      "효과 입증",
      "최초",
      "유일",
      "독립 기관",
      "정확도를 보장",
      "한국 전용",
      "글로벌 플랫폼",
      "대표 계정에서만",
      "soc 2",
      "gdpr 준수",
    ]) {
      expect(PROOF_BANNED_PHRASES).toContain(must);
    }
  });

  it("문구 사전(ko·en) 전체에 금칙어가 없다", () => {
    for (const lang of ["ko", "en"] as const) {
      for (const text of allCopyStrings(lang)) {
        expect(scanBannedPhrases(text), `${lang}: ${text}`).toEqual([]);
      }
    }
  });
});

describe("한계 3줄", () => {
  it("항상 3줄, 비어 있지 않다(ko·en, 검수 N 있든 없든)", () => {
    for (const lang of ["ko", "en"] as const) {
      for (const pilot of [undefined, null, 0, 40]) {
        const lines = buildLimits(lang, { pilot_review_count: pilot });
        expect(lines).toHaveLength(3);
        for (const line of lines) {
          expect(line.length).toBeGreaterThan(10);
          expect(scanBannedPhrases(line)).toEqual([]);
        }
      }
    }
    expect(buildLimits("ko")[1]).toContain("독립이 아닙니다");
    expect(buildLimits("en")[1]).toContain("not independent");
  });

  it("검수 건수 문장은 N 이 있을 때만 나온다", () => {
    expect(buildLimits("ko", { pilot_review_count: 40 })[2]).toContain("40건");
    expect(buildLimits("ko")[2]).not.toContain("파일럿");
    expect(buildLimits("en", { pilot_review_count: 40 })[2]).toContain(
      "pilot of 40 cases"
    );
    expect(buildLimits("en")[2]).not.toContain("pilot");
    expect(buildLimits("en")[2]).toContain("No human review result");
  });

  it("봉투용 한계 블록은 각각 3줄", () => {
    const block = buildLimitsBlock({ pilot_review_count: 3 });
    expect(block.limits_ko.split("\n")).toHaveLength(3);
    expect(block.limits_en.split("\n")).toHaveLength(3);
  });
});

describe("값 상태·표시", () => {
  it("값 상태 4종을 구분한다(관측 0 은 쟀더니 0 일 때만)", () => {
    const known0: Known<number> = { as_of: null, status: "known", value: 0 };
    expect(valueStateOf(known0, (v) => v === 0)).toBe("observed_zero");
    expect(
      valueStateOf({ as_of: null, status: "known", value: 2 }, (v) => v === 0)
    ).toBe("observed");
    expect(
      valueStateOf({
        as_of: null,
        detail_ko: "x",
        reason: "not_collected",
        status: "unavailable",
      })
    ).toBe("not_collected");
    expect(
      valueStateOf({
        as_of: null,
        detail_ko: "x",
        reason: "not_configured",
        status: "unavailable",
      })
    ).toBe("not_configured");
    expect(
      valueStateOf({
        as_of: null,
        detail_ko: "x",
        reason: "engine_error",
        status: "unavailable",
      })
    ).toBe("unavailable");
  });

  it("비율은 표시 단계에서만 정수 퍼센트", () => {
    expect(formatPercent(0.4)).toBe("40%");
    expect(formatPercent(6 / 7)).toBe("86%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("5분류 문구는 기존 사전을 그대로 재사용한다", () => {
    const ko = flattenView(
      buildEvidenceSheetView(assembleEvidenceSheet(parts("ko", 3)))
    );
    expect(ko).toContain(ANSWER_BUCKET_COPY_KO.confirmed.label);
    expect(ko).toContain(ANSWER_BUCKET_COPY_KO.different_entity.label);
    const en = flattenView(
      buildEvidenceSheetView(assembleEvidenceSheet(parts("en", 3)))
    );
    expect(en).toContain(ANSWER_BUCKET_COPY_EN.confirmed.label);
  });

  it("비교 불가 사유 12개 모두 ko·en 라벨이 있다", () => {
    for (const reason of NOT_COMPARABLE_REASONS) {
      expect(EVIDENCE_COPY.ko.not_comparable_labels[reason]).toBeTruthy();
      expect(EVIDENCE_COPY.en.not_comparable_labels[reason]).toBeTruthy();
    }
  });
});

describe("증거 한 장 묶음", () => {
  it("정상: 값 줄·한계 3줄·푸터의 「효과 입증 아님」·샘플 표기, 금칙어 없음", () => {
    const view = buildEvidenceSheetView(
      assembleEvidenceSheet(parts("ko", 3, 40)),
      {
        pilot_review_count: 40,
        sample: true,
      }
    );
    const text = flattenView(view);
    expect(view.first_line).toBe(
      "AI가 우리 브랜드를 어떻게 말하고, 무엇을 빠뜨리는지 한 장으로 확인하세요."
    );
    expect(view.draft_label).toContain("시안");
    expect(view.sample_label).toContain("샘플");
    expect(text).toContain("7건 중 6건 수집(86%), 반복 3회");
    expect(text).toContain("제대로 앎 비율: 40% (4/10건)");
    expect(text).toContain("95% 구간 17%~70%");
    expect(text).toContain("효과 입증 아님");
    expect(view.limits).toHaveLength(3);
    expect(scanBannedPhrases(text)).toEqual([]);
  });

  it("반복 부족: 「비교 불가(반복 N회뿐)」, 발견 문장은 없다", () => {
    const view = buildEvidenceSheetView(assembleEvidenceSheet(parts("ko", 2)));
    const finding = view.sections.find((s) => s.id === "finding");
    expect(finding?.lines[0]).toContain("비교 불가(반복 2회뿐)");
    expect(flattenView(view)).not.toContain("이 표본에서 관찰된 값");
    // 한계 3줄은 비교 불가여도 나온다
    expect(view.sections.find((s) => s.id === "limits")?.lines).toHaveLength(3);
  });

  it("영어 틀: 같은 구조, 기준일·비교 불가 문구, 금칙어 없음", () => {
    const view = buildEvidenceSheetView(assembleEvidenceSheet(parts("en", 2)));
    const text = flattenView(view);
    expect(text).toContain("Not comparable (only 2 repeats)");
    expect(text).toContain("Not proof of effect");
    expect(text).toContain("as of 2026-10-21");
    expect(
      scanBannedPhrases(text.replace("엔진 키·한도·장애 확인 후 재측정", ""))
    ).toEqual([]);
  });

  it("못 잰 사유는 0 이 아니라 사유·칸 수·비율·다음 행동과 함께", () => {
    const view = buildEvidenceSheetView(assembleEvidenceSheet(parts("ko", 3)));
    const table = view.sections.find((s) => s.id === "unmeasured")?.table;
    expect(table?.headers).toEqual(["사유", "칸 수", "비율", "다음 행동"]);
    expect(table?.rows[0]).toEqual([
      "엔진 오류",
      "1",
      "14%",
      "엔진 키·한도·장애 확인 후 재측정",
    ]);
  });

  it("미설정·미수집 값은 값 대신 상태 라벨과 기준일 표기를 쓴다", () => {
    const text = flattenView(
      buildEvidenceSheetView(assembleEvidenceSheet(parts("ko", 3)))
    );
    expect(text).toContain("미설정:");
    expect(text).toContain("확인 불가:");
    expect(text).toContain("기준일 불명");
  });
});
