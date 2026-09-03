// 무료 Audit 잡 러너
//
// PRD §5.1 [F1] 무료 도메인 Audit — 콜드 영업 핵심 무기.
// 이메일 + 도메인 입력 → 30초~3분 내 PDF 다운로드.
//
// v1.0 구현:
//   - Vercel Functions의 after()로 응답 후 백그라운드 처리 (Vercel Queues는 v1.5)
//   - 7 엔진 (chatgpt-web 제외, 첫 베타는 안정적인 API만) 병렬 호출
//   - 30초 빠른 모드 (1페이지 PDF). 풀 모드 (10분, CrewAI 4 에이전트) 는 v1.0.5
//   - 결과 → AuditJob.result + pdfUrl 업데이트
//
// PDF 생성은 v1.0에서 일단 JSON 결과만 보여주고 PDF는 Day 4에 @vercel/og + Puppeteer.

import { resolveBrandIdentity } from "@repo/ai/lib/brand-identity";
import {
  aggregateAudit,
  auditCost,
  queryAllEngines,
} from "@repo/ai/lib/engines";
import { verifyMentions } from "@repo/ai/lib/mention-verdict";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import {
  actionsToStrings,
  buildGeoActions,
  conjunctionParticle,
  topicParticle,
} from "./actions";
import { runBriefingForAuditJob } from "./briefing-runner";
import {
  type KnownCompetitor,
  parseKnownCompetitors,
} from "./competitor-extract";
import { geoAxisScores } from "./geo-score";
import { keys } from "./keys";
import {
  filterByLanguageRegion,
  inferMarketScope,
  type MarketRegion,
  type MarketScope,
  REGION_LABEL,
} from "./market-scope";
import {
  countMeasurementCoverage,
  isMeasurementFailure,
} from "./measurement-coverage";
import { generateAuditPdf } from "./pdf-generator";
import type { AuditPdfData } from "./pdf-template";
import { resolveOfficialSiteIdentity } from "./official-site-identity";
import { pickRotatingPrompts } from "./prompt-rotation";
import { queryPromptsSequentially } from "./prompt-query-scheduler";
import { persistAuditTracking, type TaggedEngineResponse } from "./tracking";

export interface AuditRunInput {
  brandId?: string;
  brandName?: string;
  brandVariants?: string[];
  domain: string;
  /**
   * 업종(AuditJob.industry). 언급 품질 검증에서 동명이인 분별 단서로 쓴다
   * ("기아"가 자동차인지 야구단인지). 없어도 동작하며, 있으면 판정 정확도가 올라간다.
   */
  industry?: string;
  jobId: string;
  language: "ko" | "en" | "both";
  /**
   * 고객이 앱에서 명시한 타깃 시장(Brand.marketScope). 없으면 자동 추정.
   * 점수의 분모를 정한다 — 국내 전용이면 글로벌 엔진이 빠져 "글로벌 0점"이 안 나온다.
   */
  marketScope?: MarketScope;
  // 20번(dual-write): 로그인 org audit만 채워진다. 비로그인 무료 audit은 undefined
  //   → Tracking 적재 skip(D1: 무료는 AuditJob email 스코프 유지).
  organizationId?: string;
}

// 도메인→브랜드명(한/영 변형) 해석은 @repo/ai/lib/brand-identity의
// resolveBrandIdentity로 이관 (P0-b, 2026-07-27). 폼입력→사전→LLM→영문 폴백 체인.

/**
 * 도메인 + 언어 기반 자동 프롬프트 생성 — 무료 Audit 빠른 모드용 6개.
 * v1.0.5 풀 모드는 30~50개로 확장.
 */
function generateAuditPrompts(
  brandName: string,
  language: "ko" | "en" | "both"
): Array<{ text: string; lang: "ko" | "en" }> {
  // 프롬프트는 두 유형을 균형 있게 섞는다 (P0-a, 2026-07-27):
  //   - 브랜드형: 브랜드 자체를 물어 "AI가 이 브랜드를 아는가/제대로 서술하는가"
  //     (노출·팩트정합·감성) 측정. ⚠️ 이게 없으면 판정(문자열 매칭)이 구조적으로
  //     미언급을 유발함 (경쟁사 나열 답변엔 본인이 잘 안 담김).
  //   - 경쟁사형: 경쟁 대비 순위·SoV 측정 (estimateMentionPosition·경쟁벤치가 의존).
  // 각 배열은 [브랜드형, 브랜드형, 경쟁사형, 경쟁사형] 순 — both 모드가 slice로
  // 앞 2개(브랜드형)+뒤로 경쟁사형을 뽑아도 유형이 섞이도록 배치.
  const ko = [
    `${brandName}${topicParticle(brandName)} 어떤 브랜드이고 어떤 서비스를 제공해?`,
    `${brandName}의 주요 강점과 한계는?`,
    `${brandName}${conjunctionParticle(brandName)} 비슷한 서비스를 제공하는 브랜드 5곳 추천해줘`,
    `${brandName}의 주요 경쟁사를 비교해줘`,
  ];
  // ⚠️ 2026-08-02 F7 — 한/영 프롬프트를 **의미 등가**로 맞춘다.
  //   기존 en[0] = "What is X? Is it worth buying?" 는 ko[0] "X 추천해줘" 와 질문이 달랐다:
  //     ko[0] = X 를 **전제**하고 추천 요청 → 언급 판정에 유리
  //     en[0] = X 가 뭔지 묻는 **개방형** → 모르면 "I'm not familiar with..." → unknown_brand 판정
  //   그리고 both 모드가 뽑는 게 정확히 [ko[0], ko[2], en[0], en[2]] 라 이 비대칭이
  //   그대로 점수에 들어갔다. 즉 한/영 언급률 차이의 일부가 **시장 격차가 아니라 프롬프트 설계 차이**였다.
  //   추가로 "Is it worth buying?" 는 구매 가능한 소비재를 전제해 B2B·병원·반도체엔 무의미하고,
  //   부정 톤 답변이 감성 점수를 왜곡할 수 있었다(업종 편향과 같은 뿌리).
  const en = [
    `What does ${brandName} offer, and who is it for?`,
    `What are the main strengths and limitations of ${brandName}?`,
    `Top alternatives to ${brandName} and how they differ`,
    `Compare the main competitors of ${brandName}`,
  ];

  if (language === "ko") {
    return ko.map((text) => ({ text, lang: "ko" as const }));
  }
  if (language === "en") {
    return en.map((text) => ({ text, lang: "en" as const }));
  }
  // both 모드: 각 언어에서 브랜드형 1 + 경쟁사형 1 → 총 브랜드형 2 + 경쟁사형 2.
  // ko[0]=브랜드형, ko[2]=경쟁사형 / en[0]=브랜드형, en[2]=경쟁사형.
  return [
    { text: ko[0] as string, lang: "ko" as const },
    { text: ko[2] as string, lang: "ko" as const },
    { text: en[0] as string, lang: "en" as const },
    { text: en[2] as string, lang: "en" as const },
  ];
}

