// 자동 갱신 cron — 유료 플랜 org 브랜드 재측정 (백로그 2·7, 2026-07-30)
//
// 배경: 무료는 수동 측정만, 유료(starter+)는 주기 자동 재측정이 업계 기본(Peec·Semrush).
//   플랜 능력치(planCapabilities.autoRefreshHours)가 게이팅 단일 진실:
//   free=null(자동 없음)·starter=168h(주간)·growth/scale=24h(데일리).
//
// 동작(멱등):
//   1) Organization.plan 이 자동 갱신을 허용(autoRefreshHours != null)하는 org 조회.
//      ⚠️ cron 은 유저 세션이 없다 → plan 진실은 **DB Organization.plan**(Clerk metadata 아님).
//   2) 각 org 의 브랜드마다 마지막 org 측정(email=`org:{orgId}`) 시각을 보고,
//      주기가 지났으면 새 AuditJob 생성 + 러너 직접 실행(start-tracking 서버액션의 cron 판).
//   3) 이미 저장된 마법사 프롬프트가 있으면 러너가 그걸 우선 사용(resolveRunPrompts).
//
// ⚠️ 배포 위치 = apps/web(findable, 이미 배포·엔진키 세팅됨). 러너가 web 프로세스에서 돈다.
//    Hobby cron 하루1회 → schedule "0 17 * * *". 데일리 플랜은 이 하루1회로 24h 주기 충족,
//    주간(starter)은 168h 경과 체크로 자연히 7일에 1회만 실행된다(같은 cron, 경과기준 분기).
//    유료 스케일 시 "0 */6 * * *" 등으로 올리면 즉시성↑(경과기준이 과다실행 막음).
//
// 🔴 **cron schedule 은 항상 UTC 다** (Vercel 공식 · 프로젝트 설정으로 바꿀 수 없다).
//    KST = UTC + 9. 그래서 새벽 2시(KST)로 돌리려면 `0 17 * * *` 이다.
//    > 사고 이력(2026-08-11 세션N-18): 예전 값 `0 2 * * *` 를 문서·인계가 모두
//    > "새벽 2시"로 읽었지만 실제로는 **오전 11시 KST** 에 돌고 있었다. 그래서
//    > "새벽 2시 크론이 돌면 PDF 가 생성된다"는 확인 과제가 계속 미확인으로 남았다
//    > (그 시각에 아직 오지 않았을 뿐인데 고장으로 의심했다).
//    ⚠️ Hobby 는 **하루 1회** 만 허용(더 잦은 식은 **배포가 실패**한다) + 정밀도 **±59분**
//      (17:00 예약이 17:59 에 올 수 있다 — 정시 도착을 전제로 로직을 짜지 말 것).
//
// 원가 보호: 한 번의 cron 실행에서 트리거하는 총 측정 수를 MAX_TRIGGERS_PER_RUN 로 제한
//    (maxDuration·429·크레딧 폭주 방지). 초과분은 다음 실행에서 처리(오래된 것 우선).
//
// 인증: `denyIfNotCron` 단일 진실(`CRON_SECRET` Bearer 만 신뢰).
//   🔴 **여기가 제일 위험했다** — 예전 가드는 `CRON_SECRET` 이 없으면 `x-vercel-cron: 1`
//      헤더만 보고 통과시켰는데 그 헤더는 **외부에서 붙일 수 있다**. 프로덕션에 시크릿이
//      실제로 없어서, curl 한 줄로 아무나 유료 측정(1건 ~87원)을 무제한 실행시킬 수 있었다.
//      → `packages/security/cron.ts` 로 통일(fail closed). **폴백을 되살리지 말 것.**

import {
  type DigestEntry,
  selectDigestEntries,
} from "@repo/audit/digest-filter";
import { buildAuditHistory } from "@repo/audit/history";
import { isUsableRun, scoreOf } from "@repo/audit/run-quality";
import { runAuditJob } from "@repo/audit/runner";
import { type Plan, planCapabilities } from "@repo/auth/plan";
import { database } from "@repo/database";
import { resend } from "@repo/email";
import { TrackingDigestEmail } from "@repo/email/templates/tracking-digest";
import { log } from "@repo/observability/log";
import { denyIfNotCron } from "@repo/security/cron";
import type { NextRequest } from "next/server";
import { env } from "@/env";

