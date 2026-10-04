// audit → Tracking dual-write 헬퍼 (20번, 설계문서 §3 본체 B)
//
// 역할: audit runner가 만든 엔진 응답(EngineResponse[])을 정규화해 Brand/Prompt/Tracking에
//   적재한다. 기존 AuditJob.result(Json) write는 그대로 두고, 로그인 org audit에 한해
//   여기에 "이중으로" 쓴다(dual-write). 대시보드 읽기 전환(2단계) 전까지는 축적만.
//
// 위치 근거: EngineResponse(=@repo/ai) + database(=@repo/database)를 동시에 쓴다.
//   @repo/database는 @repo/ai를 의존하지 않으므로(순환 회피) 이 헬퍼는 두 패키지를 모두
//   의존하는 apps/web에 둔다. runner.ts 바로 옆.
//
// 설계 보강(적대적 검증에서 살아남지 못한 4지점 흡수):
//   보강1(fk 치명): write 직전 organization.findUnique로 부모 Org 실재 확인. 없으면 skip.
//     ⚠️ relationMode="prisma"는 스칼라 FK create를 막지 않아 "고아 row 조용한 성공생성"이
//        일어난다 → "실패를 잡는다"가 아니라 "선확인 후 진행"만 유효.
//   보강2(live 치명): prompt.upsert(where: brandId_text). Prompt @@unique([brandId,text]) 전제.
//   보강3(전 렌즈): 전체를 $transaction으로 원자화 → "Brand만 있고 Tracking 0인 유령 브랜드" 차단.
//   보강4(전 렌즈): DB 실재 engineId 집합으로 필터(코드 상수 아님) → 고아 engineId 삽입 차단.
//   D5(확정): 실패/stub 엔진행은 Tracking에 넣지 않음(진짜 0언급과 인프라 실패 혼동 방지).

import { costOf, type EngineResponse } from "@repo/ai/lib/engines";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { isTrackableResponse } from "./tracking-eligibility";

// Postgres stores text as UTF-8: a lone UTF-16 surrogate (e.g. an emoji cut in
// half by a provider) comes back as U+FFFD, and NUL is rejected outright. Store
// the value the database will actually keep, so a row always reads back equal
// to what was written (2026-10-05: the replay guard treated that drift as a
// payload conflict and rolled back the whole Tracking write).
const LONE_SURROGATE_RE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function toStorableText(value: string): string {
  return value.replace(LONE_SURROGATE_RE, "\uFFFD").replaceAll("\u0000", "");
}

const REPLAY_COMPARED_FIELDS = [
  "rawResponse",
  "engineId",
  "promptId",
  "shareOfVoice",
  "inputTokens",
  "outputTokens",
  "costKrw",
  "costBasis",
  "brandId",
] as const;

function sameStoredValue(a: unknown, b: unknown): boolean {
  const left = a ?? null;
  const right = b ?? null;
  return left === right || (Number.isNaN(left) && Number.isNaN(right));
}

/** Field names (never values) that differ between a replay and the first write. */
export function replayPayloadMismatch(
  written: Record<(typeof REPLAY_COMPARED_FIELDS)[number], unknown> & {
    trackedAt: Date;
  },
  stored: Record<(typeof REPLAY_COMPARED_FIELDS)[number], unknown> & {
    trackedAt: Date;
  }
): string[] {
  const fields: string[] = REPLAY_COMPARED_FIELDS.filter(
    (field) => !sameStoredValue(written[field], stored[field])
  );
  if (written.trackedAt.getTime() !== stored.trackedAt.getTime()) {
    fields.push("trackedAt");
  }
  return fields;
}

type ReplayComparable = Record<
  (typeof REPLAY_COMPARED_FIELDS)[number],
  unknown
> & {
  trackedAt: Date;
};

async function findExistingRowKeys(
  tx: {
    tracking: {
      findMany(args: {
        where: { trackingRowKey: { in: string[] } };
        select: { trackingRowKey: true };
      }): Promise<{ trackingRowKey: string | null }[]>;
    };
  },
  candidateKeys: (string | null)[]
): Promise<Set<string | null>> {
  const keys = candidateKeys.filter(
    (key): key is string => typeof key === "string"
  );
  if (keys.length === 0) {
    return new Set();
  }
  const rows = await tx.tracking.findMany({
    where: { trackingRowKey: { in: keys } },
    select: { trackingRowKey: true },
  });
  return new Set(rows.map((row) => row.trackingRowKey));
}

