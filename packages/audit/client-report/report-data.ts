// 고객 웹 리포트의 **동결 스냅숏**(Report.data) 형식.
//
// 🔴 왜 동결하나: 리포트의 핵심은 사람이 답변 원문을 한 건씩 읽고 내린 판별(labels)이다.
//   웹에서 열 때마다 audit 를 다시 계산하면 측정 데이터가 바뀌는 순간(재측정·정규화 수정)
//   판별과 답변이 어긋나고, 고객이 받은 PDF 와 웹이 다른 숫자를 말한다.
//   → import 할 때 한 번 계산해 {계산 결과 + 사람이 확정한 문구}를 통째로 저장하고,
//     웹 페이지는 **저장된 값만** 그린다(재계산 없음). 고치려면 버전을 올려 새로 import.

import { z } from "zod";
import {
  type ClientReportAudit,
  type ClientReportComputed,
  type ClientReportConfig,
  computeClientReport,
} from "./compute";
import { renderStrings } from "./render-strings";

export const CLIENT_REPORT_SCHEMA = "findable.client-report";
export const CLIENT_REPORT_SCHEMA_VERSION = 1;
/**
 * 이 코드가 옮겨 온 템플릿 스냅숏. `Findable_GEO리포트_템플릿/template.html` 을 바꾸면
 * 웹 렌더러(apps/web/app/r/...)도 같이 고치고 이 값을 올린다.
 */
export const CLIENT_REPORT_TEMPLATE_VERSION = "geo-report-template@2026-09-28";

const labelId = z.enum(["ok", "other", "made", "generic", "unknown", "none"]);

/** 페이지가 읽는 config 필드. 여기 없는 필드는 저장은 되지만 화면에 쓰이지 않는다. */
export const clientReportConfigViewSchema = z
  .object({
    slug: z.string().optional(),
    brand: z.string().min(1),
    brand_en: z.string().optional(),
    domain: z.string().min(1),
    official_domains: z.array(z.string()).min(1),
    lookalike_domains: z.array(z.string()).optional(),
    measured_at: z.string().min(1),
    issued_at: z.string().min(4),
    audit_id: z.string().min(8),
    questions: z.array(z.string()).min(1),
    question_short: z.array(z.string()).min(1),
    official_keywords: z.array(z.string()),
    labels: z.array(z.object({ l: labelId, who: z.string(), q: z.string() })),
    cover_title: z.string(),
    cover_sub: z.string(),
    why: z.array(z.object({ h: z.string(), p: z.string() })),
    insights_accuracy: z.array(z.string()),
    insights_matrix: z.array(z.string()),
    insights_citation: z.array(z.string()),
    causes: z.array(
      z.object({ n: z.string().optional(), h: z.string(), p: z.string() })
    ),
    site_checks: z.array(
      z.object({
        item: z.string(),
        state: z.enum(["ok", "warn", "bad"]),
        note: z.string(),
      })
    ),
    playbook: z.array(
      z.object({ p: z.enum(["P0", "P1", "P2"]), h: z.string(), d: z.string() })
    ),
    poc: z.array(z.object({ d: z.string(), h: z.string(), p: z.string() })),
    site_checked_at: z.string().optional(),
    headlines: z.record(z.string(), z.string()).optional(),
  })
  .loose();
export type ClientReportConfigView = z.infer<
  typeof clientReportConfigViewSchema
>;

const answerSchema = z.object({
  engine: z.enum([
    "chatgpt",
    "claude",
    "perplexity",
    "gemini",
    "hyperclova",
    "naver",
    "daum",
  ]),
  q: z.number().int().nonnegative(),
  label: labelId,
  who: z.string(),
  quote: z.string(),
  domains: z.array(z.string()),
  official: z.number().int().nonnegative(),
});

// 계산 결과는 이 코드가 만든 값이라 깊게 검사하지 않는다 — 형태(배열·객체)만 확인.
const computedSchema = z.object({
  answers: z.array(answerSchema).min(1),
  engines: z.array(
    z
      .object({ id: z.string(), cells: z.record(z.string(), answerSchema) })
      .loose()
  ),
  per_q: z.array(z.object({ i: z.number() }).loose()),
  channels: z.array(z.object({ id: z.string(), pct: z.number() }).loose()),
  top: z.array(z.object({ domain: z.string() }).loose()),
  s: z
    .object({ n: z.number(), ok_n: z.number(), cites_total: z.number() })
    .loose(),
});