export const maxDuration = 300;

const HOUR_MS = 60 * 60 * 1000;
// 한 실행에서 트리거할 최대 측정 수(원가·maxDuration 보호). 러너 1건 ~20~60s.
const MAX_TRIGGERS_PER_RUN = 5;

/**
 * 알림 발송 스위치 (투두 #68, 2026-08-08).
 *
 * ⚠️ **기본은 꺼짐**. 켜려면 `FINDABLE_ENABLE_DIGEST_EMAIL=1`.
 *   이유: 지금 실측 데이터가 얇다(측정 2회·시계열 1일) → 보낼 "변화"가 사실상 없고,
 *   메일 본문을 사람이 눈으로 확인하기 전에 고객에게 먼저 도달하면 안 된다.
 *   기능은 완성해 두고 스위치만 남긴다(코드 배포 ≠ 발송 시작).
 */
const digestEmailEnabled = (): boolean =>
  process.env.FINDABLE_ENABLE_DIGEST_EMAIL === "1";

/** 히스토리 비교용 조회 상한(브랜드당). `/api/audit/[jobId]` 와 같은 값. */
const HISTORY_TAKE = 50;

interface DueBrand {
  brandId: string;
  brandName: string;
  brandVariants: string[];
  domain: string;
  lastMeasuredMs: number; // 정렬용(오래된 것 우선). 측정 이력 없으면 0.
  orgId: string;
}

/**
 * 방금 끝난 측정이 **직전 대비 얼마나 변했나**를 구한다(브랜드 1건).
 *
 * 🔒 비교 잣대는 화면과 **같은 코드**를 쓴다(`buildAuditHistory` + `run-quality`).
 *   복사하면 메일과 대시보드가 다른 숫자를 말하게 된다.
 * 🔴 고장난 회차(28엔진 전부 error 인데 completed)는 `isUsableRun` 이 걸러낸다 —
 *   그걸 기준으로 삼으면 "점수 급락" 거짓 경보가 나간다.
 *
 * best-effort — 실패하면 null(알림 대상에서 빠질 뿐 측정은 이미 성공했다).
 */
async function compareWithPrevious(
  orgId: string,
  jobId: string,
  domain: string
): Promise<{ deltaPoints: number | null; score: number | null } | null> {
  try {
    const rows = await database.auditJob.findMany({
      where: { email: `org:${orgId}`, status: "completed" },
      select: { id: true, domain: true, createdAt: true, result: true },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
    });
    const history = buildAuditHistory(
      rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        createdAt: r.createdAt,
        score: scoreOf(r.result),
        usable: isUsableRun(r.result),
      })),
      jobId,
      domain
    );
    const current = rows.find((r) => r.id === jobId);
    return {
      deltaPoints: history.deltaPoints,
      score: current ? scoreOf(current.result) : null,
    };
  } catch (error) {
    log.warn("cron.auto-refresh.compare_failed", {
      jobId,
      error: String(error),
    });
    return null;
  }
}

/**
 * org 소유자에게 변화 요약 메일 발송(best-effort).
 *
 * ⚠️ 수신자는 **DB `User`** 에서 찾는다(Clerk 호출 아님) — cron 은 세션이 없고,
 *   외부 API 의존을 늘리면 측정 성공이 알림 실패에 끌려 내려간다.
 *   `User` 는 Clerk 웹훅이 upsert 하므로 이메일이 최신이다.
 */
