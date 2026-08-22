// POST /api/audit — 무료 Audit 잡 생성 + 백그라운드 실행
//
// PRD §11.2 AuditRequest/AuditResponse 스키마 기준.
// 비로그인 진입 (이메일만 받음) — 리서치 결론상 로그인·이메일인증을 강제하지 않는다.
//
// 어뷰즈·원가 방어 4층 (리서치 = docs/_적용/무료진단_어뷰징_원가방어_리서치_2026-07-31.md):
//   ⓪ BotID           — 자동화 스크립트를 진입에서 차단(봇에 원가 0). Basic 무료.
//   ① 도메인 캐시(24h)  — 원가를 "요청 수"에서 "서로 다른 도메인 수"로 전환. 이메일 우회 무력화.
//   ② 전역 일일 예산    — 이메일·IP·도메인을 다 바꿔도 우회 불가한 유일한 통제.
//   ③ IP당 신규 도메인  — 한 사람의 예산 독점 방지(캐시 히트·실패는 쿼터 제외 → 오차단 최소).
//   ④ 이메일+도메인 24h — 기존 게이트(유지). 단독으로는 이메일 변경에 우회됨.
//   ⚠️ "IP로 차단"은 하지 않는다. RFC 6269 §13.1이 "penalty box … simply will not work"로
//      부정하고 CGNAT IP가 3배 오차단된다(우리 ICP=회사 NAT). ③은 차단이 아니라 예산 배분.
//
// Runtime: Node.js (Prisma + Neon adapter는 Edge 미지원).
// maxDuration: vercel.json에서 300s (Audit 백그라운드 처리 마진).

import { maskEmail } from "@repo/audit/mask";
import { runAuditJob } from "@repo/audit/runner";
import { resolveTier, type UsageTier } from "@repo/audit/usage-tier";
import { database, Prisma } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { checkBotId } from "botid/server";
import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 300;

const PROTOCOL_PREFIX_RE = /^https?:\/\//;
const TRAILING_SLASH_RE = /\/$/;

const auditRequestSchema = z.object({
  // 🔴🔴 **이 `z.email()` 은 보안 경계다 — 느슨한 문자열 검증으로 바꾸지 말 것.**
  //   (2026-08-12 세션N-24 보안 감사에서 확인)
  //
  //   `canRunDeepAnalysis`(`packages/audit/usage-tier.ts`)는 `email` 이 `"org:"` 로
  //   시작하면 **유료·승인 게이트를 무조건 통과**시킨다. 그 접두사는 "인증된 서버만
  //   쓰는 이름공간"이라는 약속 위에 서 있고(`start-tracking.ts` 가 `org:${orgId}` 로
  //   생성), **그 약속을 지키는 것이 바로 이 한 줄**이다.
  //
  //   🔬 실측: `org:abc`·`ORG:abc`·**`org:x@y.com`** 전부 `z.email()` 이 거부한다.
  //   → 여기를 `z.string()` 이나 커스텀 정규식으로 완화하면 누구나 `org:` 를 보내
  //     **심층분석(Letsur 크레딧 소모)을 무료로 무제한 실행**할 수 있게 된다.
  email: z.email(),
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(PROTOCOL_PREFIX_RE, "")
        .replace(TRAILING_SLASH_RE, "")
    ),
  industry: z.string().optional(),
  language: z.enum(["ko", "en", "both"]).default("both"),
  brandName: z.string().max(100).optional(),
});

// DB Industry enum 은 닫힌 집합이다. 폼/외부에서 임의 문자열이 들어올 수 있으므로
// 유효값일 때만 저장하고, 아니면 undefined(=null 저장 → 러너가 도메인으로 자동 추론).
// ⚠️ manufacturing 은 2026-08-02 추가분(반도체·부품·소재가 b2b_saas 로 뭉뚱그려지던 문제).
const INDUSTRY_ENUM_VALUES = [
  "beauty",
  "fashion",
  "food",
  "b2b_saas",
  "content_ip",
  "retail",
  "finance",
  "healthcare",
  "education",
  "manufacturing",
  "other",
] as const;