function assertReplaysMatchFirstWrite(
  stored: (ReplayComparable & {
    engineId: string;
    trackingRowKey: string | null;
  })[],
  written: Map<string, ReplayComparable>,
  preexistingKeys: Set<string | null>
): void {
  for (const row of stored) {
    if (!preexistingKeys.has(row.trackingRowKey)) {
      continue;
    }
    const first = written.get(row.trackingRowKey as string);
    const mismatched = first ? replayPayloadMismatch(first, row) : [];
    if (mismatched.length > 0) {
      log.warn("audit.tracking.idempotency_conflict", {
        trackingRowKey: row.trackingRowKey,
        engineId: row.engineId,
        fields: mismatched,
      });
      throw new Error(
        `Tracking idempotency payload conflict for ${row.trackingRowKey}`
      );
    }
  }
}

/** runner가 flat 이전에 각 응답에 태깅해 넘겨주는 항목. promptText로 promptId를 잇는다. */
export interface TaggedEngineResponse extends EngineResponse {
  /** Stable prompt ordinal within the audit axis. */
  promptIndex?: number;
  /**
   * 브랜드 이름 질문인지, 이름 없는 질문(discovery)인지(2026-09-29).
   * 러너는 discovery 행을 이 함수에 넘기지 않는다(시계열 분모 보호).
   */
  promptKind?: "brand" | "discovery";
  /** 프롬프트 언어(Prompt.language NOT NULL, enum ko|en — both 없음). */
  promptLang: "ko" | "en";
  /** 이 응답을 만든 프롬프트 원문. flat() 후 소실되므로 runner가 태깅해 보존. */
  promptText: string;
}

/** The runner's core path uses the same stable prompt ordinal as the key writer. */
export function tagCoreResponses(
  responsesByPrompt: EngineResponse[][],
  prompts: Array<{
    text: string;
    lang: "ko" | "en";
    kind?: "brand" | "discovery";
  }>
): TaggedEngineResponse[] {
  return responsesByPrompt.flatMap((responses, promptIndex) =>
    responses.map((response) => ({
      ...response,
      promptIndex,
      promptText: prompts[promptIndex]?.text ?? "",
      promptLang: prompts[promptIndex]?.lang ?? "ko",
      promptKind: prompts[promptIndex]?.kind ?? "brand",
    }))
  );
}

export interface PersistAuditTrackingInput {
  /** Stable AuditJob identity. Required for exactly-once dual-write. */
  auditJobId?: string;
  brandId: string;
  /** AuditJob 완료 시각. Tracking.trackedAt에 동일 적용(시계열 정합). */
  completedAt: Date;
  organizationId: string;
  /**
   * 새로 심는 Prompt 의 축. **기본 `true`**(= 고객이 고른 추적 대상, 기존 동작 보존).
   *
   * 🔴 **`false` 를 넘겨야 하는 경우**: 고객이 고르지 않은 **시스템 기본 질의**를 심을 때.
   *   이 플래그는 마법사의 **요금제 상한 계산**에 그대로 쓰인다
   *   (`suggest-prompts.ts:138` — `count({ isAutoGenerated: true })` vs free 5/starter 30/growth 150).
   *   시스템 질의를 `true` 로 심으면 **고객이 모르는 사이 할당량을 잃고**
   *   마법사가 *"상한 도달, 요금제를 올리세요"* 라고 **거짓 안내**한다(N-36 이 막은 사고).
   *
   *   예) 네이버 AI 브리핑은 고객 프롬프트가 아니라 자체 질의
   *       (`{브랜드} 효과·후기·장단점`)를 던진다 → **반드시 `false`**.
   */
  promptIsAutoGenerated?: boolean;
  /** flat 이전에 promptText/promptLang로 태깅된 전체 엔진 응답. */
  tagged: TaggedEngineResponse[];
  /** Distinguishes core prompt rows from the separate briefing axis. */
  trackingAxis?: "core" | "briefing";
  /** Reconciler lease token; absent only for the first pending writer. */
  trackingClaimToken?: string;
}

/**
 * audit 엔진 응답을 Tracking으로 적재. best-effort: 실패해도 throw하지 않는다
 *   (audit status는 이미 completed라 무영향). 단 내부는 $transaction으로 원자적.
 */