async function sendDigest(
  orgId: string,
  entries: readonly DigestEntry[]
): Promise<boolean> {
  if (!(resend && env.RESEND_FROM)) {
    log.warn("cron.auto-refresh.digest_email_not_configured", { orgId });
    return false;
  }
  const org = await database.organization.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  if (!org) {
    return false;
  }
  const owner = await database.user.findUnique({
    where: { id: org.ownerId },
    select: { email: true },
  });
  if (!owner?.email) {
    // 소유자가 DB 에 아직 없을 수 있다(웹훅 유실). 조용히 넘긴다 — 측정은 이미 됐다.
    log.warn("cron.auto-refresh.digest_no_owner_email", { orgId });
    return false;
  }

  const top = entries.at(0);
  await resend.emails.send({
    from: env.RESEND_FROM,
    to: owner.email,
    // 제목에 숫자를 넣는다 — 열지 않아도 무슨 일인지 알 수 있게.
    subject: top
      ? `${top.brandName} AI 검색 노출 ${top.deltaPoints > 0 ? "+" : ""}${top.deltaPoints}점`
      : "AI 검색 노출 점수가 변했어요",
    react: TrackingDigestEmail({
      appUrl: env.NEXT_PUBLIC_APP_URL,
      items: entries,
    }),
  });
  return true;
}

/** 자동 갱신 대상 org 조회 결과(브랜드 포함). */
interface OrgWithBrands {
  brands: Array<{
    domain: string;
    entityVariants: unknown;
    id: string;
    name: string;
  }>;
  id: string;
  plan: Plan;
}

/** JSON 별칭 필드에서 실제 문자열만 골라 러너에 넘긴다. */
const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      )
    : [];

/**
 * 브랜드별 **마지막 측정 시각**을 보고 주기가 지난 것만 모은다.
 *
 * ⚠️ plan 별 주기는 `planCapabilities(plan).autoRefreshHours` 가 단일 진실이다
 *   (starter=168h 주간 · growth/scale=24h 데일리 · free=null 제외).
 *   측정 이력이 없으면 `lastMs=0` → 즉시 대상이 된다.
 */
async function collectDueBrands(
  orgs: readonly OrgWithBrands[],
  now: number
): Promise<DueBrand[]> {
  const due: DueBrand[] = [];
  for (const org of orgs) {
    const intervalHours = planCapabilities(org.plan).autoRefreshHours;
    if (intervalHours === null) {
      continue;
    }
    const intervalMs = intervalHours * HOUR_MS;
    for (const brand of org.brands) {
      const last = await database.auditJob.findFirst({
        where: {
          email: `org:${org.id}`,
          domain: brand.domain,
          status: "completed",
        },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true, createdAt: true },
      });
      const lastMs = (last?.completedAt ?? last?.createdAt)?.getTime() ?? 0;
      // 측정 이력 없거나(0) 주기 경과면 대상.
      if (now - lastMs >= intervalMs) {
        due.push({
          orgId: org.id,
          brandId: brand.id,
          brandName: brand.name,
          brandVariants: stringList(brand.entityVariants),
          domain: brand.domain,
          lastMeasuredMs: lastMs,
        });
      }
    }
  }
  return due;
}

/** 알림 후보 맵(org → 브랜드별 변화). `selectDigestEntries` 가 발송 여부를 정한다. */
type DigestByOrg = Map<
  string,
  Array<{ brandName: string; deltaPoints: number | null; score: number | null }>
>;

/**
 * 변화가 있는 org 에만 발송하고, 보낸 건수를 돌려준다.
 * 조용한 주에는 아무 메일도 나가지 않는다(스팸 방지 — `selectDigestEntries` 참고).
 */
async function sendDigests(digestByOrg: DigestByOrg): Promise<number> {
  let sent = 0;
  for (const [orgId, candidates] of digestByOrg) {
    const entries = selectDigestEntries(candidates);
    if (entries.length === 0) {
      continue;
    }
    try {
      if (await sendDigest(orgId, entries)) {
        sent += 1;
        log.info("cron.auto-refresh.digest_sent", {
          orgId,
          brands: entries.length,
        });
      }
    } catch (error) {
      // best-effort — 발송 실패가 측정 성공을 덮지 않는다.
      log.error("cron.auto-refresh.digest_failed", {
        orgId,
        error: String(error),
      });
    }
  }
  return sent;
}

