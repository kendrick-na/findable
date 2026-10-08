import { createHash } from "node:crypto";
import { detectBrandMention } from "@repo/ai/lib/engines/utils";
import {
  isSearchResultEngine,
  type MentionVerdict,
  verifyMention,
  verifySearchRowByRules,
} from "@repo/ai/lib/mention-verdict";
import { MENTION_VERDICT_VERSION } from "@repo/ai/lib/mention-verdict-version";
import { withRecomputedAuditMetrics } from "./normalize-stored-metrics";

interface StoredAudit {
  brandName: string;
  brandVariants?: string[];
  domain: string;
  engineResponses: Array<{
    engineId: string;
    rawResponse?: string;
    excerpt?: string;
    errorMessage?: string | null;
    isStub?: boolean;
    citedSources?: Array<{ domain?: string; url?: string }>;
  }>;
}

/** Read-only proposal. No database imports, mutations, or publishable score.
 * A proposal requires source-to-claim review before materializing a new report.
 * In particular, old search candidate lists are NOT evidence of actual citation.
 */
export async function proposeAuditRevalidation(
  original: StoredAudit,
  officialSite: NonNullable<
    Parameters<typeof verifyMention>[0]["officialSite"]
  >,
  verify: typeof verifyMention = verifyMention
) {
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify(original))
    .digest("hex");
  const rows: Array<{
    index: number;
    engineId: string;
    verdict: MentionVerdict;
    reason: string;
  }> = [];
  for (const [index, row] of original.engineResponses.entries()) {
    const text = row.rawResponse ?? row.excerpt ?? "";
    let verdict: MentionVerdict = {
      counted: false,
      quality: "unverified",
      via: "skipped",
    };
    let reason = "incomplete_source_text";
    if (row.errorMessage || row.isStub) {
      reason = "engine_unavailable";
    } else if (
      text.trim() &&
      (row.rawResponse !== undefined || !text.trimEnd().endsWith("…"))
    ) {
      try {
        // 🔴 네이버·다음 검색 결과는 약관상 AI 입력 금지(2026-10-07) → 규칙 전용 판정.
        const judge = isSearchResultEngine(row.engineId)
          ? (input: Parameters<typeof verifyMention>[0]) =>
              Promise.resolve(verifySearchRowByRules(input))
          : verify;
        verdict = await judge({
          brandName: original.brandName,
          brandDomain: original.domain,
          officialSite,
          text,
          // Never feed a previous rejected verdict back as stringMatched.
          stringMatched: detectBrandMention(
            text,
            original.brandName,
            original.brandVariants
          ).mentioned,
          citedDomains: row.citedSources
            ?.map((source) => source.domain ?? source.url ?? "")
            .filter(Boolean),
        });
        reason = "entity_rechecked_source_claim_review_pending";
      } catch {
        reason = "verification_failed";
      }
    }
    rows.push({ index, engineId: row.engineId, verdict, reason });
  }
  return {
    sourceDigest,
    proposedVerdictVersion: MENTION_VERDICT_VERSION,
    reviewRequired: true as const,
    rows,
  };
}

// ─────────────────────────────────────────────────────────
// 재검증 적용(backfill) — 2026-09-28
// ─────────────────────────────────────────────────────────
//
// 왜: 판정 계약(MENTION_VERDICT_VERSION) 이전에 저장된 회차는 영원히
//   `revalidation_required` 로 남아 점수가 비었다. 위 proposeAuditRevalidation 은
//   호출처가 0곳이었다. 여기서 저장된 **원문**으로 판정만 다시 하고, 새 판정으로
//   만든 결과를 **새 버전**으로 내놓는다. 원본 결과는 `revalidation.original` 에
//   통째로 보존한다(덮어쓰기 금지 — 이 저장소엔 영구 소실 이력이 있다).
//
// ⛔ 이 함수는 DB 를 모른다. 쓰기는 관리자 전용 경로가 한다(dry-run 기본).
// ⚠️ 원문이 잘렸거나 없는 행은 「판별 불가」로 두고 분모에서 뺀다 → 회차 단위로
//   `recommendRemeasure=true`(재측정 권장). 없는 증거로 부재를 확정하지 않는다.

