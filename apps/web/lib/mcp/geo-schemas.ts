// 읽기 전용 MCP 응답의 zod 스키마 — K0 계약(`packages/audit/proof-types.ts`)과 1:1.
//
// 🔴 「형태가 있다」는 것은 「값이 맞다」는 보증이 아니다. 이 스키마 통과는 필수 칸이 채워져 있고 열거 값이
//   계약 안에 있다는 뜻일 뿐이다. 값이 맞는지는 시험이 고정 입력으로 다시 계산해 비교한다.
// 열거 값은 K0 의 `as const` 튜플에서 가져온다(복사하지 않는다 — 계약이 바뀌면 같이 바뀐다).
// `limits_en` 은 영어 한 벌 고정 문구(상수)다. 영어 응답 전체·영어 도구 설명 전체를 뜻하지 않는다.

import type {
  EvidenceEnvelope,
  McpReadonlyError,
  UnavailableReason,
} from "@repo/audit/proof-types";
import {
  MCP_READONLY_TOOL_NAMES,
  NOT_COMPARABLE_REASONS,
  PROOF_LANGUAGES,
  UNAVAILABLE_REASONS,
} from "@repo/audit/proof-types";
import { z } from "zod";

import { LIMITS_KO } from "./messages";

export const LIMITS_EN =
  "AI answers can differ from run to run, and this quick check uses a small sample (few questions and engines). Do not judge by a single number.";

/** 한계 문구 묶음(한국어는 기존 상수를 읽기만 한다). */
export const LIMITS_BLOCK = { limits_ko: LIMITS_KO, limits_en: LIMITS_EN };

export const READONLY_ERROR_MESSAGES_KO = {
  disabled: "이 커넥터는 현재 준비 중입니다.",
  internal: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  not_available: "요청한 브랜드의 결과를 제공할 수 없습니다.",
  unauthorized: "인증이 필요합니다.",
} as const satisfies Record<McpReadonlyError["error"]["code"], string>;

// [Known<T>]

const reasonSchema = z.enum(UNAVAILABLE_REASONS);

export function knownSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.strictObject({
      as_of: z.string().nullable(),
      status: z.literal("known"),
      value,
    }),
    z.strictObject({
      as_of: z.string().nullable(),
      detail_ko: z.string(),
      reason: reasonSchema,
      status: z.literal("unavailable"),
    }),
  ]);
}

// [언어·코호트]

const languageKeySchema = z.strictObject({
  language: z.enum([...PROOF_LANGUAGES, "mixed", "unknown"]),
  script: z.enum(["Hang", "Latn"]).nullable(),
});

const cohortSchema = z.strictObject({
  engine_set_key: z.string().nullable(),
  language: languageKeySchema,
  question_set_key: z.string().nullable(),
  sampling_version: z.string(),
  verdict_version: z.number().nullable(),
});

// [수치]

const count = z.number().int().min(0);
const ratio = z.number().min(0).max(1).nullable();

const bucketCountsSchema = z.strictObject({
  confirmed: count,
  different_entity: count,
  engine_error: count,
  unknown: count,
  unverified: count,
});

const intervalSchema = z.strictObject({
  confidence: z.literal(0.95),
  high: z.number().min(0).max(1),
  low: z.number().min(0).max(1),
  method: z.enum(["wilson", "question_bootstrap"]),
});

const observedSchema = z.strictObject({
  buckets: bucketCountsSchema,
  collection: z.strictObject({
    attempted: count,
    measured: count,
    rate: ratio,
    repeat_count: count,
    suppressed: z.boolean(),
    suppression_threshold: z.number().nullable(),
    unit: z.enum(["engine", "question_engine_cell"]),
  }),
  denominator: count,
  exposure_count: count,
  exposure_rate: ratio,
  group: z.enum(["ai_brand", "discovery", "search"]),
  interval: knownSchema(intervalSchema),
});

const unmeasuredRowSchema = z.strictObject({
  action_ko: z.string(),
  code: z.string().min(1),
  count,
  denominator: count,
  label_ko: z.string(),
  rate: ratio,
});

const engineModelSchema = z.strictObject({
  call_source: z.enum(["web", "api", "api_fallback"]).nullable(),
  engine_id: z.string(),
  engine_set: z.string().nullable(),
  model_id: knownSchema(z.string()),
});

const sourceIdsSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    audit_job_ids: z.array(z.string()),
    kind: z.literal("audit_jobs"),
    question_set_key: z.string().nullable(),
    sample_count: count,
  }),
  z.strictObject({ checked_url: z.string(), kind: z.literal("live_fetch") }),
]);

const retrievalSchema = z.strictObject({
  by_engine: z.record(
    z.string(),
    z.strictObject({
      engine_class: z.enum([
        "web_search",
        "model_knowledge",
        "mixed",
        "unknown",
      ]),
      retrieval: z.enum(["used", "not_used", "unknown"]),
    })
  ),
  retrieval_used: z.enum(["used", "not_used", "unknown", "mixed"]),
  source_urls: z.array(z.string()),
});

const indexCheckSchema = z.strictObject({
  checked_at: z.string().nullable(),
  indexed: z.boolean().nullable(),
  method: z.enum(["search_console", "site_query", "manual", "none"]),
  page_urls: z.array(z.string()),
});

