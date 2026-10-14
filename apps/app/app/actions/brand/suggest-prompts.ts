"use server";

import {
  lookupStaticBrandName,
  resolveBrandIdentity,
} from "@repo/ai/lib/brand-identity";
import {
  normalizeTopic,
  type PromptSuggestions,
  type SuggestedPrompt,
  staticFallback,
  suggestTrackingPrompts,
} from "@repo/ai/lib/prompt-suggestions";
import { parseKnownCompetitors } from "@repo/audit/competitor-extract";
import { isVercelPreview } from "@repo/audit/preview-guard";
import {
  activePromptFilter,
  archivedPromptIds,
} from "@repo/audit/prompt-archive";
import { readSiteProfile } from "@repo/audit/site-profile";
import { planCapabilities } from "@repo/auth/plan";
import { getCurrentPlan } from "@repo/auth/plan-server";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { remainingPromptSlots } from "@/lib/brand/prompt-slots";
import { recordQuestionChange } from "@/lib/brand/question-change-log";
import { cleanSiteNote } from "@/lib/brand/site-note";
import { requireOrg, scopedBrandById } from "@/lib/db/scoped";
import { getAppDictionary } from "@/lib/i18n";

/** 오류 문구 — 사전 `app.brandErrors`(요청 밖이면 기본 로케일 ko). */
const brandErrors = async () => (await getAppDictionary()).brandErrors;

/**
 * 프롬프트 자동 제안 마법사 서버 액션 (표준 백로그 1, 2026-07-30).
 *
 * 두 동작:
 *   1) suggestPromptsAction — AI가 추적 질문·경쟁사 후보를 생성(추가 LLM 호출 1). 저장 안 함.
 *   2) saveApprovedPromptsAction — 사용자가 승인한 프롬프트만 Prompt 테이블에 upsert(org 스코프).
 *
 * 🔒 보안(start-tracking.ts와 동일 불변식):
 *   - orgId: 세션에서 requireOrg()로 서버 재도출.
 *   - brandId: scopedBrandById로 "현재 org 소속"인지 검증 후에만 write(남의 org 브랜드 차단).
 *   - 저장 프롬프트는 감사 대상 텍스트만 받는다.
 *
 * 측정 반영: 저장된 프롬프트는 러너가 우선 사용(runner.ts). 없으면 기존 고정 4개 폴백 —
 *   원가·429 회귀 위험 없이 "승인분만 저장" 최소 연결(전략 결정 2026-07-30).
 */

export type SuggestPromptsResult =
  | {
      ok: true;
      /** 플랜 상한까지 더 담을 수 있는 개수(저장된 질문을 뺀 값). [추천 구성으로 담기]가 쓴다. */
      remaining: number;
      /** 사이트에서 읽은 글자가 거의 없어 질문이 일반적일 수 있다 — 화면이 "한 줄 소개" 입력을 보인다. */
      siteThin?: boolean;
      suggestions: PromptSuggestions;
    }
  | { error: string };