// 러너가 한 번에 던지는 프롬프트 상한 — 마법사가 150개를 저장해도 러너는 실행마다
//   상한까지만 측정한다(엔진 ≤7 × 프롬프트 = 호출 수 → 원가·레이턴시·429 보호).
//   저장 상한(요금제별 5/30/150)보다 클 수 있으므로 매 실행마다 `pickRotatingPrompts`가
//   다른 8개를 골라 여러 번 실행되면 결국 전체가 돌아가며 측정된다.
//   export하는 이유: 화면(`/prompts`)이 "N개 중 몇 개가 매 실행에 측정되는지"를
//   정직하게 안내하려면 이 값이 필요하다(화면 문구가 실제 동작과 어긋나면 안 됨).
export const RUNNER_PROMPT_LIMIT = 8;

/**
 * 실행에 쓸 프롬프트 결정 — 마법사 저장분 우선, 없으면 고정 4개 폴백.
 *   brandId가 없으면(무료 email 진단) 조회 없이 즉시 폴백 → 기존 동작 완전 보존.
 *   조회 실패·빈 결과도 폴백(측정이 프롬프트 없음으로 죽지 않게).
 *
 * 🔴 2026-08-16: 폴백 프롬프트를 **DB에 심고 나서** 반환한다.
 *   [실측] 브랜드 8개 중 Prompt 0인 5개가 Tracking 도 정확히 0이었다
 *   (메디큐브·아누아·토니모리·이니스프리·애플 — org 측정 24회가 통째로 유실).
 *   원인: 폴백 프롬프트는 **메모리에만** 존재해 persistAuditTracking 의
 *   `prompt.upsert(brandId_text)` 가 이을 promptId 를 못 만든다 →
 *   Tracking 적재가 조용히 끝난다(best-effort 라 throw 도 안 함).
 *   그래서 "측정 성공 + 화면 정상 + 시계열만 증발" 이 3주간 아무에게도 안 보였다.
 *
 *   ⚠️ **`isAutoGenerated: false` 로 심는 것이 핵심이다.**
 *   그 플래그는 이미 「프롬프트 마법사」의 **요금제 상한 계산**에 쓰인다
 *   (`suggest-prompts.ts:138` — free 5 / starter 30 / growth 150).
 *   true 로 심으면 무료 고객이 측정 한 번에 할당량 4개를 **모르는 사이 잃고**
 *   마법사가 "상한 도달, 요금제를 올리세요" 라고 **거짓 안내**하게 된다.
 *   → 축을 분리한다: true = 고객이 고른 추적 대상 / false = 시스템 기본 질문.
 *   이 함수의 조회 조건(`isAutoGenerated: true`)도 그대로라 마법사 동작은 무변경.
 */
/**
 * 등록 경쟁사를 읽는다 — 없으면 빈 배열(무료 진단 경로는 조회조차 하지 않는다).
 *
 * ⛔ 실패해도 측정을 멈추지 않는다: 이 값은 **표기를 합치는 보조 정보**라,
 *   없으면 병합이 덜 될 뿐 측정 자체는 성립한다. 여기서 throw 하면
 *   경쟁사 조회 실패가 **측정 전체를 죽인다**(원가만 쓰고 결과 0).
 */
async function resolveRegisteredCompetitors(
  brandId: string | undefined
): Promise<KnownCompetitor[]> {
  if (!brandId) {
    return [];
  }
  try {
    const brand = await database.brand.findUnique({
      select: { competitors: true },
      where: { id: brandId },
    });
    // ⛔ 파서를 여기서 다시 짜지 않는다 — 앱 대시보드와 **같은 한 벌**을 쓴다.
    //   (`competitors` 는 `[{name,domain}]` 도 `["올리브영"]` 도 들어오는 Json)
    return parseKnownCompetitors(brand?.competitors);
  } catch {
    return [];
  }
}

async function resolveRunPrompts(
  brandId: string | undefined,
  brandName: string,
  language: "ko" | "en" | "both"
): Promise<Array<{ text: string; lang: "ko" | "en" }>> {
  if (!brandId) {
    return generateAuditPrompts(brandName, language);
  }
  try {
    const saved = await database.prompt.findMany({
      where: { brandId, isAutoGenerated: true },
      select: {
        id: true,
        text: true,
        language: true,
        trackings: {
          orderBy: { trackedAt: "desc" },
          take: 1,
          select: { trackedAt: true },
        },
      },
    });
    if (saved.length === 0) {
      return await persistFallbackPrompts(
        brandId,
        generateAuditPrompts(brandName, language)
      );
    }
    const withLastTracked = saved.map((p) => ({
      ...p,
      lastTrackedAt: p.trackings[0]?.trackedAt ?? null,
    }));
    const picked = pickRotatingPrompts(withLastTracked, RUNNER_PROMPT_LIMIT);
    return picked.map((p) => ({ text: p.text, lang: p.language }));
  } catch {
    return generateAuditPrompts(brandName, language);
  }
}