const CORE_ENGINE_IDS = new Set([
  "chatgpt",
  "chatgpt-web",
  "claude",
  "perplexity",
  "gemini",
  "hyperclova",
  "naver",
  "daum",
]);

export const AUDIT_REVALIDATION_FORMAT = 1;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface AuditRevalidationSummary {
  engineUnavailable: number;
  format: typeof AUDIT_REVALIDATION_FORMAT;
  incompleteSourceText: number;
  judgeFailed: number;
  previousVerdictVersion: number | null;
  rechecked: number;
  /** 원문 부족·판정 실패가 1건이라도 있으면 true — 화면·운영은 「재측정 권장」. */
  recommendRemeasure: boolean;
  revalidatedAt: string;
  sourceDigest: string;
  verdictVersion: number;
}

export type AuditRevalidationOutcome =
  | {
      status: "skipped";
      reason: "not_an_audit" | "already_current" | "missing_official_identity";
      /** 공식 사이트 근거가 저장되지 않은 회차는 다시 판정할 기준이 없다. */
      recommendRemeasure: boolean;
    }
  | {
      status: "ready";
      result: Row;
      summary: AuditRevalidationSummary;
    };

type OfficialSite = NonNullable<
  Parameters<typeof verifyMention>[0]["officialSite"]
>;
type StoredAuditRecord = Row & {
  brandName: string;
  domain: string;
  engineResponses: unknown[];
};
type ProposalRow = Awaited<
  ReturnType<typeof proposeAuditRevalidation>
>["rows"][number];

function isStoredAudit(value: unknown): value is StoredAuditRecord {
  return (
    isRow(value) &&
    typeof value.brandName === "string" &&
    typeof value.domain === "string" &&
    Array.isArray(value.engineResponses)
  );
}

function recordedOfficialSite(stored: Row): OfficialSite | null {
  const context = isRow(stored.measurementContext)
    ? stored.measurementContext
    : null;
  return context && isRow(context.officialSiteIdentity)
    ? (context.officialSiteIdentity as OfficialSite)
    : null;
}

function proposalInput(row: Row): StoredAudit["engineResponses"][number] {
  return {
    engineId: String(row.engineId),
    rawResponse:
      typeof row.rawResponse === "string" ? row.rawResponse : undefined,
    excerpt: typeof row.excerpt === "string" ? row.excerpt : undefined,
    errorMessage:
      typeof row.errorMessage === "string" ? row.errorMessage : null,
    isStub: row.isStub === true,
    citedSources: Array.isArray(row.citedSources)
      ? (row.citedSources as { domain?: string; url?: string }[])
      : undefined,
  };
}

type RowOutcome =
  | "rechecked"
  | "rechecked_judge_failed"
  | "engine_unavailable"
  | "incomplete_source_text"
  | "judge_failed";

/** 제안 1행을 저장 행에 적용한다. 원본 행은 바꾸지 않는다. */
function applyProposalRow(
  original: Row,
  item: ProposalRow
): { outcome: RowOutcome; row: Row } {
  if (item.reason === "engine_unavailable") {
    return { outcome: "engine_unavailable", row: original };
  }
  if (item.reason === "entity_rechecked_source_claim_review_pending") {
    const { verdict } = item;
    return {
      outcome:
        verdict.reason === "judge_failed"
          ? "rechecked_judge_failed"
          : "rechecked",
      row: {
        ...original,
        brandMentioned: verdict.counted,
        mentionQuality: verdict.quality,
        verdictVia: verdict.via,
        verdictReason: verdict.reason,
        mentionPosition: verdict.counted
          ? (original.mentionPosition ?? null)
          : null,
        mentionListSize: verdict.counted
          ? (original.mentionListSize ?? null)
          : null,
      },
    };
  }
  const outcome =
    item.reason === "verification_failed"
      ? "judge_failed"
      : "incomplete_source_text";
  return {
    outcome,
    row: {
      ...original,
      brandMentioned: false,
      mentionQuality: "unverified",
      verdictVia: "skipped",
      verdictReason: outcome,
      mentionPosition: null,
      mentionListSize: null,
    },
  };
}

