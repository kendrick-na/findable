import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("측정 상태·결과 IA 계약", () => {
  it("완료된 측정 이력은 정식 공개 리포트로 연결한다", () => {
    const history = read(
      "app/(authenticated)/components/audit-history-list.tsx"
    );
    expect(history).toContain("NEXT_PUBLIC_WEB_URL");
    expect(history).toMatch(/\/ko\/audit\/\$\{job\.id\}/);
  });

  it("실제 AI 응답이 없는 완료 회차는 이력에서도 0%가 아니라 측정 불가다", () => {
    const history = read(
      "app/(authenticated)/components/audit-history-list.tsx"
    );
    expect(history).toContain("isUsableRun(job.result)");
    expect(history).toContain('isUnavailable ? "측정 불가"');
    expect(history).toMatch(/const sov = isUnavailable\s*\? null/);
  });

  it("측정 불가 완료 회차는 무료 플랜의 24시간 재측정을 막지 않는다", () => {
    const tracking = read("app/actions/brand/start-tracking.ts");
    expect(tracking).toContain("isUsableRun(recent.result)");
    expect(tracking).toMatch(
      /recent\.status === "completed"\s*&&\s*!isUsableRun\(recent\.result\)/
    );
  });

  it("대기 화면은 가짜 진행률 대신 실제 서버 상태와 두 결과 위치를 안내한다", () => {
    const measuring = read(
      "app/(authenticated)/brand/measuring/measuring-view.tsx"
    );
    expect(measuring).toContain('status === "queued"');
    expect(measuring).toContain('status === "processing"');
    expect(measuring).toContain("대시보드");
    expect(measuring).toContain("측정 이력");
    expect(measuring).toContain("jobId.slice(-8)");
    expect(measuring).toContain("createdAt");
    expect(measuring).not.toMatch(/\d+\s*%\s*완료/);
  });

  it("내부 측정 상세는 종합 점수와 답변 등장률을 서로 다른 지표로 정의한다", () => {
    const detail = read("app/(authenticated)/history/[jobId]/page.tsx");
    expect(detail).toContain("GEO 종합 진단 점수");
    expect(detail).toContain("AI 답변 등장률");
    expect(detail).toContain("5축 진단");
    expect(detail).toContain("성공한 답변");
    expect(detail).toContain("successfulResponseCount(metrics)");
    expect(detail).toContain("countMeasurementCoverage");
    expect(detail).toContain('value.engineId === "naver-briefing"');
  });

  it("공개 리포트도 등장률을 경쟁 점유율처럼 말하지 않는다", () => {
    const result = read(
      "../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
    );
    expect(result).toContain("AI 답변 등장률");
    expect(result).toContain("GEO 종합 점수");
    expect(result).not.toContain("AI 답변 점유율");
    expect(result).not.toMatch(/나머지 \$\{100 - sov\}%는 경쟁 브랜드/);
  });

  it("할 일 분석 시작 뒤 저장 위치를 알리고 실제 queued 상태를 다시 읽는다", () => {
    const result = read(
      "../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
    );
    expect(result).toContain("setStarted(true)");
    expect(result).toContain("window.location.reload()");
    expect(result).toContain("결과는 여기와 본문의 ‘먼저 할 일’에 저장돼요");
  });

  it("지금 할 일은 현재 조직과 무관한 이메일 무료진단을 섞지 않는다", () => {
    const actions = read("app/(authenticated)/actions/page.tsx");
    expect(actions).toContain("selectEmailAuditForBrands");
    expect(actions).toContain("brand.domain === emailAudit.domain");
    expect(actions).toContain("다른 브랜드의 과거 처방은 섞지 않아요");
  });

  it("추적 질문의 저장·측정·결과 위치를 한 화면에서 설명한다", () => {
    const prompts = read("app/(authenticated)/prompts/page.tsx");
    const scoreboard = read(
      "app/(authenticated)/components/prompt-scoreboard.tsx"
    );
    expect(prompts).toContain("질문 저장");
    expect(prompts).toContain("다음 측정에 사용");
    expect(prompts).toContain("결과 누적");
    expect(prompts).toContain("/#tracked-prompts");
    expect(scoreboard).toContain('id="tracked-prompts"');
  });

  it("AuditJob 폴백의 측정 횟수도 현재 브랜드 완료 run만 센다", () => {
    const dashboard = read("app/(authenticated)/lib/dashboard-data.ts");
    expect(dashboard).toContain("sameBrandCompleted.length");
    expect(dashboard).not.toContain("totalCount: jobs.length");
  });
});
