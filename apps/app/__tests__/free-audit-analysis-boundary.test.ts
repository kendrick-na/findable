import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const auditResult = readFileSync(
  join(
    process.cwd(),
    "../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
  ),
  "utf8"
);

describe("무료 진단 심층 분석 표기", () => {
  it("내부 페르소나 대신 고객이 이해할 역할을 표시한다", () => {
    expect(auditResult).toContain('titleKo: "인용 출처 분석"');
    expect(auditResult).toContain('titleKo: "국내 AI 검색 분석"');
    expect(auditResult).toContain('titleKo: "글로벌 AI 검색 분석"');
    expect(auditResult).not.toContain("{report.displayName}");
  });

  it("분석 범위와 개인 에이전트 미접근 사실을 명시한다", () => {
    expect(auditResult).toContain(
      "개인 계정, 프롬프트, 외부 에이전트 대화에는 접근하지 않습니다."
    );
  });

  it("무료 진단을 단발성 리포트로, 대시보드를 지속 관리 공간으로 구분한다", () => {
    expect(auditResult).toContain("AI 검색 가시성 리포트");
    expect(auditResult).toContain("이 리포트는 오늘 측정한 한 시점의 결과입니다");
    expect(auditResult).toContain(
      "대시보드에서는 이 기준점을 이어서 브랜드별 추세, 여러 프롬프트·엔진의 원문, 사이트 준비도, 실행 항목과 재측정 결과를 관리할 수 있어요."
    );
    expect(auditResult).toContain("사이트 SEO 기술 진단 결과는 포함하지 않습니다.");
    expect(auditResult).toContain("이 리포트와 대시보드는 이렇게 이어집니다");
  });

  it("엔진별 대표 응답을 여러 질문 전체 원문처럼 보이게 하지 않는다", () => {
    expect(auditResult).toContain("엔진별 대표 응답");
    expect(auditResult).toContain("질문별 전체 원문·날짜별 변화");
  });
});