export const suggestPromptsAction = async (input: {
  brandId: string;
  /** 사이트를 못 읽었을 때 고객이 직접 적은 한두 줄 소개(저장하지 않는다). */
  siteNote?: string;
}): Promise<SuggestPromptsResult> => {
  try {
    await requireOrg();
  } catch {
    return { error: (await brandErrors()).signInOrg };
  }

  const brand = await scopedBrandById(input.brandId);
  if (!brand) {
    return { error: (await brandErrors()).brandNotFound };
  }

  const remaining = await remainingPromptSlots(brand.id);
  const industry = brand.industry ?? null;
  const aliases = stringList(brand.entityVariants);
  const competitors = parseKnownCompetitors(brand.competitors).map(
    (c) => c.name
  );
  const marketScope = brand.marketScope ?? null;

  // Vercel Preview: no LLM call (brand identity + suggestion are both paid).
  //   Deterministic static suggestions so the wizard still renders end to end.
  if (isVercelPreview()) {
    const brandName =
      lookupStaticBrandName(brand.domain) ?? (brand.name || brand.domain);
    return {
      ok: true,
      remaining,
      suggestions: staticFallback({
        brandName,
        domain: brand.domain,
        industry,
        marketScope,
      }),
    };
  }

  try {
    // 대표 브랜드명 해석(한글 우선). resolveBrandIdentity는 사전·LLM 폴백 내장.
    const identity = await resolveBrandIdentity(brand.domain, brand.name);
    // 재료: 업종·시장·공식 사이트 문구·별칭·경쟁사(2026-10-13). 브랜드명 단독 입력은 오분류 위험.
    //   사이트를 못 읽어도 제안은 만든다(대표 상품 질문만 비게 된다 — 지어내지 않는다).
    const readSite = await readSiteText(brand.domain);
    const note = cleanSiteNote(input.siteNote);
    // 고객이 적은 소개는 사이트 재료 앞에 붙인다(고객 본인의 말 — 대표 상품 질문의 근거로도 쓰인다).
    const site = note
      ? {
          ...(readSite ?? {}),
          bodySnippet: [note, readSite?.bodySnippet].filter(Boolean).join(" "),
          description: [note, readSite?.description].filter(Boolean).join(" "),
          thin: false,
        }
      : readSite;
    const suggestions = await suggestTrackingPrompts({
      aliases: [...new Set([...aliases, ...identity.brandVariants])],
      brandName: identity.brandName,
      competitors,
      domain: brand.domain,
      industry,
      marketScope,
      site,
    });
    return {
      ok: true,
      remaining,
      suggestions,
      ...(suggestions.siteThin ? { siteThin: true } : {}),
    };
  } catch (error) {
    log.error("brand.suggest_prompts.failed", {
      brandId: input.brandId,
      error: parseError(error),
    });
    return {
      error: (await brandErrors()).suggestFailed,
    };
  }
};

/**
 * 공식 사이트 재료(제목·설명·H1 + 소제목·FAQ·구조화 데이터·본문 첫머리). 실패·시간 초과면 null — 제안을 막지 않는다.
 * 판정 앵커용 `resolveOfficialSiteIdentity` 와 따로 읽는다(판정 코드는 그대로).
 */