/**
 * 폴백 프롬프트를 Prompt 테이블에 심는다(Tracking 이 이을 promptId 확보).
 *   upsert(brandId_text) 라 재실행해도 같은 promptId 재사용 → 시계열 선이 안 갈라진다.
 *   실패해도 측정을 죽이지 않는다(원래 프롬프트를 그대로 반환) — Tracking 만 못 쌓일 뿐,
 *   이는 이 수정 이전의 동작과 같다(더 나빠지지 않는 구조).
 */
async function persistFallbackPrompts(
  brandId: string,
  fallback: Array<{ text: string; lang: "ko" | "en" }>
): Promise<Array<{ text: string; lang: "ko" | "en" }>> {
  try {
    await database.$transaction(async (tx) => {
      for (const p of fallback) {
        await tx.prompt.upsert({
          where: { brandId_text: { brandId, text: p.text } },
          create: {
            brandId,
            text: p.text,
            language: p.lang,
            // 🔴 false 고정 — 위 주석 참조(요금제 상한과 축이 다르다).
            isAutoGenerated: false,
          },
          update: {},
          select: { id: true },
        });
      }
    });
    log.info("audit.prompts.fallback_persisted", {
      brandId,
      count: fallback.length,
    });
  } catch (error) {
    // 심기 실패 = Tracking 만 비는 것. 측정 자체는 그대로 진행한다.
    log.warn("audit.prompts.fallback_persist_failed", {
      brandId,
      error: parseError(error),
    });
  }
  return fallback;
}

// 응답 원문 → 저장용 발췌. 한도 내 마지막 문장/줄 경계에서 자르고 말줄임을 붙인다.
// (결함감사 2026-07-30 §9 — 하드컷이 단어·마크다운 토큰을 반토막 내던 문제)
const EXCERPT_LIMIT = 4000;
const SENTENCE_BOUNDARY_RE = /[.!?。…]\s|\n/g;

function excerptOf(rawResponse: string): string {
  if (rawResponse.length <= EXCERPT_LIMIT) {
    return rawResponse;
  }
  const head = rawResponse.slice(0, EXCERPT_LIMIT);
  // 한도의 뒤쪽 절반에서 가장 늦은 문장/줄 경계를 찾는다(없으면 하드컷 유지).
  let cutAt = -1;
  for (const m of head.matchAll(SENTENCE_BOUNDARY_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end >= EXCERPT_LIMIT / 2) {
      cutAt = end;
    }
  }
  return `${head.slice(0, cutAt > 0 ? cutAt : EXCERPT_LIMIT).trimEnd()} …`;
}

type AggregatableResponse = Parameters<typeof aggregateAudit>[0][number] & {
  /** 이 응답이 어느 언어 질문에서 나왔는지 — 시장 분해의 축(2026-08-21). */
  promptLang: "ko" | "en";
};

/** 권역 하나의 점수 요약. result.regions 로 저장돼 UI·PDF 가 함께 쓴다. */
export interface RegionScore {
  /** 측정에 성공한 고유 엔진 수(그 권역 안에서). */
  enginesMeasured: number;
  /** 화면 표기용 시장 라벨 — 점수 옆에 **반드시** 붙인다. */
  label: string;
  /** 유효 응답 중 언급 비율(%). 점수보다 직관적이라 함께 보여준다. */
  mentionRate: number;
  region: MarketRegion;
  score: number;
}

/**
 * 시장(한국/글로벌)별 집계·채점 — **질의 언어**로 분해한다(2026-08-21 재설계).
 *
 * 기존 순수 함수를 언어 필터된 배열로 재호출한다 — 새 채점 로직 0.
 * 응답이 하나도 없는 시장은 **null 이 아니라 아예 항목을 만들지 않는다**:
 * "0점"과 "측정 안 함"은 다르게 읽히기 때문(0=실패, 부재=해당없음).
 *
 * ⚠️ 예전엔 `filterByRegion`(엔진 국적)을 썼다 — "국내 중심"에서 ChatGPT 가 빠지는
 *   버그의 원인이었다. `docs/_적용/시장축_언어재설계_2026-08-21.md` 참조.
 */
function buildRegionBreakdown(
  responses: AggregatableResponse[]
): RegionScore[] {
  const out: RegionScore[] = [];

  for (const region of ["korea", "global"] as const) {
    const rows = filterByLanguageRegion(responses, region);
    const usable = rows.filter((r) => !(r.errorMessage || r.isStub));
    if (usable.length === 0) {
      continue;
    }
    const regionMetrics = aggregateAudit(rows);
    out.push({
      region,
      label: REGION_LABEL[region],
      score: geoAxisScores(regionMetrics).total,
      mentionRate: Math.round(
        (usable.filter((r) => r.brandMentioned).length / usable.length) * 100
      ),
      enginesMeasured: new Set(usable.map((r) => r.engineId)).size,
    });
  }

  return out;
}

/**
 * 메인 진입점. background에서 호출.
 */