export const GET = async (request: NextRequest) => {
  // 🔒 원가가 나가기 전에 먼저 막는다(측정 1건 ~87원).
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }

  const now = Date.now();

  // 0) 🔴 **기간 만료 먼저 강하시킨다** (세션N-42 · 초대 코드).
  //   순서가 중요하다 — 아래 측정 선정 **앞**에 둬야 만료된 org 가 유료 측정을
  //   한 번 더 받지 않는다(원가 누수). `planExpiresAt` 은 스키마에 이미 있던
  //   필드인데 **쓰는 코드가 0곳**이었다(N-42 실측) → 여기서 처음 쓴다.
  //   ⚠️ Clerk 캐시(publicMetadata.plan)는 여기서 못 고친다(크론은 유저 세션이 없다).
  //     DB 가 권위이고, 게이팅은 org.plan 을 읽으므로 화면은 즉시 정확해진다.
  const expired = await database.organization.updateMany({
    where: {
      planExpiresAt: { not: null, lt: new Date(now) },
      plan: { not: "free" },
    },
    data: { plan: "free", planExpiresAt: null },
  });
  if (expired.count > 0) {
    log.info("cron.plan.expired_downgraded", { count: expired.count });
  }

  // 1) 자동 갱신 허용 플랜의 org (DB plan 진실). free 는 autoRefreshHours=null 이라 제외.
  const autoPlans = (
    ["starter", "growth", "scale", "enterprise"] as Plan[]
  ).filter((p) => planCapabilities(p).autoRefreshHours !== null);
  const orgs = await database.organization.findMany({
    where: { plan: { in: autoPlans } },
    select: {
      id: true,
      plan: true,
      brands: {
        select: { domain: true, entityVariants: true, id: true, name: true },
      },
    },
  });

  // 2) 브랜드별 마지막 측정 시각 → 주기 경과분만 수집.
  const due = await collectDueBrands(orgs, now);

  // 3) 오래된 것 우선, 상한까지만 트리거(원가 보호).
  due.sort((a, b) => a.lastMeasuredMs - b.lastMeasuredMs);
  const batch = due.slice(0, MAX_TRIGGERS_PER_RUN);

  let triggered = 0;
  // org별 알림 후보 — 측정이 성공한 브랜드만 담는다(발송은 루프 뒤 한 번에).
  const digestByOrg: DigestByOrg = new Map();

  for (const item of batch) {
    // 진행 중 중복 방지: 이 도메인에 아직 안 끝난 org 잡이 있으면 skip.
    const running = await database.auditJob.findFirst({
      where: {
        email: `org:${item.orgId}`,
        domain: item.domain,
        status: { in: ["queued", "processing"] },
      },
      select: { id: true },
    });
    if (running) {
      continue;
    }

    // AuditJob 생성(FK forward-fill) 후 러너 직접 실행(start-tracking 6~7 단계의 cron 판).
    const job = await database.auditJob.create({
      data: {
        email: `org:${item.orgId}`,
        domain: item.domain,
        language: "both",
        organizationId: item.orgId,
        brandId: item.brandId,
      },
      select: { id: true },
    });
    try {
      await runAuditJob({
        jobId: job.id,
        domain: item.domain,
        language: "both",
        brandName: item.brandName,
        brandVariants: item.brandVariants,
        organizationId: item.orgId,
        brandId: item.brandId,
      });
      triggered += 1;

      // 알림 후보 수집 — 스위치가 꺼져 있으면 비교 쿼리조차 돌리지 않는다(불필요한 부하 0).
      if (digestEmailEnabled()) {
        const compared = await compareWithPrevious(
          item.orgId,
          job.id,
          item.domain
        );
        if (compared) {
          const list = digestByOrg.get(item.orgId) ?? [];
          list.push({ brandName: item.brandName, ...compared });
          digestByOrg.set(item.orgId, list);
        }
      }
    } catch (error) {
      log.error("cron.auto-refresh.run_failed", {
        jobId: job.id,
        domain: item.domain,
        error: String(error),
      });
    }
  }

  const digestsSent = await sendDigests(digestByOrg);

  const result = { dueCount: due.length, triggered, digestsSent };
  if (triggered > 0) {
    log.info("cron.auto-refresh.triggered", result);
  }
  return Response.json({ ok: true, ...result });
};