type IndustryEnum = (typeof INDUSTRY_ENUM_VALUES)[number];

function toIndustryEnum(value?: string): IndustryEnum | undefined {
  const v = value?.trim().toLowerCase();
  return v && (INDUSTRY_ENUM_VALUES as readonly string[]).includes(v)
    ? (v as IndustryEnum)
    : undefined;
}

// 사용량 티어 (원가전략 2026-07-27 — 파트너 진입 대응). 판정은 공용 usage-tier로 이관:
//   - admin: 무제한 / 승인 파트너: 이메일 기준 하루 1회 / 일반 리드: 이메일+도메인 24h.
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ──────────────────────────────────────────────────────────────────
// 도메인 캐시 (2026-07-31 리서치 — 원가방어 1순위)
// 📕 근거: docs/_적용/무료진단_어뷰징_원가방어_리서치_2026-07-31.md §5(a)
//
// 핵심: 우리 원가는 "요청 수"가 아니라 "서로 다른 도메인 수"에 비례한다.
//   같은 도메인을 이메일 50개로 물어도 원가는 1회분이면 된다.
//   → 이메일을 바꿔 우회하는 공격이 경제적으로 무의미해진다(기존 게이트의 유일한 구멍).
//   → CGNAT 오차단 문제도 동시 해소(캐시 공유는 버그가 아니라 기능).
//
// 선례(Mozilla HTTP Observatory 문서 원문):
//   "24시간 내 스캔했으면 캐시된 결과를 반환" + "3분보다 자주는 스캔 불가"
//
// ⚠️ 기존 checkUsageGate 는 차단만 하고 적재된 result 를 재사용하지 않았다.
//    같은 조회로 캐시까지 처리하도록 확장한다(추가 쿼리 없음).
const DOMAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — Observatory 준용

// 캐시 히트는 이 게이트를 타지 않고 POST 앞단에서 200 + jobId 로 바로 반환한다
// (차단 429 가 아니라 "기존 결과 보여주기"라서 게이트 결과 타입에 넣지 않았다).
type GateResult =
  | { blocked: false }
  | { blocked: true; existingJobId: string; isPartner: boolean };

// ──────────────────────────────────────────────────────────────────
// 전역 일일 상한 (리서치 §7-2) — 어뷰저가 로테이션으로 우회할 수 없는 유일한 통제.
//
// 이메일·IP·도메인은 전부 바꿀 수 있지만 "우리가 오늘 쓴 총액"은 못 바꾼다.
// 경고 사례(리서치): Recipe Ninja — 한 유저가 같은 요청 12,000회로 $700 청구.
//
// ⚠️ 원가는 현재 result JSON·로그 안에만 있고 조회 가능한 컬럼이 아니다.
//    (packages/audit/runner.ts costSummary → log.info + result.cost)
//    → 정확한 "원화 합계" 상한은 스키마 변경이 필요하므로, 지금은 **건수 × 실측 평균단가**로
//      환산해 상한을 건다. 마이그레이션 0으로 오늘 방어를 켜는 게 우선.
//    → 정밀화(costKrw 컬럼 추가 후 SUM)는 투두_마스터에 남긴다.
const FREE_AUDIT_AVG_COST_KRW = 250; // 실측 150~300원의 보수적 중앙값(cost.ts 기준)
// 무료 진단 일일 예산. 초과 시 신규 무료 측정만 정지(유료·admin·캐시 히트는 계속 동작).
const DAILY_FREE_BUDGET_KRW = Number(
  process.env.FINDABLE_DAILY_FREE_BUDGET_KRW ?? 50_000
);
const DAILY_FREE_JOB_CAP = Math.max(
  1,
  Math.floor(DAILY_FREE_BUDGET_KRW / FREE_AUDIT_AVG_COST_KRW)
);

/**
 * 오늘 실행된 무료 진단 건수가 예산 상한을 넘었는지.
 * 캐시 히트는 새 측정이 아니므로 여기 카운트에 들어오지 않는다(원가 0).
 */
