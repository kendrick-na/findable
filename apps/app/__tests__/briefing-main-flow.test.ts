/**
 * 🔴 **네이버 AI 브리핑 본류 편입**(N-45 · 남은일 #4-b B-4).
 * 📕 설계 = `docs/_적용/브리핑_본류편입_기획_2026-08-17.md`
 *
 * ⭐ 이 가드가 지키는 판정은 **"어떻게 붙였나"** 다:
 *   ① 본류를 **막지 않는다**(이미 completed 저장 뒤 · 실패를 삼킨다)
 *   ② **로그인 측정에만** 돈다(무료 진단까지 켜면 크레딧 예측이 무너진다)
 *   ③ **플래그로 끌 수 있다**(크레딧은 되돌릴 수 없다 — 코드 롤백보다 env 가 빠르다)
 *   ④ 호출부에 **복제하지 않는다**(runAuditJob 호출부가 4곳이다)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "../..");

/** 주석을 걷고 실행 코드만 남긴다(📕 가드가 자기 주석을 세는 사고 5회). */
const stripComments = (src: string) =>
  src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

const RUNNER = stripComments(
  readFileSync(join(ROOT, "packages/audit/runner.ts"), "utf8")
);
const KEYS = stripComments(
  readFileSync(join(ROOT, "packages/audit/keys.ts"), "utf8")
);

/**
 * 브리핑 호출을 감싸는 **`if` 조건문만** 뽑는다.
 *
 * 🔴 왜 이렇게까지: 호출 앞 300자를 훑으면 **파일 다른 곳의 같은 이름**이 통과시킨다.
 *   실제로 `input.organizationId` 가드를 지운 뮤테이션이 **새어나갔다**.
 *   ⭐ N-45 반복 교훈: 가드는 「무엇을」 뿐 아니라 **「어디서 찾는지」도 좁혀야** 한다.
 */
const briefingGuardCondition = (): string => {
  const call = RUNNER.indexOf("runBriefingForAuditJob({");
  if (call < 0) {
    return "";
  }
  const ifAt = RUNNER.lastIndexOf("if (", call);
  if (ifAt < 0) {
    return "";
  }
  // `if (` 부터 그 조건을 닫는 `) {` 까지.
  const close = RUNNER.indexOf(") {", ifAt);
  return close > ifAt ? RUNNER.slice(ifAt, close) : "";
};

describe("B-4 본류 편입 — 붙이는 방식이 안전한가", () => {
  it("🔴 브리핑은 **완료 저장 뒤**에 돈다 (result 가 있어야 러너가 동작한다)", () => {
    // `runBriefingForAuditJob` 는 `AuditJob.result` 가 비면 throw 한다.
    //   저장 전에 부르면 **항상 실패**한다.
    const save = RUNNER.indexOf('status: "completed"');
    const call = RUNNER.indexOf("runBriefingForAuditJob({");
    expect(save, "완료 저장이 없다").toBeGreaterThan(-1);
    expect(call, "브리핑 호출이 없다").toBeGreaterThan(-1);
    expect(call, "브리핑이 완료 저장보다 먼저 돈다").toBeGreaterThan(save);
  });

  it("🔴 브리핑 실패가 **측정 전체를 무르지 않는다**", () => {
    // 이미 completed 로 저장된 측정이 브리핑 하나 때문에 실패로 뒤집히면 안 된다.
    const at = RUNNER.indexOf("runBriefingForAuditJob({");
    const around = RUNNER.slice(Math.max(0, at - 400), at + 400);
    expect(around).toContain("try {");
    expect(around).toMatch(/catch\s*\(/);
    // 삼키되 **조용히**는 아니다 — 로그는 남긴다.
    expect(around).toMatch(/log\.(warn|error)\(/);
  });

  it("🔴 **로그인 측정에만** 돈다 (무료 진단은 건수가 통제되지 않는다)", () => {
    // cron 은 MAX_TRIGGERS_PER_RUN=5 로 하루 15콜 고정이지만,
    //   무료 진단은 누구나 돌릴 수 있어 크레딧 소진 예측이 무너진다.
    // ⚠️ 호출 앞 N자를 훑으면 **다른 곳의 `input.organizationId`** 가 통과시킨다
    //   (첫 작성에서 실제로 새어나갔다) → 브리핑을 감싸는 **그 `if` 조건문**만 본다.
    expect(
      briefingGuardCondition(),
      "브리핑이 org·brand 없이도 돈다 — 무료 진단까지 크레딧을 쓴다"
    ).toMatch(/input\.organizationId[\s\S]*input\.brandId/);
  });

  it("🔴 **플래그로 끌 수 있다** · 기본 off (크레딧은 되돌릴 수 없다)", () => {
    expect(briefingGuardCondition()).toContain(
      "AUDIT_BRIEFING_IN_MAIN_ENABLED"
    );
    // 기본 off: 값이 정확히 "true" 일 때만 켜진다(미설정·"false"·"1" 모두 off).
    const keyAt = KEYS.indexOf("AUDIT_BRIEFING_IN_MAIN_ENABLED");
    expect(keyAt).toBeGreaterThan(-1);
    expect(KEYS.slice(keyAt, keyAt + 300)).toMatch(/v === "true"/);
    // runtimeEnv 에도 실려야 실제로 읽힌다(빠뜨리면 항상 undefined).
    expect(KEYS).toMatch(
      /AUDIT_BRIEFING_IN_MAIN_ENABLED:\s*\n?\s*process\.env\.AUDIT_BRIEFING_IN_MAIN_ENABLED/
    );
  });

  it("⛔ 호출부에 **복제하지 않는다** (runAuditJob 호출부는 4곳이다)", () => {
    // 4곳에 각각 붙이면 규칙이 갈린다(📕 도메인 정규식 3중 복제 사고).
    //   러너 안 한 곳에서만 부른다.
    const callers = [
      "apps/app/app/actions/brand/start-tracking.ts",
      "apps/app/app/actions/admin/measure.ts",
      "apps/web/app/api/admin/measure-one/route.ts",
      "apps/web/app/api/audit/route.ts",
    ];
    for (const rel of callers) {
      const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(
        src,
        `${rel} 가 브리핑을 직접 부른다 — 러너 한 곳에서만 불러야 한다`
      ).not.toContain("runBriefingForAuditJob");
    }
  });

  it("⛔ 브리핑이 **7엔진 점수에 섞이지 않는다** (축이 다르면 분모도 다르다)", () => {
    // metrics·geoActions 는 브리핑 호출 **앞**에서 확정돼야 한다.
    //   뒤에 있으면 브리핑 결과가 등장률 평균에 들어갈 여지가 생긴다.
    const call = RUNNER.indexOf("runBriefingForAuditJob({");
    const metrics = RUNNER.indexOf("const metrics");
    expect(metrics).toBeGreaterThan(-1);
    expect(metrics, "점수 계산이 브리핑 뒤에 있다").toBeLessThan(call);
  });
});