export const clientReportDataSchema = z.object({
  schema: z.literal(CLIENT_REPORT_SCHEMA),
  schemaVersion: z.literal(CLIENT_REPORT_SCHEMA_VERSION),
  /** 사람이 매기는 리포트 판(v1, v2 …). 파일명·표지에 찍힌다. */
  version: z.number().int().positive(),
  templateVersion: z.string(),
  source: z.object({
    auditId: z.string(),
    clientSlug: z.string(),
    importedAt: z.string(),
  }),
  config: clientReportConfigViewSchema,
  computed: computedSchema,
});

export interface ClientReportData {
  computed: ClientReportComputed;
  config: ClientReportConfigView;
  schema: typeof CLIENT_REPORT_SCHEMA;
  schemaVersion: typeof CLIENT_REPORT_SCHEMA_VERSION;
  source: { auditId: string; clientSlug: string; importedAt: string };
  templateVersion: string;
  version: number;
}

export interface ClientReportDisclosure {
  /** Report.data is a point-in-time snapshot, not a live remeasurement. */
  isFrozenSnapshot: true;
  /** Historical engine rows that must not be read as current measurements. */
  retiredEngineIds: string[];
  /** Pre-cutover Naver rows were Findable's synthetic summary, not Naver AI. */
  legacySyntheticEngineIds: string[];
}

const RETIRED_ENGINE_IDS = new Set(["hyperclova"]);

/**
 * Public, policy-neutral disclosure for an already-issued report.
 * This deliberately does not invalidate the snapshot or its PDF URL.
 */
export function clientReportDisclosure(
  data: Pick<ClientReportData, "computed" | "config">
): ClientReportDisclosure {
  const engineIds = new Set<string>([
    ...data.computed.answers.map((answer) => answer.engine),
    ...data.computed.engines.map((engine) => engine.id),
  ]);
  const naverEngine = data.computed.engines.find((engine) => engine.id === "naver");
  const measuredAt = data.config.measured_at.replaceAll(".", "-");
  const legacyNaver =
    engineIds.has("naver") &&
    (naverEngine?.name === "네이버 AI" || measuredAt < "2026-09-29");
  return {
    isFrozenSnapshot: true,
    retiredEngineIds: [...RETIRED_ENGINE_IDS].filter((id) => engineIds.has(id)),
    legacySyntheticEngineIds: legacyNaver ? ["naver"] : [],
  };
}

/** 저장된 JSON → 타입. 형식이 다르면 null(페이지는 404 로 처리). */
export function parseClientReportData(json: unknown): ClientReportData | null {
  const r = clientReportDataSchema.safeParse(json);
  // 검사는 형태 확인용이고, 반환은 원본 그대로(검사 스키마가 느슨한 부분의 필드를 잃지 않게).
  return r.success ? (json as ClientReportData) : null;
}

export function buildClientReportData(input: {
  audit: ClientReportAudit;
  config: ClientReportConfig;
  importedAt: Date;
  slug: string;
  version: number;
}): ClientReportData {
  const computed = computeClientReport(input.config, input.audit);
  const rendered = renderStrings(input.config, {
    s: computed.s,
    c: input.config,
  });
  const config = clientReportConfigViewSchema.parse(rendered);
  if (config.questions.length !== config.question_short.length) {
    throw new Error("questions 와 question_short 개수가 다릅니다");
  }
  return {
    schema: CLIENT_REPORT_SCHEMA,
    schemaVersion: CLIENT_REPORT_SCHEMA_VERSION,
    version: input.version,
    templateVersion: CLIENT_REPORT_TEMPLATE_VERSION,
    source: {
      auditId: config.audit_id,
      clientSlug: input.slug,
      importedAt: input.importedAt.toISOString(),
    },
    config,
    computed,
  };
}

/** `회사명_AI검색진단_v버전_날짜.pdf` — 날짜는 발행일(issued_at)의 숫자만. */
export function clientReportPdfFilename(data: ClientReportData): string {
  const brand = data.config.brand.replace(/[\\/:*?"<>|\s]+/g, "");
  const date = data.config.issued_at.replace(/\D/g, "");
  return `${brand}_AI검색진단_v${data.version}_${date}.pdf`;
}