async function isDailyBudgetExhausted(): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS);
  const count = await database.auditJob.count({
    where: {
      createdAt: { gte: since },
      // 로그인 org 측정(email="org:*")은 유료 흐름이라 무료 예산에서 제외.
      NOT: { email: { startsWith: "org:" } },
    },
  });
  return count >= DAILY_FREE_JOB_CAP;
}

// ──────────────────────────────────────────────────────────────────
// IP당 신규 도메인 상한 (사용자 확정 2026-08-02: "IP당 2~3건으로 제한하자" → 2건)
//
// 목적 = **예산 독점 방지**(차단이 아니다). 전역 5만원 예산을 한 사람이 혼자 태워
//   정상 고객이 못 쓰게 되는 걸 막는다. 200건 중 2건 = 1%.
//
// ⚠️ 리서치(§2)는 "IP로 차단"을 반대했다. 여기서 IP를 쓰는 방식이 다른 이유:
//   1) **캐시 히트는 카운트하지 않는다** — 원가 0이므로 셀 이유가 없다.
//      회사 NAT 에서 여러 명이 같은 브랜드를 봐도 안 걸린다(가장 흔한 정상 패턴).
//   2) 즉 실제로 세는 건 "이 IP가 오늘 **새로** 태운 도메인 수" = 실지출 단위.
//   3) 영구 차단이 아니라 24h 슬라이딩. 안내 문구로 회복 경로를 준다.
//   ⚠️ 그래도 2건은 정상 사용과 겹칠 수 있다(대행사가 클라이언트 3곳 조회 등).
//      막히면 env(FINDABLE_IP_DAILY_NEW_DOMAINS)로 즉시 올릴 수 있게 했다.
const IP_DAILY_NEW_DOMAIN_CAP = Number(
  process.env.FINDABLE_IP_DAILY_NEW_DOMAINS ?? 2
);

// IPv6 는 개별 주소로 세면 안 된다 — 가정 회선 /56 하나가 2^64 버킷을 낸다(리서치 §2).
// Cloudflare 하한과 동일하게 /64(= 앞 4 hextet)로 묶는다.
const IPV6_PREFIX_HEXTETS = 4;

/**
 * 레이트리밋 키 — IPv4 는 그대로, IPv6 는 /64 프리픽스로 정규화.
 * ⚠️ 개별 IPv6 주소로 카운트하면 사실상 무제한이 된다.
 */
function normalizeIpKey(ip: string): string {
  if (!ip.includes(":")) {
    return ip; // IPv4
  }
  // IPv4-mapped IPv6(::ffff:1.2.3.4)는 뒤 IPv4 를 그대로 쓴다.
  const mapped = ip.split(":").at(-1);
  if (mapped?.includes(".")) {
    return mapped;
  }
  return `${ip.split(":").slice(0, IPV6_PREFIX_HEXTETS).join(":")}::/64`;
}

/**
 * 이 IP(정규화 키)가 24h 내 **새로 측정한 서로 다른 도메인 수**가 상한을 넘었는지.
 *
 * 캐시 히트는 AuditJob 을 만들지 않으므로 자동으로 카운트에서 빠진다
 * (= 원가가 든 측정만 세는 구조). ipAddress 는 이미 저장 중이라 마이그레이션 0.
 */
async function isIpQuotaExceeded(ipKey: string): Promise<boolean> {
  const rows = await database.auditJob.findMany({
    where: {
      ipAddress: ipKey,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
      // 실패한 측정은 원가가 거의 없고 사용자 잘못도 아니므로 쿼터에서 제외.
      NOT: { status: "failed" },
    },
    select: { domain: true },
    // 상한 판정에 필요한 만큼만(+1 로 초과 여부 확인). 전량 스캔 방지.
    take: (IP_DAILY_NEW_DOMAIN_CAP + 1) * 5,
  });
  const distinct = new Set(rows.map((r) => r.domain));
  return distinct.size >= IP_DAILY_NEW_DOMAIN_CAP;
}

/**
 * 도메인 캐시 조회 — 이메일 무관하게 **도메인 기준**으로 최근 완료 job 을 찾는다.
 *
 * 이게 원가 방어의 핵심이다. 이메일을 바꿔도 도메인이 같으면 새 측정을 하지 않는다.
 * ⚠️ admin 은 캐시를 우회한다(운영·디버깅에서 강제 재측정이 필요).
 */
