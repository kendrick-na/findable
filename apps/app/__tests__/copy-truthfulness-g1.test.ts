/**
 * 안내 문구가 **지금 동작과 맞는지** 지키는 가드 (2026-10-14 · G1 문구 정정).
 *
 * 🔴 사고 유형: 동작을 바꾸고 문구를 안 바꿔 화면이 사실과 다른 말을 했다
 *   (등록 즉시 측정을 끈 뒤에도 "바로 측정을 시작해요", 시장이 질문 언어를 정하는데 "측정하는 AI는 같다").
 *   문구 전체를 박제하지 않고(기대값에 문구를 박으면 틀린 문구도 통과시킨다) **거짓이 되는 핵심 주장**만 막는다.
 *
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../packages/internationalization/dictionaries/en.json";
import ko from "../../../packages/internationalization/dictionaries/ko.json";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("등록 흐름 문구 — 등록 즉시 측정하지 않는다", () => {
  it("등록 안내(ko·en)가 '바로/첫 측정을 시작'이라고 말하지 않는다", () => {
    for (const dict of [ko.app, en.app]) {
      expect(dict.brandPage.addFirst).not.toMatch(
        /바로 측정을 시작|start measuring right away|1~3분|1–3 minutes/i
      );
      expect(dict.brandForm.confirm).not.toMatch(
        /첫 측정을 시작합니다|Start the first measurement/i
      );
    }
  });

  it("기본 질문 안내가 '브랜드 이름으로 묻는 기본 질문'이라고 하지 않는다(기본 질문은 이름 없는 질문 포함)", () => {
    for (const text of [
      ko.app.brandPage.setupMissing,
      ko.app.onboarding.setupMissingBody,
      en.app.brandPage.setupMissing,
      en.app.onboarding.setupMissingBody,
    ]) {
      expect(text).not.toMatch(/브랜드 이름으로 묻는|use your brand name/i);
    }
  });
});

describe("시장 안내 — 시장은 질문 언어를 정한다", () => {
  it("'측정하는 AI는 같다'는 거짓 주장이 없다", () => {
    expect(ko.app.onboarding.scopeEnginesNote).not.toContain(
      "측정하는 AI는 같습니다"
    );
    expect(en.app.onboarding.scopeEnginesNote).not.toMatch(
      /AI engines stay the same/i
    );
    expect(ko.app.onboarding.scopeEnginesNote).toContain("질문 언어");
    expect(en.app.onboarding.scopeEnginesNote).toMatch(/question language/i);
  });

  it("두 안내가 서로 모순되지 않는다 — 시장 영향 범위를 같은 말로 한다", () => {
    expect(ko.app.onboarding.scopeLede).toContain("질문 제안");
    expect(en.app.onboarding.scopeLede).toMatch(/question suggestions/i);
  });
});

describe("경쟁사 안내 · 죽은 문구 · 업종 기타", () => {
  it("경쟁사 설명이 사용처(표기 합치기 + 대안 질문 제안)를 둘 다 말한다", () => {
    for (const text of [
      ko.app.onboarding.competitorWhyBody,
      ko.app.onboarding.editorCompetitorHint,
    ]) {
      expect(text).toContain("대안");
    }
    for (const text of [
      en.app.onboarding.competitorWhyBody,
      en.app.onboarding.editorCompetitorHint,
    ]) {
      expect(text).toMatch(/alternative/i);
    }
  });

  it("화면에 안 나오는 promptWizard.competitorsNote 를 지웠고 렌더도 없다", () => {
    expect("competitorsNote" in ko.app.promptWizard).toBe(false);
    expect("competitorsNote" in en.app.promptWizard).toBe(false);
    expect(
      read("app/(authenticated)/features/brand/prompt-wizard.tsx")
    ).not.toContain("competitorsNote");
  });

  it("업종 '기타' 안내가 ko·en 모두 있고 마법사·5단계가 보여 준다", () => {
    for (const dict of [ko.app, en.app]) {
      expect(dict.onboarding.industryOtherNote.length).toBeGreaterThan(5);
      expect(dict.promptWizard.industryOtherNote.length).toBeGreaterThan(5);
    }
    expect(
      read("app/(authenticated)/features/brand/prompt-wizard.tsx")
    ).toContain('industry === "other"');
    expect(
      read("app/(authenticated)/welcome/welcome-question-step.tsx")
    ).toContain("industryOtherNote");
  });
});

describe("진행 표시 — 단계 수가 한 값이다", () => {
  it("1단계 껍데기가 5로 굳어 있지 않고 공유 상수를 쓴다", () => {
    const intro = read("app/(authenticated)/welcome/welcome-intro.tsx");
    expect(intro).toContain("ONBOARDING_TOTAL_STEPS");
    expect(intro).not.toContain('"5"');
    expect(intro).not.toContain("w-1/5");
    expect(read("app/(authenticated)/welcome/welcome-flow.tsx")).toContain(
      "ONBOARDING_TOTAL_STEPS"
    );
  });
});