/** 비교 요약은 이 단계에서 만들지 않는다(null 또는 unavailable). 값 형태는 B1-min 이 채운 뒤 좁힌다. */
const comparisonSchema = knownSchema(
  z.looseObject({
    not_comparable: z.enum(NOT_COMPARABLE_REASONS).nullable(),
  })
).nullable();

export const evidenceEnvelopeSchema = z.strictObject({
  comparison: comparisonSchema,
  engine_model: knownSchema(z.array(engineModelSchema)),
  index_check: knownSchema(indexCheckSchema),
  language: languageKeySchema,
  limits: z.strictObject({ limits_en: z.string(), limits_ko: z.string() }),
  measured_at: knownSchema(
    z.strictObject({ first: z.string(), last: z.string() })
  ),
  method_version: knownSchema(
    z.strictObject({
      cohort: cohortSchema,
      interval_method: z.enum(["wilson", "question_bootstrap"]).nullable(),
    })
  ),
  observed: knownSchema(observedSchema),
  retrieval: knownSchema(retrievalSchema),
  schema_version: z.literal(1),
  source_ids: knownSchema(sourceIdsSchema),
  unmeasured: z.array(unmeasuredRowSchema),
});

// [응답 봉투(ok / unverifiable)]

// 키 순서가 곧 응답의 키 순서다: 요약 문장(message_ko)을 맨 앞에 두고 근거 봉투는 뒤에 둔다(응답이 커서).
const truncationSchema = z.strictObject({
  source_urls_returned: count.optional(),
  source_urls_total: count.optional(),
  truncated: z.boolean(),
});

export function okResponseSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({
    message_ko: z.string(),
    status: z.literal("ok"),
    tool: z.enum(MCP_READONLY_TOOL_NAMES),
    language: languageKeySchema,
    data,
    limits_ko: z.string(),
    limits_en: z.string(),
    evidence: evidenceEnvelopeSchema,
    // 출처 URL 을 개수·길이·응답 크기 상한으로 줄였는지(줄였으면 truncated:true 와 개수).
    truncation: truncationSchema.optional(),
  });
}

export const unverifiableResponseSchema = z.strictObject({
  message_ko: z.string(),
  status: z.literal("unverifiable"),
  tool: z.enum(MCP_READONLY_TOOL_NAMES),
  reason: reasonSchema,
  language: languageKeySchema,
  data: z.null(),
  limits_ko: z.string(),
  limits_en: z.string(),
  evidence: evidenceEnvelopeSchema,
  truncation: truncationSchema.optional(),
});

// [도구별 data — 화이트리스트: 여기 없는 키는 응답에 실리지 않는다]

const rateGroupSchema = z.strictObject({
  denominator: count,
  exposure_count: count,
  exposure_rate: ratio,
});

export const summaryDataSchema = z.strictObject({
  brand_id: z.string(),
  brand_name: z.string(),
  collection_rate: ratio,
  exposure_denominator: count,
  exposure_rate: ratio,
  groups: z.strictObject({
    ai_brand: rateGroupSchema,
    discovery: rateGroupSchema.nullable(),
    search: rateGroupSchema.nullable(),
  }),
  measured_at: z.string(),
});

const breakdownGroupSchema = z.strictObject({
  adjudicated: count,
  buckets: bucketCountsSchema,
  /** 판정이 끝난 3분류(confirmed·different_entity·unknown)만 비율을 낸다. 분모 0 이면 전부 null. */
  rates: z.strictObject({
    confirmed: ratio,
    different_entity: ratio,
    unknown: ratio,
  }),
  total: count,
});

export const breakdownDataSchema = z.strictObject({
  brand_id: z.string(),
  groups: z.strictObject({
    ai_brand: breakdownGroupSchema,
    search: breakdownGroupSchema.nullable(),
  }),
  measured_at: z.string(),
});

export const factsDataSchema = z.strictObject({
  checked_at: z.string(),
  checked_url: z.string(),
  items: z.array(
    z.strictObject({ detail: z.string(), key: z.string(), status: z.string() })
  ),
  limits_ko: z.string(),
  summary_ko: z.string(),
});

export type SummaryData = z.infer<typeof summaryDataSchema>;
export type BreakdownData = z.infer<typeof breakdownDataSchema>;
export type FactsData = z.infer<typeof factsDataSchema>;

// [「확인 불가」 봉투]

const UNKNOWN_LANGUAGE: EvidenceEnvelope["language"] = {
  language: "unknown",
  script: null,
};

/**
 * 재료가 없을 때의 봉투: 모든 Known 을 unavailable 로 채운다. 응답을 거부하지 않는다.
 * 언어를 모를 때의 값은 K0 의 `unknown`(어떤 코호트와도 합치지 않음)이다.
 */
export function unverifiableEnvelope(
  reason: UnavailableReason,
  detail_ko: string,
  language: EvidenceEnvelope["language"] = UNKNOWN_LANGUAGE
): EvidenceEnvelope {
  const gone = {
    as_of: null,
    detail_ko,
    reason,
    status: "unavailable" as const,
  };
  return {
    comparison: null,
    engine_model: gone,
    index_check: gone,
    language,
    limits: LIMITS_BLOCK,
    measured_at: gone,
    method_version: gone,
    observed: gone,
    retrieval: gone,
    schema_version: 1,
    source_ids: gone,
    unmeasured: [],
  };
}