/**
 * 저장된 `AuditJob.result` 하나를 새 판정 계약으로 다시 판정한 **새 결과**를 만든다.
 * 입력 객체는 변형하지 않는다.
 */
export async function revalidateStoredAuditResult(
  stored: unknown,
  options: {
    /** 이미 현재 버전인 회차도 다시 판정(판정기 비용 발생). 기본 false. */
    includeCurrentVersion?: boolean;
    now?: Date;
    verify?: typeof verifyMention;
  } = {}
): Promise<AuditRevalidationOutcome> {
  if (!isStoredAudit(stored)) {
    return {
      status: "skipped",
      reason: "not_an_audit",
      recommendRemeasure: false,
    };
  }
  const isCurrent =
    stored.mentionVerdictVersion === MENTION_VERDICT_VERSION &&
    stored.verificationState !== "revalidation_required";
  if (isCurrent && !options.includeCurrentVersion) {
    return {
      status: "skipped",
      reason: "already_current",
      recommendRemeasure: false,
    };
  }
  const identity = recordedOfficialSite(stored);
  if (!identity) {
    return {
      status: "skipped",
      reason: "missing_official_identity",
      recommendRemeasure: true,
    };
  }

  const rows = stored.engineResponses;
  const coreIndexes = rows.flatMap((row, index) =>
    isRow(row) && CORE_ENGINE_IDS.has(String(row.engineId)) ? [index] : []
  );
  const proposal = await proposeAuditRevalidation(
    {
      brandName: stored.brandName,
      domain: stored.domain,
      brandVariants: Array.isArray(stored.brandVariants)
        ? stored.brandVariants.filter(
            (name): name is string => typeof name === "string"
          )
        : undefined,
      engineResponses: coreIndexes.map((index) =>
        proposalInput(rows[index] as Row)
      ),
    },
    identity,
    options.verify
  );

  const counts: Record<RowOutcome, number> = {
    rechecked: 0,
    rechecked_judge_failed: 0,
    engine_unavailable: 0,
    incomplete_source_text: 0,
    judge_failed: 0,
  };
  const nextRows = [...rows];
  for (const item of proposal.rows) {
    const index = coreIndexes[item.index];
    const original = index === undefined ? undefined : rows[index];
    if (index !== undefined && isRow(original)) {
      const applied = applyProposalRow(original, item);
      counts[applied.outcome] += 1;
      nextRows[index] = applied.row;
    }
  }

  const judgeFailed = counts.judge_failed + counts.rechecked_judge_failed;
  const summary: AuditRevalidationSummary = {
    format: AUDIT_REVALIDATION_FORMAT,
    sourceDigest: proposal.sourceDigest,
    previousVerdictVersion:
      typeof stored.mentionVerdictVersion === "number"
        ? stored.mentionVerdictVersion
        : null,
    verdictVersion: MENTION_VERDICT_VERSION,
    revalidatedAt: (options.now ?? new Date()).toISOString(),
    rechecked: counts.rechecked + counts.rechecked_judge_failed,
    incompleteSourceText: counts.incomplete_source_text,
    judgeFailed,
    engineUnavailable: counts.engine_unavailable,
    recommendRemeasure: counts.incomplete_source_text + judgeFailed > 0,
  };
  const { verificationState: _dropped, ...rest } = stored;
  const next = withRecomputedAuditMetrics({
    ...rest,
    mentionVerdictVersion: MENTION_VERDICT_VERSION,
    engineResponses: nextRows,
    // 저장된 처방·시장 점수는 옛 판정으로 만든 것이다. 새 판정으로 다시
    //   만들 입력(질문별 통계·시장 판정)이 결과에 없으므로 비우고 표시한다.
    geoActions: [],
    topRecommendations: [],
    regions: undefined,
    regionScoresOutdated: true,
    actionsOutdated: true,
    revalidation: { ...summary, original: stored },
  });
  return { status: "ready", result: next, summary };
}