async function readSiteText(domain: string) {
  return await readSiteProfile(domain);
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

export type SaveApprovedResult =
  // capped: 플랜 상한 때문에 선택분 중 일부만 저장됐을 때 true(업그레이드 안내용).
  //   requested = 사용자가 실제 저장 시도한(정제 후) 개수, limit = 현재 플랜 상한.
  | {
      ok: true;
      saved: number;
      capped?: boolean;
      requested?: number;
      limit?: number;
    }
  // `code` 는 화면이 분기할 때 쓴다 — 문구(언어마다 다름)에서 단어를 찾지 않는다.
  | { error: string; code?: "prompt_limit"; limit?: number };

// 🔴 N-42: `CATEGORY_MAP`(brand→recommendation · competitor→comparison)을 **없앴다**.
//   모든 질문이 이 표를 거치며 `recommendation`·`comparison` **2종으로 뭉개져서**
//   enum 7종 중 5종은 저장 경로가 아예 없었다(`best_in_category` 같은 GEO 핵심 유형이
//   한 번도 안 잡혔다). 이제 질문마다 LLM 이 판단한 `topic` 을 `normalizeTopic` 으로
//   좁혀 저장한다 — 폴백 기본값은 그 함수 안에 한 벌만 둔다(표를 두 곳에 두지 않는다).

export const saveApprovedPromptsAction = async (input: {
  brandId: string;
  prompts: SuggestedPrompt[];
}): Promise<SaveApprovedResult> => {
  try {
    await requireOrg();
  } catch {
    return { error: (await brandErrors()).signInOrg };
  }

  const brand = await scopedBrandById(input.brandId);
  if (!brand) {
    return { error: (await brandErrors()).brandNotFound };
  }

  // 저장 상한 = 플랜 능력치(게이팅 단일 진실). free 5·starter 30·growth 150…
  //   업계 화폐가 "추적 프롬프트 수"라 여기서 강제한다. 서버 판정(우회 불가).
  const plan = await getCurrentPlan();
  const promptLimit = planCapabilities(plan).promptLimit;

  // 입력 정제: 텍스트·언어 유효성 + 중복 제거.
  const seen = new Set<string>();
  const clean = input.prompts
    .map((p) => ({
      text: p.text.trim(),
      language: p.language,
      category: p.category,
      // 🔴 이 줄이 없으면 유형이 여기서 조용히 증발한다(N-42 이전 동작).
      topic: p.topic,
    }))
    .filter((p) => {
      const key = p.text.toLowerCase();
      const valid =
        p.text.length >= 3 &&
        p.text.length <= 200 &&
        (p.language === "ko" || p.language === "en") &&
        !seen.has(key);
      if (valid) {
        seen.add(key);
      }
      return valid;
    });

  if (clean.length === 0) {
    return { error: (await brandErrors()).selectAtLeastOne };
  }

  try {
    // 🔴 한도 검사와 저장을 **한 트랜잭션 + 브랜드별 어드바이저리 락**으로 묶는다(2026-10-14).
    //   예전엔 count 후 createMany 라서, 같은 순간 두 요청(온보딩 두 탭·마법사 더블클릭)이 둘 다 남은 칸이
    //   있다고 보고 플랜 상한을 넘겨 저장할 수 있었다. 락은 트랜잭션이 끝나면 자동으로 풀린다.
    //   트랜잭션 안은 3문장(락·count·createMany)뿐이라 5초 제한에 걸리지 않게 제한도 명시한다
    //   (2026-10-13 운영 장애 교훈: 질문별 upsert N번은 5초를 넘겼다).
    // 저장은 **한 번의 createMany**(단일 SQL) + `skipDuplicates` = 예전 upsert(`update: {}`)와 같은 뜻:
    //   이미 있는 (brandId, text)는 그대로 둔다(promptId 안정 — 시계열 선 분열 방지).
    const archived = await archivedPromptIds([brand.id]);
    const outcome = await database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prompt-limit:${brand.id}`}))`;
        // 이미 저장된 auto 프롬프트 + 이번 저장분이 플랜 상한을 넘으면 상한까지만(누적 기준).
        const existingCount = await tx.prompt.count({
          where: {
            brandId: brand.id,
            isAutoGenerated: true,
            ...activePromptFilter(archived),
          },
        });
        const remaining = Math.max(0, promptLimit - existingCount);
        if (remaining === 0) {
          return { kind: "full" } as const;
        }
        const capped = clean.slice(0, remaining);
        await tx.prompt.createMany({
          data: capped.map((p) => ({
            brandId: brand.id,
            text: p.text,
            language: p.language,
            // LLM 이 판단한 유형을 쓴다. `normalizeTopic` 은 **항상 유효 enum 을 돌려준다**
            //   — 모르는 값·빈 값이면 균형축 기준 기본값으로 떨어진다. 신뢰 경계가 서버이므로
            //   클라이언트 값을 그대로 믿지 않고 여기서 좁힌다.
            category: normalizeTopic(p.topic, p.category),
            isAutoGenerated: true,
          })),
          skipDuplicates: true,
        });
        return { kind: "saved", capped } as const;
      },
      { maxWait: 5000, timeout: 10_000 }
    );
    if (outcome.kind === "full") {
      return {
        error: (await brandErrors()).promptLimit.replace(
          "{limit}",
          String(promptLimit)
        ),
        code: "prompt_limit",
        limit: promptLimit,
      };
    }
    const { capped } = outcome;

    log.info("brand.prompts.saved", {
      brandId: brand.id,
      count: capped.length,
    });
    await recordQuestionChange(brand.id, {
      kind: "added",
      count: capped.length,
    });
    // 상한에 걸려 일부만 저장된 경우 신호(UI가 업그레이드 안내). 전부 저장이면 생략.
    const wasCapped = capped.length < clean.length;
    return {
      ok: true,
      saved: capped.length,
      ...(wasCapped
        ? { capped: true, requested: clean.length, limit: promptLimit }
        : {}),
    };
  } catch (error) {
    log.error("brand.save_prompts.failed", {
      brandId: input.brandId,
      error: parseError(error),
    });
    return { error: (await brandErrors()).promptSaveFailed };
  }
};