/**
 * 요청 언어를 만족하는 캐시 후보 언어 목록.
 *
 * ⚠️ 2026-08-02 구조감사 F8: 캐시 키가 domain 뿐이라 **ko 로 요청해도 24h 안에 누가
 *    en/both 로 측정했으면 그 결과를 그대로 받았다**(라이브 실측: medicube·sulwhasoo·
 *    roundlab 3개 도메인이 ko/both 혼재). 리드 metadata 에는 "요청한" 언어가 적혀
 *    CRM 까지 조용히 오염된다.
 *
 * 규칙: 요청 언어를 **실제로 포함하는** 측정만 캐시로 인정한다.
 *   - ko 요청  ← ko 측정만 (both 는 한국어 프롬프트를 절반만 돌려 근거가 부족)
 *   - en 요청  ← en 측정만
 *   - both 요청 ← both 측정만
 * 보수적으로 정확히 일치하는 언어만 허용한다. 캐시 히트율이 조금 낮아지지만,
 * "측정하지 않은 언어의 결과를 그 언어 진단이라고 주는" 오배급보다 낫다.
 */
function cacheableLanguages(
  requested: "ko" | "en" | "both"
): Array<"ko" | "en" | "both"> {
  return [requested];
}

async function findCachedByDomain(
  domain: string,
  language: "ko" | "en" | "both"
): Promise<string | null> {
  const cached = await database.auditJob.findFirst({
    where: {
      domain,
      // F8 수정 — 언어를 캐시 키에 포함(누락 시 다른 언어 결과가 배급된다).
      language: { in: cacheableLanguages(language) },
      status: "completed",
      // result 가 실제로 있는 것만(빈 완료 job 을 캐시로 주면 빈 화면이 된다).
      // ⚠️ Prisma Json 필터는 plain null 을 받지 않는다 → DbNull 센티널 사용.
      result: { not: Prisma.DbNull },
      createdAt: { gte: new Date(Date.now() - DOMAIN_CACHE_TTL_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return cached?.id ?? null;
}

/**
 * 사용량 게이트 판정 (원가전략 2026-07-27). tier별로 최근 job을 조회해
 * 제한에 걸리면 blocked=true 반환. admin은 무제한(항상 통과). 좀비 job은 자동 정리.
 */
async function checkUsageGate(
  email: string,
  domain: string,
  tier: UsageTier
): Promise<GateResult> {
  if (tier === "admin") {
    return { blocked: false };
  }
  const isPartner = tier === "partner";
  const recent = await database.auditJob.findFirst({
    where: {
      email,
      // 파트너는 이메일 기준 하루 1회(도메인 무관), 일반은 이메일+도메인 24h.
      ...(isPartner ? {} : { domain }),
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!recent || recent.status === "failed") {
    return { blocked: false };
  }
  const isStaleProcessing =
    (recent.status === "processing" || recent.status === "queued") &&
    Date.now() - recent.createdAt.getTime() > STALE_THRESHOLD_MS;
  if (isStaleProcessing) {
    // 좀비 정리 — 새 audit 생성 흐름으로 통과.
    await database.auditJob
      .update({
        where: { id: recent.id },
        data: {
          status: "failed",
          errorMessage: "측정이 5분 넘게 진행되어 자동 종료됨 (좀비 정리)",
          completedAt: new Date(),
        },
      })
      .catch((err) => {
        log.warn("audit.stale.fail_failed", {
          jobId: recent.id,
          error: parseError(err),
        });
      });
    log.info("audit.stale.recovered", {
      email: maskEmail(email),
      staleJobId: recent.id,
    });
    return { blocked: false };
  }
  return { blocked: true, existingJobId: recent.id, isPartner };
}

export async function POST(request: NextRequest) {
  // ⓪ BotID — 방어 4층의 첫 관문. 파싱·DB 조회보다 **먼저** 둔다(봇에 원가 0).
  //   Basic 은 전 플랜 무료, Deep Analysis 는 $1/1000(건당 원가의 0.5~0.8%).
  //   ⚠️ 로컬 dev 는 항상 isBot:false → 라이브 검증은 브라우저 폼 제출로만 가능.
  //   ⚠️ 등록 경로는 instrumentation-client.ts 의 initBotId({protect}) 와 일치해야 한다.
  const verification = await checkBotId();
  if (verification.isBot) {
    log.warn("audit.request.bot_blocked", {
      // 봇 판정은 헤더 기반이라 개인정보를 남기지 않는다.
      path: "/api/audit",
    });
    return NextResponse.json(
      { error: "자동화된 요청으로 확인되어 차단되었습니다." },
      { status: 403 }
    );
  }

  let payload: z.infer<typeof auditRequestSchema>;

  try {
    const body = await request.json();
    payload = auditRequestSchema.parse(body);
  } catch (error) {
    log.warn("audit.request.invalid", { error: parseError(error) });
    return NextResponse.json(
      {
        error: "잘못된 요청입니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }

  try {
    // 무료 측정은 본체 7엔진 × 4프롬프트 = 28 호출(실측 150~300원). CrewAI 심층분석은
    // 버튼(승인/유료)이라, 아래 게이트들이 파트너 동시 사용 시 429(측정 끊김)를 막는다.
    const tier = resolveTier(payload.email);
    if (tier === "admin") {
      log.info("audit.request.admin_bypass", {
        email: maskEmail(payload.email),
      });
    } else if (tier === "partner") {
      log.info("audit.request.partner_daily", {
        email: maskEmail(payload.email),
      });
    }

    // IP 는 게이트 판정과 적재에 모두 쓰이므로 여기서 한 번만 구한다.
    // ⚠️ 저장값도 **정규화 키**로 통일해야 쿼터 집계가 맞는다(IPv6 /64).
    const rawIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null;
    const ipKey = rawIp ? normalizeIpKey(rawIp) : null;

    // ① 도메인 캐시 — 이메일 우회를 무력화하는 원가 방어 1순위(리서치 §5a).
    //    admin 은 강제 재측정을 위해 우회. 캐시 히트는 예산 검사보다 먼저 처리해야
    //    "예산 소진 중에도 이미 측정된 도메인은 결과를 볼 수 있다"가 성립한다.
    if (tier !== "admin") {
      const cachedJobId = await findCachedByDomain(
        payload.domain,
        payload.language
      );
      if (cachedJobId) {
        // 리드는 계속 적재한다 — 캐시로 줬다고 리드를 버리면 영업 자산을 잃는다.
        await database.lead
          .create({
            data: {
              email: payload.email,
              domain: payload.domain,
              // LeadSource 는 닫힌 enum → free_audit 재사용하고 캐시 사실은 metadata 에.
              // (리드 성격은 동일하다. 스키마 변경 없이 구분 가능하게 유지)
              source: "free_audit",
              metadata: {
                language: payload.language,
                jobId: cachedJobId,
                servedFromCache: true,
              },
            },
          })
          .catch((leadError) => {
            log.error("audit.lead.create_failed", {
              jobId: cachedJobId,
              error: parseError(leadError),
            });
          });
        log.info("audit.cache.hit", {
          domain: payload.domain,
          jobId: cachedJobId,
          savedKrw: FREE_AUDIT_AVG_COST_KRW,
        });
        return NextResponse.json({
          jobId: cachedJobId,
          status: "completed",
          pollUrl: `/api/audit/${cachedJobId}`,
          cached: true,
        });
      }
    }

    // ② 전역 일일 예산 — 이메일·IP·도메인을 다 바꿔도 이건 못 바꾼다(리서치 §7-2).
    if (tier !== "admin" && (await isDailyBudgetExhausted())) {
      log.warn("audit.budget.exhausted", {
        domain: payload.domain,
        capPerDay: DAILY_FREE_JOB_CAP,
        budgetKrw: DAILY_FREE_BUDGET_KRW,
      });
      return NextResponse.json(
        {
          error:
            "오늘 무료 진단이 모두 소진되었습니다. 내일 다시 시도하시거나 문의해 주세요.",
          budgetExhausted: true,
        },
        { status: 429 }
      );
    }

    // ③ IP당 신규 도메인 상한 — 한 사람이 예산을 독점하는 걸 막는다(사용자 확정 2건).
    //    ⚠️ 반드시 캐시(①) 뒤에 온다 — 캐시 히트는 원가 0이라 쿼터를 소모하지 않는다.
    //    회사 NAT 에서 여러 명이 같은 브랜드를 보는 정상 패턴은 여기 걸리지 않는다.
    if (tier === "lead" && ipKey && (await isIpQuotaExceeded(ipKey))) {
      log.info("audit.request.ip_quota", {
        ipKey,
        cap: IP_DAILY_NEW_DOMAIN_CAP,
        domain: payload.domain,
      });
      return NextResponse.json(
        {
          error: `무료 진단은 24시간 동안 ${IP_DAILY_NEW_DOMAIN_CAP}개 도메인까지 측정할 수 있습니다. 더 필요하시면 문의해 주세요.`,
          ipQuotaExceeded: true,
        },
        { status: 429 }
      );
    }

    const gate = await checkUsageGate(payload.email, payload.domain, tier);
    if (gate.blocked) {
      log.info("audit.request.rate_limited", {
        email: maskEmail(payload.email),
        existingJobId: gate.existingJobId,
      });
      return NextResponse.json(
        {
          error: gate.isPartner
            ? "파트너 계정은 하루 1회 측정할 수 있습니다. 내일 다시 측정하거나 심층 분석을 이용해 주세요."
            : "이미 24시간 내 이 도메인의 무료 진단을 받으셨습니다.",
          existingJobId: gate.existingJobId,
        },
        { status: 429 }
      );
    }

    const job = await database.auditJob.create({
      data: {
        email: payload.email,
        domain: payload.domain,
        language: payload.language,
        // 업종(2026-08-02): 기존엔 zod 로 받기만 하고 **저장하지 않아** 71건 전부
        //   null 이었다 → crew 가 업종을 알 방법이 없어 K-뷰티 예시로 추론했다.
        //   DB 는 닫힌 enum 이므로 유효값일 때만 저장하고, 아니면 null(=자동 추론).
        industry: toIndustryEnum(payload.industry),
        // ⚠️ 정규화 키로 저장한다 — isIpQuotaExceeded 가 같은 키로 조회하므로
        //    여기서 원본 IP 를 넣으면 IPv6 집계가 영구히 안 맞는다.
        ipAddress: ipKey,
      },
      select: { id: true, status: true, createdAt: true },
    });

    // CRM 리드 적재 — 실패해도 audit job은 유지
    try {
      await database.lead.create({
        data: {
          email: payload.email,
          domain: payload.domain,
          source: "free_audit",
          metadata: { language: payload.language, jobId: job.id },
        },
      });
    } catch (leadError) {
      log.error("audit.lead.create_failed", {
        jobId: job.id,
        error: parseError(leadError),
      });
    }

    log.info("audit.job.created", {
      jobId: job.id,
      domain: payload.domain,
      language: payload.language,
    });

    // 응답 후 백그라운드 실행 (Vercel Functions after())
    after(async () => {
      try {
        await runAuditJob({
          jobId: job.id,
          domain: payload.domain,
          language: payload.language,
          brandName: payload.brandName,
          // 업종은 언급 품질 검증(동명이인 분별)의 단서다 — 저장은 하면서 러너에
          // 안 넘기고 있었다. 없으면 기존과 동일하게 동작한다.
          industry: toIndustryEnum(payload.industry),
        });
      } catch (jobError) {
        // runAuditJob 내부에서 try/catch로 status='failed' 업데이트하지만,
        // 그 자체가 throw할 가능성에 대비한 last resort 핸들러.
        log.error("audit.job.uncaught", {
          jobId: job.id,
          error: parseError(jobError),
        });
      }
    });

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      pollUrl: `/api/audit/${job.id}`,
    });
  } catch (error) {
    // parseError가 Sentry.captureException 자동 호출
    const message = parseError(error);
    log.error("audit.request.unhandled", { error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