export async function persistAuditTracking(
  input: PersistAuditTrackingInput
): Promise<"completed" | "failed"> {
  const {
    organizationId,
    brandId,
    tagged,
    completedAt,
    // 기본 true = 기존 호출부(runner.ts) 동작 완전 보존.
    promptIsAutoGenerated = true,
    auditJobId,
    trackingClaimToken,
    trackingAxis = "core",
  } = input;

  try {
    // 보강1: 부모 Org 실재 확인. 없으면(웹훅 미도달 등) write 전체 skip.
    const org = await database.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      log.error("audit.tracking.org_missing", { organizationId, brandId });
      return "failed";
    }

    // 보강4: DB에 실재하는 Engine id 집합. Tracking.engineId는 Engine FK(Restrict)라
    //   seed가 없는 성공 응답은 부분 저장하지 않고 전체 write를 재시도한다.
    const engines = await database.engine.findMany({ select: { id: true } });
    const validEngineIds = new Set(engines.map((e) => e.id));

    // A missing Engine seed is not permission to mark a subset complete.
    // First establish the full eligible set from the captured responses,
    // then require every one of those engines to exist before any write.
    const snapshotEngineIds = new Set(tagged.map((row) => row.engineId));
    const usable = tagged.filter((row) =>
      isTrackableResponse(row, snapshotEngineIds)
    );
    if (usable.length === 0) {
      log.warn("audit.tracking.no_usable_rows", {
        organizationId,
        brandId,
        totalTagged: tagged.length,
      });
      return "failed";
    }
    if (usable.some((row) => !validEngineIds.has(row.engineId))) {
      log.warn("audit.tracking.engine_seed_missing", {
        auditJobId,
        trackingAxis,
      });
      return "failed";
    }
    // The bounded SQL proof in stale-claim retirement accepts at most 100 keys.
    // Never commit a manifest that the recovery path cannot verify.
    if (auditJobId && usable.length > 100) {
      log.warn("audit.tracking.manifest_too_large", {
        auditJobId,
        trackingAxis,
      });
      return "failed";
    }

    // 적재 대상 프롬프트(중복 제거: 같은 text가 여러 엔진에 걸쳐 반복됨).
    const promptByText = new Map<string, { text: string; lang: "ko" | "en" }>();
    for (const r of usable) {
      if (!promptByText.has(r.promptText)) {
        promptByText.set(r.promptText, {
          text: r.promptText,
          lang: r.promptLang,
        });
      }
    }

    // 보강3: Prompt upsert + Tracking create를 하나의 트랜잭션으로.
    //   부분 실패 시 전부 롤백 → 유령 브랜드/고아 프롬프트 방지.
    await database.$transaction(async (tx) => {
      // 보강2: prompt.upsert(where: brandId_text). 재실행 시 같은 promptId 재사용 → 시계열 안정.
      const textToPromptId = new Map<string, string>();
      for (const p of promptByText.values()) {
        const prompt = await tx.prompt.upsert({
          where: { brandId_text: { brandId, text: p.text } },
          create: {
            brandId,
            text: p.text,
            language: p.lang,
            // 🔴 축을 호출부가 정한다 — 시스템 질의(브리핑)는 false 로 와야 한다.
            //   여기 `true` 를 하드코딩하면 무료 고객 할당량을 조용히 잠식한다(입력 타입 주석 참조).
            isAutoGenerated: promptIsAutoGenerated,
          },
          update: {}, // 이미 있으면 그대로(텍스트·언어 불변).
          select: { id: true },
        });
        textToPromptId.set(p.text, prompt.id);
      }

      // Tracking createMany. EngineResponse → Tracking 컬럼 무손실 매핑.
      const rows = usable.map((r) => {
        // 🔴 **원가를 여기서 굳힌다**(세션N-47). `costOf` 는 이미 있었는데
        //   **프로덕션 호출이 0곳**이었다(📕 N-46 "함수는 있는데 안 쓰고 있다").
        //   토큰 수를 안 남기면 나중에 되돌아와 계산할 방법이 없다 —
        //   단가가 바뀌어도 `inputTokens`·`outputTokens` 만 있으면 재계산은 가능하다.
        //   그래서 **산출값(costKrw)과 원재료(토큰)를 같이** 저장한다.
        const cost = costOf(r);
        return {
          brandId,
          promptId: textToPromptId.get(r.promptText) as string,
          engineId: r.engineId,
          // D6[확인필요]: 지금은 full 저장(AuditJob excerpt는 1500자 절단). 용량 실측 후 절단 검토.
          rawResponse:
            typeof r.rawResponse === "string"
              ? toStorableText(r.rawResponse)
              : r.rawResponse,
          brandMentioned: r.brandMentioned,
          mentionPosition: r.mentionPosition,
          // 순위의 분모(세션N-10). 신규 측정부터 채워진다(기존 행은 null).
          mentionListSize: r.mentionListSize,
          sentiment: r.sentiment,
          citedSources: r.citedSources as never,
          shareOfVoice: r.shareOfVoice,
          errorMessage: null,
          trackedAt: completedAt,
          // ⚠️ usage 가 없는 엔진(검색 스크랩 등)은 null 로 남는다 — 0 이 아니다.
          //   집계에서 null 을 0원으로 세면 "공짜로 돌고 있다"는 착각을 만든다.
          inputTokens: r.usage?.inputTokens ?? null,
          outputTokens: r.usage?.outputTokens ?? null,
          costKrw: cost.krw,
          costBasis: cost.basis,
          trackingRowKey:
            auditJobId && r.promptIndex !== undefined
              ? `${auditJobId}|${trackingAxis}|${r.promptIndex}|${r.engineId}`
              : null,
        };
      });
      // Only keys that already existed are replays; rows inserted by this
      // createMany are compared against themselves and can never conflict.
      const preexistingKeys = await findExistingRowKeys(
        tx,
        rows.map((row) => row.trackingRowKey)
      );
      await tx.tracking.createMany({ data: rows, skipDuplicates: true });

      // A duplicate key is an idempotent replay only if its immutable payload
      // agrees with the first writer. Never overwrite first-write evidence;
      // surface a conflict for reconciliation instead.
      const keyedRows = rows.filter(
        (row): row is typeof row & { trackingRowKey: string } =>
          typeof row.trackingRowKey === "string"
      );
      if (
        auditJobId &&
        (keyedRows.length !== rows.length ||
          new Set(keyedRows.map((row) => row.trackingRowKey)).size !==
            rows.length)
      ) {
        throw new Error("Tracking manifest requires distinct row keys");
      }
      if (keyedRows.length > 0) {
        const existing = await tx.tracking.findMany({
          where: {
            trackingRowKey: { in: keyedRows.map((row) => row.trackingRowKey) },
          },
          select: {
            trackingRowKey: true,
            rawResponse: true,
            engineId: true,
            promptId: true,
            shareOfVoice: true,
            inputTokens: true,
            outputTokens: true,
            costKrw: true,
            costBasis: true,
            brandId: true,
            trackedAt: true,
          },
        });
        if (existing.length !== keyedRows.length) {
          throw new Error("Tracking row-key set is incomplete after write");
        }
        const expected = new Map(
          keyedRows.map((row) => [row.trackingRowKey, row])
        );
        assertReplaysMatchFirstWrite(existing, expected, preexistingKeys);
      }
      if (auditJobId) {
        const stageKey =
          trackingAxis === "core" ? "tracking" : "briefingTracking";
        const manifestKey = `${stageKey}Manifest`;
        const tokenKey = `${stageKey}ReconcileToken`;
        const manifest = {
          v: 1,
          brandId,
          trackedAt: completedAt.toISOString(),
          keys: keyedRows.map((row) => row.trackingRowKey).sort(),
        };
        const recorded = await tx.$executeRawUnsafe(
          `UPDATE "AuditJob"
           SET "postprocessing" = jsonb_set(
             COALESCE("postprocessing", '{}'::jsonb),
             ARRAY[$2::text], $3::jsonb, true)
           WHERE "id" = $1 AND "status" = 'completed'
             AND ("postprocessing"->>$2 IS NULL OR "postprocessing"->$2 = $3::jsonb)
             AND (
               ($5::text IS NULL AND "postprocessing"->>$4 = 'pending')
               OR ($5::text IS NOT NULL
                   AND "postprocessing"->>$4 = 'reconciling'
                   AND "postprocessing"->>$6 = $5::text)
               OR ("postprocessing"->>$4 = 'completed'
                   AND "postprocessing"->$2 = $3::jsonb)
             )`,
          auditJobId,
          manifestKey,
          JSON.stringify(manifest),
          stageKey,
          trackingClaimToken ?? null,
          tokenKey
        );
        if (recorded !== 1) {
          throw new Error("Tracking manifest claim was lost");
        }
      }
    });

    log.info("audit.tracking.persisted", {
      organizationId,
      brandId,
      prompts: promptByText.size,
      trackingRows: usable.length,
    });
    return "completed";
  } catch (error) {
    // best-effort: audit은 이미 completed. Tracking 실패가 사용자 결과를 깨지 않게 log만.
    log.error("audit.tracking.failed", {
      organizationId,
      brandId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}
