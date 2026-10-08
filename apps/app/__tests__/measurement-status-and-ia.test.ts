import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const KO_APP = JSON.parse(
  read("../../packages/internationalization/dictionaries/ko.json")
).app;

describe("측정 상태·결과 IA 계약", () => {
  it("검색 연동을 하나도 설정하지 않았을 때 0/0로 오해시키지 않는다", () => {
    const status = read(
      "app/(authenticated)/components/dashboard-system-status.tsx"
    );
    expect(status).toContain("connections.length === 0");
    // 🔴 2026-10-06 — 문구는 사전(`app.systemStatus.noConnections`)으로 옮겨졌다.
    expect(status).toMatch(/connections\.length === 0\s*\?\s*t\.noConnections/);
    const dict = JSON.parse(
      read("../../packages/internationalization/dictionaries/ko.json")
    ).app.systemStatus;
    expect(dict.noConnections).toBe("아직 연결 없음");
  });

  it("완료된 측정 이력은 정식 공개 리포트로 연결한다", () => {
    const history = read(
      "app/(authenticated)/components/audit-history-list.tsx"
    );
    expect(history).toContain("NEXT_PUBLIC_WEB_URL");
    // 🔴 2026-10-06 — 링크는 `publicReportUrl` 단일 출처(ko → `/ko/audit/…`, en → `/audit/…`).
    expect(history).toContain("publicReportUrl(webUrl, job.id, locale)");
    const link = read("lib/public-report.ts");
    expect(link).toMatch(/locale === "ko" \? "\/ko" : ""/);
  });

  it("실제 AI 응답이 없는 완료 회차는 이력에서도 0%가 아니라 측정 불가다", () => {
    const history = read(
      "app/(authenticated)/components/audit-history-list.tsx"
    );
    expect(history).toContain("withRecomputedAuditMetrics(job.result)");
    expect(history).toContain("!isUsableRun(result)");
    // 🔴 2026-10-06 — 라벨은 사전(`app.jobStatus`)으로 옮겨졌다.
    expect(history).toMatch(/isPartial\s*\?\s*s\.partial/);
    expect(history).toMatch(/isUnavailable\s*\?\s*s\.unavailable/);
    expect(KO_APP.jobStatus.partial).toBe("잠정 결과");
    expect(KO_APP.jobStatus.unavailable).toBe("측정 불가");
    expect(history).toMatch(/const sov = isUnavailable\s*\? null/);
  });

  it("브랜드 목록과 전역 헤더는 판별 미완료 회차를 확정 결과·0%로 취급하지 않는다", () => {
    const brand = read("app/(authenticated)/brand/page.tsx");
    const scoped = read("lib/db/scoped.ts");
    expect(brand).toContain("withRecomputedAuditMetrics(job.result)");
    // 🔴 2026-10-06 — 라벨은 사전(`app.jobStatus.partial*`)으로 옮겨졌다.
    expect(brand).toMatch(
      /isPartial\)\s*\{\s*return \{\s*label: t\.partial,\s*linkLabel: t\.partialLink/
    );
    const jobStatus = JSON.parse(
      read("../../packages/internationalization/dictionaries/ko.json")
    ).app.jobStatus;
    expect(jobStatus.partial).toBe("잠정 결과");
    expect(jobStatus.partialLink).toBe("잠정 결과 보기");
    expect(scoped).toContain(
      "!isUsableRun(withRecomputedAuditMetrics(latestJob.result))"
    );
  });

  it("운영 측정 콘솔의 날짜는 서버·브라우저에서 같은 시간대로 렌더링한다", () => {
    const console = read(
      "app/(authenticated)/admin/measure/measure-console.tsx"
    );
    expect(console).toContain('timeZone: "Asia/Seoul"');
    for (const path of [
      "app/(authenticated)/components/audit-history-list.tsx",
      "app/(authenticated)/components/dashboard-run-context.tsx",
      "app/(authenticated)/components/dashboard-system-status.tsx",
      "app/(authenticated)/lib/dashboard-data.ts",
    ]) {
      expect(read(path)).toContain('timeZone: "Asia/Seoul"');
    }
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
    // 🔴 2026-10-06 — 두 결과 위치 문구는 사전(`app.measuring.to*`)으로 옮겨졌다.
    expect(measuring).toContain("{t.toDashboard}");
    expect(measuring).toContain("{t.toHistory}");
    const measuringKo = JSON.parse(
      read("../../packages/internationalization/dictionaries/ko.json")
    ).app.measuring;
    expect(measuringKo.toDashboard).toContain("대시보드");
    expect(measuringKo.toHistory).toContain("측정 이력");
    expect(measuring).toContain("jobId.slice(-8)");
    expect(measuring).toContain("createdAt");
    expect(measuring).not.toMatch(/\d+\s*%\s*완료/);
  });

  it("내부 측정 상세는 종합 점수와 답변 등장률을 서로 다른 지표로 정의한다", () => {
    const detail = read("app/(authenticated)/history/[jobId]/page.tsx");
    // 🔴 2026-10-06 — 문구는 사전(`app.historyDetail`)으로 옮겨졌다.
    expect(detail).toContain("{t.geoScore}");
    expect(detail).toContain("{t.mentionRate}");
    expect(detail).toContain("{t.geoScoreNote}");
    expect(detail).toContain("t.mentionRateBasis");
    expect(KO_APP.historyDetail.geoScore).toBe("GEO 종합 진단 점수");
    expect(KO_APP.historyDetail.mentionRate).toBe("AI·검색 등장률");
    expect(KO_APP.historyDetail.geoScoreNote).toContain("5축 진단");
    expect(KO_APP.historyDetail.mentionRateBasis).toContain(
      "성공한 AI·검색 응답"
    );
    expect(detail).toContain("successfulResponseCount(metrics)");
    expect(detail).toContain("countMeasurementCoverage");
    expect(detail).toContain('value.engineId !== "naver-briefing"');
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
    expect(actions).toContain("const brands = await scopedBrands()");
    expect(actions).toContain(
      "domain: { in: brands.map((brand) => brand.domain) }"
    );
    // 🔴 2026-10-06 — 안내 문구는 사전(`app.actionsPage.noMixing`)으로 옮겨졌다.
    expect(actions).toContain("{t.noMixing}");
    expect(KO_APP.actionsPage.noMixing).toContain(
      "다른 브랜드의 과거 처방은 섞지 않아요"
    );
  });

  it("추적 질문의 저장·측정·결과 위치를 한 화면에서 설명한다", () => {
    const prompts = read("app/(authenticated)/prompts/page.tsx");
    const scoreboard = read(
      "app/(authenticated)/components/prompt-scoreboard.tsx"
    );
    // 🔴 2026-10-06 — 흐름 문구는 사전(`app.promptsPage.flowBefore`)으로 옮겨졌다.
    expect(prompts).toContain("{t.flowBefore}");
    const flow = JSON.parse(
      read("../../packages/internationalization/dictionaries/ko.json")
    ).app.promptsPage.flowBefore;
    expect(flow).toContain("질문 저장");
    expect(flow).toContain("다음 측정에 사용");
    expect(flow).toContain("결과 누적");
    expect(prompts).toContain("/#tracked-prompts");
    expect(scoreboard).toContain('id="tracked-prompts"');
  });

  it("AuditJob 폴백의 측정 횟수도 현재 브랜드 완료 run만 센다", () => {
    const dashboard = read("app/(authenticated)/lib/dashboard-data.ts");
    expect(dashboard).toContain("sameBrandCompleted.length");
    expect(dashboard).not.toContain("totalCount: jobs.length");
  });
});
