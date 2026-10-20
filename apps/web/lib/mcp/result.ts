// 저장된 `AuditJob.result` → MCP 응답 모양. **계산하지 않는다** — 기존 단일 진실만 읽는다.
//
// 이 저장소는 "못 잰 것을 0점이라 부른" 사고(N-14)와 "분모 축을 섞은" 사고(N-28·N-30)를 냈다.
// 그래서 여기서는 점수를 새로 만들지 않고, 엔진별 "언급 여부"와 그 분모(측정에 성공한 엔진 수)만 말한다.
//   - 측정 실패 엔진은 `mentioned: null` + `availability: "error"` (거짓 0 이 아니다)
//   - `isPublishableAuditResult` 가 아니면 숫자를 내보내지 않는다.

import {
  citationPrescriptionsRestricted,
  isPublishableAuditResult,
  withRecomputedAuditMetrics,
} from "@repo/audit/normalize-stored-metrics";
import { metricsOf } from "@repo/audit/run-quality";

import { LIMITS_KO, siteLink } from "./messages";

export interface McpEngineRow {
  availability: "measured" | "error";
  engine: string;
  mentioned: boolean | null;
  note_ko: string;
}

export interface McpAuditResult {
  brand_name: string | null;
  domain: string;
  engines: McpEngineRow[];
  findings: Array<{ evidence: string; text_ko: string }>;
  limits_ko: string;
  measured_at: string;
  sample_ko: string;
  site_link: string;
}

export interface JobForResult {
  completedAt: Date | null;
  createdAt: Date;
  domain: string;
  result: unknown;
}

/** 표시할 수 있는 결과인지. 아니면 `null` — 호출자는 "결과를 신뢰할 수 없어 표시하지 않음"으로 안내한다. */
export function toMcpResult(
  job: JobForResult,
  brandName: string | null,
  client: string
): McpAuditResult | null {
  const corrected = withRecomputedAuditMetrics(job.result);
  if (!isPublishableAuditResult(corrected)) {
    return null;
  }
  const metrics = metricsOf(corrected);
  if (!metrics || (metrics.enginesCovered?.length ?? 0) === 0) {
    return null;
  }

  const errorEngines = new Set((metrics.errors ?? []).map((e) => e.engineId));
  const withMention = new Set(metrics.enginesWithMention ?? []);

  const engines: McpEngineRow[] = metrics.enginesCovered.map((engine) => {
    if (errorEngines.has(engine)) {
      return {
        engine,
        mentioned: null,
        availability: "error",
        note_ko: "이 엔진은 측정에 실패했습니다(언급 여부를 알 수 없음).",
      };
    }
    const mentioned = withMention.has(engine);
    return {
      engine,
      mentioned,
      availability: "measured",
      note_ko: mentioned
        ? "답변에서 브랜드가 언급되었습니다."
        : "측정했으나 답변에 브랜드가 나오지 않았습니다.",
    };
  });

  const measured = engines.filter((e) => e.availability === "measured");
  const mentionedCount = measured.filter((e) => e.mentioned === true).length;

  const findings: McpAuditResult["findings"] = [
    {
      text_ko: `측정에 성공한 AI 엔진 ${measured.length}곳 중 ${mentionedCount}곳에서 브랜드가 언급되었습니다.`,
      evidence: `측정 성공 엔진 ${measured.length}곳 기준, 실패 ${engines.length - measured.length}곳은 제외`,
    },
  ];

  // 인용 출처는 브랜드와의 관계가 확인된 경우에만 사실로 말한다(기존 판정 재사용).
  const top = metrics.topCitedDomains ?? [];
  if (!citationPrescriptionsRestricted(corrected) && top.length > 0) {
    findings.push({
      text_ko: `답변에서 자주 인용된 도메인: ${top
        .slice(0, 3)
        .map((d) => `${d.domain}(${d.count}회)`)
        .join(", ")}`,
      evidence: "측정된 답변 안의 인용 링크 집계",
    });
  }

  const when = job.completedAt ?? job.createdAt;
  return {
    domain: job.domain,
    brand_name: brandName,
    measured_at: when.toISOString(),
    engines,
    findings,
    sample_ko: `엔진 ${engines.length}곳에 대한 1회 측정`,
    limits_ko: LIMITS_KO,
    site_link: siteLink(client),
  };
}