export async function runAuditJob(input: AuditRunInput): Promise<void> {
  try {
    await database.auditJob.update({
      where: { id: input.jobId },
      data: { status: "processing" },
    });

    // 브랜드명 해석 (P0-b): 폼입력→정적사전→LLM→영문 폴백 체인으로 한/영 변형 확보.
    // 도메인만 입력돼도 한국어 답변의 "설화수"를 판정이 잡도록 variants에 한글명 포함.
    // 가입 단계의 저장 별칭과 도메인 기반 추론 별칭을 합친다. 전자만 쓰면 빈/불완전한
    // 저장값이 후자를 덮어쓰고, 후자만 쓰면 고객이 등록한 공식 영문·한글 표기를 잃는다.
    const identity = await resolveBrandIdentity(input.domain, input.brandName);
    const brandName = identity.brandName;
    const brandVariants = [
      ...new Set([...identity.brandVariants, ...(input.brandVariants ?? [])]),
    ];

    // 응답 생성 모델에는 주입하지 않는다(실제 AI 인지도를 재야 하므로). 대신 판정기가
    // 동명의 다른 대상을 확정 언급으로 세지 않도록 공식 홈페이지의 제목·설명·H1을
    // 한 번만 읽어 엔티티 기준 사실로 고정한다. 근거를 확보하지 못하면 AI 호출 전에
    // 중단한다. 수치는 없는 편이 다른 엔티티를 자사 언급으로 공개하는 것보다 정확하다.
    const officialSiteIdentity = await resolveOfficialSiteIdentity(
      input.domain
    );
    if (!officialSiteIdentity) {
      throw new Error(
        "공식 사이트에서 브랜드 식별 근거(title, description, H1)를 확인하지 못했습니다. 사이트 접근 설정을 확인한 뒤 다시 측정해 주세요."
      );
    }

    /**
     * 등록 경쟁사 — **표기 병합 사전**으로만 쓴다(👤 승인 ⓐ · N-44). 거르지 않는다.
     *
     * 왜 여기서 읽나(N-45 · 남은일 #9): 공개 리포트(`apps/web`)는 결과 JSON 만 받아
     * 그리므로, 러너가 결과에 실어주지 않으면 **닿을 방법이 없다**. 앱 대시보드는
     * `buildCompetitorAnalysis` 로 이미 병합하고 있어 **두 화면 숫자가 갈렸다**.
     *
     * ⚠️ 무료 진단은 `brandId` 가 없다 → 조회 없이 빈 배열(기존 동작 그대로 · 회귀 0).
     */
    const registeredCompetitors = await resolveRegisteredCompetitors(
      input.brandId
    );

    // 프롬프트 소스: 마법사가 저장한 프롬프트가 있으면 우선(백로그 1, 2026-07-30),
    //   없으면 기존 고정 4개 폴백. org 브랜드(brandId)일 때만 조회 — 무료 email 진단은
    //   brandId가 없어 항상 폴백(회귀 0). 원가·429 보호로 상한(RUNNER_PROMPT_LIMIT)까지만.
    const prompts = await resolveRunPrompts(
      input.brandId,
      brandName,
      input.language
    );

    // D-058 (2026-05-09) 분리 운영 구조:
    //   - 광고주 audit: 7 엔진 × 4 프롬프트 + AI 브리핑 1 프롬프트만 (베타)
    //     이유: AI 브리핑은 Browserbase 클라우드 크롬 사용 (느림 + 무료 티어 1동시)
    //     광고주 30초~3분 진단 약속 보호.
    //   - K-GEO-Bench 데이터셋: 별도 admin 스크립트로 4 프롬프트 모두 측정.

    const DEFAULT_7 = [
      "chatgpt",
      "claude",
      "perplexity",
      "gemini",
      "hyperclova",
      "naver",
      "daum",
    ] as const;

    // 영어 질의용 — 한국 검색엔진(naver·daum)과 한국어 전용 LLM(hyperclova)을 뺀다.
    const GLOBAL_4 = ["chatgpt", "claude", "perplexity", "gemini"] as const;

    // ⚠️ F5 수정(2026-08-03) — 프롬프트 언어에 맞는 엔진에만 보낸다.
    //   기존엔 언어와 무관하게 7 엔진 전부에 보내서, **영어 질문이 네이버·다음 검색창에
    //   그대로 들어갔다.** 실측(Tracking): daum 은 한국어 질문 71% 언급인데
    //   **영어 질문은 0%(0/2)** — 한국어 검색엔진에 영어를 넣으니 결과가 안 나온다.
    //   그 0% 가 "다음이 이 브랜드를 모른다"로 집계돼 점수를 깎고 있었다.
    //
    //   한국어 질문 → 7 엔진 전부(한국인은 ChatGPT 도 한국어로 쓴다).
    //   영어 질문   → 글로벌 4 엔진만(한국 검색엔진에 영어 질의는 무의미).
    const enginesForLang = (lang: "ko" | "en") =>
      lang === "en" ? GLOBAL_4 : DEFAULT_7;

    const sevenEngineResponses = await queryPromptsSequentially(
      prompts,
      async (p) =>
        queryAllEngines(
          {
            prompt: p.text,
            language: p.lang,
            brandName,
            brandVariants,
            // 🔴 N-47 — 자사 도메인을 엔진에 넘겨 **본문 URL 폴백에서 자사를 제외**한다.
            //   안 넘기면 AI 가 답변에 적은 자기 홈페이지가 「인용 출처」로 잡힌다.
            brandDomain: input.domain,
          },
          enginesForLang(p.lang) as unknown as Parameters<
            typeof queryAllEngines
          >[1]
        )
    );

    // 20번(dual-write): flat() 하면 각 응답이 어느 프롬프트에서 나왔는지 소실된다.
    //   Tracking은 promptId(=프롬프트별)로 정규화 저장하므로, flat 이전에 프롬프트 원문/언어를
    //   각 응답에 태깅해 둔다. sevenEngineResponses[i]는 prompts[i]에 1:1 대응.
    //   ⚠️ 태깅은 **검증 전 원본** 순서를 기준으로 만들고, 아래에서 검증 결과를 덮어쓴다
    //   (flat 과 tagged 가 같은 순서를 공유해야 Tracking 에도 교정된 판정이 들어간다).
    const tagged: TaggedEngineResponse[] = sevenEngineResponses.flatMap(
      (responses, i) => {
        const p = prompts[i];
        return responses.map((r) => ({
          ...r,
          promptText: p?.text ?? "",
          promptLang: p?.lang ?? "ko",
        }));
      }
    );

    // D-060 (2026-05-10) → D-2026-07-22 AI 브리핑 완전 분리 (on-demand 버튼):
    //   본류 audit는 항상 7 엔진만 호출한다. 30초~3분 진단 약속을 코드로 보장.
    //   네이버 AI 브리핑은 결과 페이지의 별도 버튼으로 on-demand 트리거된다
    //   (POST /api/audit/[jobId]/briefing → runBriefingForAuditJob).
    //   briefingStatus 기본값 "not_requested"로 초기화 → UI가 트리거 카드 표시.
    // 언급 품질 검증 (2026-07-31 세션K) — 집계 **전에** brandMentioned 를 교정한다.
    //   여기서 한 번 고치면 SoV·GEO 점수·Tracking 적재·결과 표시가 모두 같은 진실을 쓴다.
    //   실측 오판정 3종을 걸러낸다: 동명이인("푸에기아"→kia), 미인지(영어 단어 "forget" 뜻풀이),
    //   되물음("무슨 의미의 기아를 원하시나요?"). 상세=docs/_적용/측정정확도_전면진단_2026-07-31.md
    //   ⚠️ 모호한 경우에만 LLM 판정 → 명확한 브랜드는 추가 원가 0.
    const rawFlat = sevenEngineResponses.flat();
    const flat = await verifyMentions(rawFlat, {
      brandName,
      brandDomain: input.domain,
      industry: input.industry ?? undefined,
      officialSite: officialSiteIdentity,
    });
    const measurementCoverage = countMeasurementCoverage(flat);
    if (isMeasurementFailure(measurementCoverage)) {
      throw new Error(
        `AI 엔진 응답을 받지 못했습니다. 연결 설정을 확인한 뒤 다시 시도해 주세요. (시도 ${measurementCoverage.attempted}곳)`
      );
    }
    // Tracking(dual-write)도 같은 판정을 쓰도록 교정 결과를 태깅 배열에 반영.
    //   flat 과 tagged 는 동일한 flatMap 순서를 공유한다(위 주석 참조).
    for (const [i, verified] of flat.entries()) {
      const row = tagged[i];
      if (row) {
        row.brandMentioned = verified.brandMentioned;
      }
    }
    // 시장 분해(2026-08-21)용 언어 태깅 — flat·tagged 는 같은 flatMap 순서를
    //   공유하므로(위 주석) 인덱스로 안전하게 붙일 수 있다. flat 자체 구조는 안 바꾼다
    //   (aggregateAudit·auditCost 는 여전히 원본 flat 을 그대로 받는다).
    const langTaggedFlat: AggregatableResponse[] = flat.map((r, i) => ({
      ...r,
      promptLang: tagged[i]?.promptLang ?? "ko",
    }));
    const metrics = aggregateAudit(flat);

    // 원가계기(유닛이코노믹스): 진단 1건 실비용을 result 에도 담아 조회 가능하게(운영/대시보드용).
    const cost = auditCost(flat);
    const costSummary = {
      totalKrw: Math.round(cost.totalKrw * 100) / 100,
      measuredEngines: cost.measuredEngines,
      totalCalls: flat.length,
      totalDurationMs: flat.reduce((s, r) => s + r.durationMs, 0),
      perEngine: cost.perEngine.map((c) => ({
        engineId: c.engineId,
        krw: Math.round(c.krw * 100) / 100,
        basis: c.basis,
      })),
    };

    // 액션 입력 신호 조립 — 프롬프트별 언급 여부(갭 액션의 핵심)와 출처 유형 분포.
    //   sevenEngineResponses[i] 는 prompts[i] 에 1:1 대응하지만, 검증 교정은 flat 에만
    //   반영돼 있으므로 flat 을 프롬프트 단위로 다시 끊어 센다(엔진 수 = 배열 폭).
    // ⚠️ F5 동반 수정(2026-08-03): 프롬프트마다 **엔진 수가 달라졌다**
    //   (영어 질의는 글로벌 4개, 한국어는 7개). 기존의 고정폭 슬라이싱
    //   `flat.slice(i * enginesPerPrompt, ...)` 은 첫 프롬프트 길이를 전체에 적용해서
    //   언어가 섞이면 **엉뚱한 응답을 다른 프롬프트에 귀속**시킨다.
    //   → 실제 응답 개수로 누적 오프셋을 잡는다(길이가 균일하든 아니든 항상 정확).
    let offset = 0;
    const promptStats = prompts.map((p, i) => {
      const width = sevenEngineResponses[i]?.length ?? 0;
      const slice = flat.slice(offset, offset + width);
      offset += width;
      const usable = slice.filter((r) => !(r.errorMessage || r.isStub));
      return {
        text: p.text,
        hit: usable.filter((r) => r.brandMentioned).length,
        total: usable.length,
      };
    });
    // 타깃 시장 추정(2026-08-02) — 무료진단 입력칸을 늘리지 않기 위해 자동 추정한다.
    //   확신 없으면 both(기존과 동일 동작). 앱에서 고객이 직접 고칠 수 있다.
    // ⚠️ 2026-08-12 세션N-24: 이 계산을 **`buildGeoActions` 앞으로 옮겼다.**
    //   예전엔 처방을 만든 *뒤에* 시장을 정해서, 처방이 시장을 알 방법이 구조적으로 없었다
    //   → 해외 브랜드에게도 "네이버 지식iN에 답변하세요"가 나갔다.
    const inferredScope = inferMarketScope({
      domain: input.domain,
      industry: input.industry,
      language: input.language,
    });
    // 고객이 앱에서 명시한 시장이 있으면 그것을 신뢰한다(자동 추정보다 사람이 우선).
    const marketScope = input.marketScope ?? inferredScope.scope;

    const geoActions = buildGeoActions({
      brandName,
      averageMentionPosition: metrics.averageMentionPosition,
      enginesMeasured: new Set(metrics.enginesCovered).size,
      enginesMentioned: new Set(metrics.enginesWithMention).size,
      // 처방의 채널을 타깃 시장에 맞춘다(세션N-24). 점수의 분모를 정하는 값과 **같은 것**을 쓴다
      //   — 여기서 따로 추정하면 화면 안에서 시장 판정이 둘로 갈린다.
      marketScope,
      prompts: promptStats,
      sourceMix: summarizeSourceMix(flat, input.domain),
      // 실제 인용 도메인 — 처방을 "커뮤니티 50%"가 아니라 "blog.naver.com 47건"으로 말하기 위함.
      topDomains: topCitedDomains(flat, input.domain),
    });

    const result = {
      brandName,
      domain: input.domain,
      measurementContext: {
        officialSiteIdentity,
        identityGrounded: true,
      },
      promptsCount: prompts.length,
      briefingStatus: "not_requested" as const,
      cost: costSummary,
      engineResponses: flat.map((r) => ({
        engineId: r.engineId,
        brandMentioned: r.brandMentioned,
        mentionPosition: r.mentionPosition,
        // 순위의 분모(세션N-10). "N개 중 M번째"를 화면에서 말하려면 이 값이 있어야 한다.
        mentionListSize: r.mentionListSize,
        sentiment: r.sentiment,
        sov: r.shareOfVoice,
        durationMs: r.durationMs,
        isStub: r.isStub,
        errorMessage: r.errorMessage,
        // 판정 사유 보존(2026-08-03 세션N) — verifyMentions 가 이미 계산해 과금까지 끝낸
        //   정보를 여기서 버리고 있었다(전 코드베이스 참조 0건). brandMentioned(boolean)
        //   하나로 뭉개면 **"다른 대상으로 오인"과 "정말 모름"이 화면에서 같은 말**이 된다.
        //   실측 사례: 하이퍼클로바가 클로드를 "네이버가 만든 AI"라고 답함
        //   (= 미노출이 아니라 브랜드 안전성 리스크). 📕구조감사_언어축_2026-08-02.md §F12
        //   ⚠️ 저장만 한다 — 점수·SoV·집계는 무변경(시계열 연속). 표시 분기는 분포 확인 후.
        //   ⚠️ 관측 목적: `different_entity` 가 실제로 몇 건 나는지 아무도 모르는 상태였다.
        //      모호 게이트(needsVerification)를 통과한 응답만 LLM 판정을 받으므로,
        //      4글자 이상 한글·대문자 섞인 영문 브랜드는 오인이어도 confirmed 로 지나간다.
        //      → UI 를 먼저 만들면 표본 1(클로드)의 일반화가 된다. 분포부터 쌓는다.
        mentionQuality: r.mentionQuality,
        verdictVia: r.verdictVia,
        // 심층 분석의 인용 출처 판정도 원본 측정에 근거해야 한다. 도메인 집계만
        // 남기면 수진 분석기가 실제 출처 URL·제목을 전혀 받지 못해, "출처 분석"이라는
        // 이름과 입력 데이터가 어긋난다.
        citedSources: r.citedSources,
        // D-051: 300→1500자. 결함감사(2026-07-30) §9: 1500 하드컷이 단어·마크다운 토큰
        // 중간을 잘라("**GeForce RT") raw 기호가 노출됐음 → 4000자로 상향 + 문장/줄
        // 경계 컷 + 말줄임. DB 비용: 28 응답 × 4000 = 112KB/audit (Neon 감내 가능).
        excerpt: excerptOf(r.rawResponse),
      })),
      metrics,
      // 시장 분해(2026-08-02 세션M → 2026-08-21 언어축 재설계) — 통합 점수 하나가
      //   정반대 두 현실을 평균 내 가리던 문제. 실측: 한국에서만/해외에서만 보이는
      //   브랜드가 5축 전부 동일 39점.
      //   ⚠️ 분해 축은 **질의 언어**다(엔진 권역 아님 — 그 기준이면 "국내 중심"에서
      //   ChatGPT 가 빠진다). F5(언어→엔진 라우팅, 2026-08-03) 수정 후 재실측(2026-08-21)
      //   으로 언어축 유효성 확인: 언급률로는 판별 안 되지만 감성·출처량으로는 뚜렷이
      //   갈린다. 기존 순수 함수(aggregateAudit·geoAxisScores)를 언어 필터한 배열로
      //   재호출할 뿐 새 채점 로직은 없다.
      //   📕docs/_적용/타깃시장선언_SEO선례_2026-08-02.md · 시장축_언어재설계_2026-08-21.md
      marketScope,
      marketScopeReason: inferredScope.reason,
      marketScopeConfidence: inferredScope.confidence,
      regions: buildRegionBreakdown(langTaggedFlat),
      // 액션 레이어(2026-07-31 세션K-2): 기존 if/else 4분기 휴리스틱을 교체.
      //   근거=Princeton GEO 논문 Table 1~5. 상세=docs/_적용/액션레이어_설계_2026-07-31.md
      //   구 UI·PDF 호환을 위해 문자열 배열도 함께 유지한다.
      geoActions,
      topRecommendations: actionsToStrings(geoActions),
      /**
       * 🔴 **경쟁사 집계를 앱 대시보드와 같게 만드는 값**(N-45 · 남은일 #9).
       *
       * 예전엔 공개 리포트가 이 둘을 못 받아 `extractCompetitorLandscape` 를
       * **표기 병합 없이** 돌렸다 → 같은 브랜드가 「아모레퍼시픽」과 「Amorepacific」
       * 으로 **따로 세어져**, 앱 대시보드와 공개 리포트가 서로 다른 숫자를 보였다.
       *
       * ⛔ 경쟁사는 **거르는 목록이 아니라 표기 병합 사전**이다(👤 승인 ⓐ · N-44).
       *   화이트리스트로 쓰면 SoV 분모가 바뀌어 점유율이 부풀고, 「우리가 몰랐던
       *   경쟁사」가 화면에서 사라진다.
       *
       * ⚠️ `registeredCompetitors` 는 **로그인 측정에만** 있다 — 무료 진단은
       *   `brandId` 가 없어(`assign.ts` 실측) 빈 배열이다. 그래서 optional.
       */
      brandVariants,
      registeredCompetitors,
    };

    // 이 시각은 측정 1회의 식별자다. AuditJob과 모든 Tracking 행이 정확히 같은
    // 값을 공유해야 대시보드가 한 run으로 접는다(각각 new Date()면 단건 run 분리).
    //
    // 결과와 시계열을 PDF보다 먼저 커밋한다. PDF의 Chromium 시작·폰트 대기·Blob
    // 업로드는 부가 작업인데, 이를 앞에 두면 300초 함수 상한에서 이미 수집한 AI
    // 응답까지 통째로 잃고 job이 영원히 processing에 남는다.
    const completedAt = new Date();
    await database.auditJob.update({
      where: { id: input.jobId },
      data: {
        status: "completed",
        result: result as never,
        completedAt,
      },
    });
    // 원가계기(유닛이코노믹스): 진단 1건 실비용을 로그로도 실측 축적(result.cost 와 동일).
    log.info("audit.job.completed", {
      jobId: input.jobId,
      sov: metrics.sov,
      costKrw: costSummary.totalKrw,
      costMeasuredEngines: cost.measuredEngines,
      costPerEngine: cost.perEngine.map((c) => ({
        engine: c.engineId,
        krw: Math.round(c.krw * 100) / 100,
        basis: c.basis,
      })),
    });

    // 20번(dual-write): 로그인 org audit이면 완료 커밋 직후 Tracking에 이중 적재.
    //   flag 기본 off → 켜지기 전엔 이 블록 자체가 no-op(라이브 영향 0).
    //   org/brand 둘 다 있어야(=로그인 트리거 경로만) 실행. 무료 audit은 skip(D1).
    //   persistAuditTracking은 내부 best-effort(throw 안 함)라 status/result 무영향.
    //   🔴 2026-08-16: **건너뛸 때도 이유를 남긴다.**
    //   이 게이트는 조건 3개 중 하나만 어긋나도 조용히 지나갔다. 그래서 org 측정 34회 중
    //   24회분 시계열이 사라진 것을 **3주 동안 아무도 몰랐다**(측정은 completed,
    //   화면도 정상이라 볼 단서가 없었다). 로그 한 줄이 있었으면 첫날 잡혔다.
    //   → 이제 모든 실측정이 스스로 검증한다: 이 줄이 안 보이면 적재가 안 된 것이다.
    const dualWriteEnabled = keys().AUDIT_DUAL_WRITE_ENABLED;
    if (dualWriteEnabled && input.organizationId && input.brandId) {
      await persistAuditTracking({
        organizationId: input.organizationId,
        brandId: input.brandId,
        tagged,
        completedAt,
      });
    } else {
      log.warn("audit.tracking.skipped", {
        jobId: input.jobId,
        // 어느 조건이 막았는지 그대로 남긴다(추측하지 않게).
        reason: dualWriteEnabled ? "missing_org_or_brand" : "flag_disabled",
        flagEnabled: dualWriteEnabled,
        hasOrganizationId: Boolean(input.organizationId),
        hasBrandId: Boolean(input.brandId),
      });
    }

    // PDF 생성 — 핵심 결과와 Tracking을 저장한 뒤 실행하는 best-effort 부가 산출물.
    // 이 단계에서 함수 시간이 끝나도 고객은 측정 결과를 즉시 볼 수 있다.
    try {
      const pdfData: AuditPdfData = {
        ...result,
        language: input.language,
        generatedAt: new Date().toISOString().replace("T", " ").slice(0, 16),
      };
      const pdf = await generateAuditPdf(input.jobId, pdfData);
      await database.auditJob.update({
        where: { id: input.jobId },
        data: { pdfUrl: pdf.pdfUrl },
      });
      log.info("audit.pdf.generated", {
        jobId: input.jobId,
        sizeKB: Math.round(pdf.pdfSize / 1024),
      });
    } catch (pdfError) {
      log.error("audit.pdf.failed", {
        jobId: input.jobId,
        error: parseError(pdfError),
      });
    }

    /**
     * 🔴 **네이버 AI 브리핑 — 본류 편입**(N-45 · 남은일 #4-b B-4).
     * 📕 설계 = `docs/_적용/브리핑_본류편입_기획_2026-08-17.md`
     *
     * ⭐ **「8번째 엔진」이 아니라 「질의 축 하나 더」다.**
     *   본류 7엔진은 *추천형*("{브랜드} 추천")을 묻는데, 브리핑은 그 질의엔 **원리상 안 뜬다**.
     *   그냥 끼우면 거의 전량 「미노출」이 되고 그게 *"네이버가 우리를 모른다"* 로 오독된다.
     *   → 브리핑은 **자기 질의**(효과·후기·장단점)를 쓴다. 그래서 분모도 다르다.
     *   ⛔ 7엔진 등장률 평균에 **넣지 않는다**(`metrics` 는 위에서 이미 확정됐다 —
     *     이 블록은 `result` 를 저장한 **뒤**라 점수에 영향이 없다).
     *
     * ⛔ **로그인 측정에만** 돌린다(`organizationId` + `brandId`).
     *   무료 진단은 건수가 통제되지 않아 **Firecrawl 크레딧 예측이 무너진다**
     *   (cron 은 `MAX_TRIGGERS_PER_RUN=5` 로 하루 15콜 고정인데, 무료 진단 100건이면
     *   하루 300콜이다). 무료 진단은 지금처럼 **결과 페이지 버튼**으로 남는다.
     *
     * ⛔ **본류를 막지 않는다** — 이미 `status: completed` 로 저장한 뒤이고, 실패해도
     *   삼킨다. 브리핑은 **부가 축**이라 그것 하나로 측정 전체를 무르면 안 된다
     *   (📕 `persistAuditTracking` 과 같은 best-effort 규칙).
     *
     * ⚠️ 크레딧이 마르면 402 로 즉시 중단되고(N-39) 화면은 「측정하지 못했어요」로
     *   정직하게 말하며(N-45), 일일 다이제스트가 👤 에게 알린다(B-6).
     */
    if (
      keys().AUDIT_BRIEFING_IN_MAIN_ENABLED &&
      input.organizationId &&
      input.brandId
    ) {
      try {
        await runBriefingForAuditJob({ jobId: input.jobId });
      } catch (briefingError) {
        // 여기서 throw 하면 **이미 완료된 측정**이 실패로 뒤집힌다.
        log.warn("audit.briefing.main_flow_failed", {
          jobId: input.jobId,
          error: parseError(briefingError),
        });
      }
    }

    // CrewAI 4 에이전트 심층분석은 여기서 자동 실행하지 않는다 (원가전략, 2026-07-27).
    //   이유: crew 4콜(claude-sonnet-4.6 긴 호출)이 audit 1건 원가의 ~67%($0.25/$0.37)를
    //   차지 → 매 audit 자동실행 시 AI Gateway 무료크레딧($5/월≈13건)이 3배 빨리 소진되어
    //   파트너 측정 중 429(측정 끊김) 위험. 무료 측정은 본체 7엔진만(건당 $0.12)으로 가볍게.
    //   crew는 승인/유료 사용자가 결과 페이지의 "심층분석" 버튼을 눌러 on-demand로만 실행한다
    //   (POST /api/audit/[jobId]/crew → runCrewForAuditJob). crewStatus는 기본값
    //   "not_requested"로 남아 UI가 트리거 카드를 표시한다.
  } catch (error) {
    log.error("audit.job.failed", {
      jobId: input.jobId,
      error: parseError(error),
    });
    await database.auditJob.update({
      where: { id: input.jobId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
  }
}

// 인용 출처를 유형별로 센다 — 액션 ③(출처 포트폴리오)의 입력.
//   apps/app 의 analysis-data.ts 분류와 같은 축(자사/커뮤니티/위키/언론/기타)이지만,
//   여기는 러너(서버)라 최소 구현만 둔다(도메인 목록 중복은 의도적 — 패키지 경계 유지).
const WWW_PREFIX_RE = /^www\./;
const COMMUNITY_HINT_RE =
  /(blog|cafe|post)\.naver\.com|tistory|brunch|velog|dcinside|fmkorea|clien|ruliweb|theqoo|instiz|etoland|ppomppu|reddit|quora|medium|youtube/i;
const REFERENCE_HINT_RE =
  /namu\.wiki|wikipedia|wikidata|(terms|kin)\.naver\.com/i;
const MEDIA_HINT_RE =
  /news\.naver\.com|v\.daum\.net|chosun|joongang|donga|hani|mk\.co\.kr|hankyung|edaily|yna|zdnet|etnews|reuters|bloomberg|cnbc|techcrunch|theverge|engadget|(^|\.)(news|press|media|times|daily)\./i;

type SourceKindKey = "owned" | "community" | "reference" | "media" | "other";

function classifyCitedDomain(
  domain: string,
  ownedDomain: string
): SourceKindKey {
  if (domain === ownedDomain || domain.endsWith(`.${ownedDomain}`)) {
    return "owned";
  }
  if (REFERENCE_HINT_RE.test(domain)) {
    return "reference";
  }
  if (COMMUNITY_HINT_RE.test(domain)) {
    return "community";
  }
  if (MEDIA_HINT_RE.test(domain)) {
    return "media";
  }
  return "other";
}

/** 인용 상위 도메인(건수 desc) — 액션 처방에 실제 이름을 넣기 위한 입력. */
function topCitedDomains(
  responses: Array<{ citedSources: Array<{ domain: string }> }>,
  brandDomain: string
): Array<{ count: number; domain: string; owned: boolean }> {
  const owned = brandDomain.toLowerCase().replace(WWW_PREFIX_RE, "");
  const tally = new Map<string, number>();
  const domains = responses.flatMap((r) =>
    (r.citedSources ?? []).map((s) =>
      (s.domain ?? "").toLowerCase().replace(WWW_PREFIX_RE, "")
    )
  );
  for (const domain of domains) {
    if (domain) {
      tally.set(domain, (tally.get(domain) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([domain, count]) => ({
      domain,
      count,
      owned: domain === owned || domain.endsWith(`.${owned}`),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function summarizeSourceMix(
  responses: Array<{ citedSources: Array<{ domain: string }> }>,
  brandDomain: string
): Record<SourceKindKey, number> {
  const owned = brandDomain.toLowerCase().replace(WWW_PREFIX_RE, "");
  const mix: Record<SourceKindKey, number> = {
    owned: 0,
    community: 0,
    reference: 0,
    media: 0,
    other: 0,
  };
  const domains = responses.flatMap((r) =>
    (r.citedSources ?? []).map((s) =>
      (s.domain ?? "").toLowerCase().replace(WWW_PREFIX_RE, "")
    )
  );
  for (const domain of domains) {
    if (domain) {
      mix[classifyCitedDomain(domain, owned)] += 1;
    }
  }
  return mix;
}
