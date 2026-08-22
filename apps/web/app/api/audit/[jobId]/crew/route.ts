// POST /api/audit/[jobId]/crew — 4 에이전트 강화 분석 트리거
//
// 무료 Audit 빠른 모드 완료 후 사용자가 "4 에이전트 분석" 클릭 시 호출.
// after()로 백그라운드 실행, AuditJob.crewStatus 업데이트.
//
// 같은 jobId에 대해 이미 progressing/completed면 409 반환 (중복 트리거 방지).
// 단, processing 상태가 STALE_AFTER_MS를 초과하면 백그라운드 프로세스가
// 죽은 것(after() 크래시)으로 보고 재실행을 허용한다 — 영구 stuck 방지.
// Runtime: Node.js, maxDuration 300s.

import { runCrewForAuditJob } from "@repo/audit/crew-runner";
import { kstDayStart } from "@repo/audit/kst-day";
import { maskEmail } from "@repo/audit/mask";
import {
  canRunDeepAnalysis,
  hasFreeCrewQuotaLeft,
  resolveTier,
} from "@repo/audit/usage-tier";
import { database } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { checkBotId } from "botid/server";
import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { resolveIsOwner } from "../../_lib/owner";

export const runtime = "nodejs";
export const maxDuration = 300;

// processing 상태가 이 시간을 넘으면 백그라운드 프로세스가 죽은 것으로 간주하고
// 재실행을 허용한다. crew는 최대 ~10분 소요 가능하므로 여유를 둔 15분.
const STALE_AFTER_MS = 15 * 60 * 1000;

// ──────────────────────────────────────────────────
// 전역 일일 상한 (2026-08-12 세션N-25)
//
// 🔴 **왜 필요한가**: 어뷰징 방어 리서치가 *"이메일·IP·도메인을 다 바꿔도 우회할 수
//   없는 **유일한** 통제"* 로 지목한 것이 전역 상한이다(IP 제한은 CGNAT 오차단으로
//   이미 기각). 진단 본체(`api/audit/route.ts`)에는 있는데 **crew 에는 없었다.**
//
// ⚠️ **왜 "금액"이 아니라 "건수"인가** — 이 프로젝트 규칙: *근거 없는 임계값을
//   발명하지 않는다.* crew 는 실행 원가를 **어디에도 기록하지 않는다**(`crew-runner.ts`
//   에 cost 계기 없음 · `cost.ts` 의 `TOKEN_PRICES` 에도 haiku 항목 없음).
//   → 금액 상한을 만들면 **측정된 적 없는 단가**를 곱해야 하고, 그 순간 숫자가 조작이 된다.
//   대신 **직접 관측 가능한 것(하루 실행 건수)** 으로 건다.
//   📌 정밀화 조건: crew 에 cost 계기를 붙여 실측 분포가 생기면 그때 금액으로 바꾼다.
//
// 기본값 근거: 진단 본체의 무료 예산이 50,000원 / 250원 = **200건/일** 이다.
//   crew 는 그 위에 얹히는 부가 실행이므로 같은 자릿수를 넘을 이유가 없다.
//   env 로 조정 가능하게 두어 실측 후 즉시 조일 수 있게 한다.
const DAILY_CREW_CAP = Math.max(
  1,
  Number(process.env.FINDABLE_DAILY_CREW_CAP ?? 200)
);

/**
 * 오늘(KST 자정 기준) 실행된 crew 건수가 상한을 넘었는지.
 *
 * ⚠️ `crewStartedAt` 으로 센다 — `not_requested` 는 애초에 실행된 적이 없고,
 *   `failed` 도 **크레딧은 이미 썼으므로** 카운트에 포함해야 방어가 샌다.
 * ⚠️ 🔴 **UTC 가 아니라 KST 자정으로 끊는다** — 이 프로젝트가 cron 에서 이미 한 번
 *   덴 지점이다(UTC 17시 = KST 새벽 2시). 상한이 한국 사용자 기준 오전 9시에
 *   리셋되면 "오전에 이미 소진" 같은 이상 동작이 된다.
 */
async function isDailyCrewCapExhausted(): Promise<boolean> {
  // 🔴 KST 자정 계산은 `@repo/audit/kst-day` 에 순수 함수로 있다(테스트로 고정).
  //   여기서 다시 구현하면 두 벌이 되고, 하나만 고치는 사고가 난다.
  const since = kstDayStart(new Date());
  const count = await database.auditJob.count({
    where: { crewStartedAt: { gte: since } },
  });
  return count >= DAILY_CREW_CAP;
}

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

/*
 * 비로그인 리드의 **무료 체험 1회** 판정 — 소진됐으면 403 응답을, 아직 남았으면 null.
 *
 * ⚠️ 함수로 뺀 이유는 인지복잡도 상한(biome 20)이다. 판정 내용은 바뀌지 않았다.
 *
 * 🔴 **`failed` 는 세지 않는다** — 처음엔 *"실패해도 크레딧은 나갔으니 세야 한다"* 고
 *   짰는데, 그건 **어뷰징 방어 관점**이고 **정상 고객 관점에서는 배신**이다:
 *   우리 잘못(270초 타임아웃·엔진 장애)으로 실패했는데 고객이 체험분을 잃는다.
 *   실패 경로는 실재한다 — N-13 실측 최악 crew 가 **226초**로 상한 270초에 가깝다.
 *
 * ⚠️ 실패를 반복시켜 크레딧을 태우는 어뷰징은 **전역 일일 상한**이 막는다.
 *   쿼터는 어뷰징 방어가 아니라 **미끼(체험) 관리**가 목적이다. 역할을 섞지 않는다.
 */
async function checkFreeLeadQuota(
  email: string,
  jobId: string
): Promise<NextResponse | null> {
  const usedCount = await database.auditJob.count({
    where: {
      email,
      crewStartedAt: { not: null },
      crewStatus: { not: "failed" },
    },
  });

  if (hasFreeCrewQuotaLeft(usedCount)) {
    log.info("audit.crew.free_quota_used", {
      jobId,
      email: maskEmail(email),
      usedCount,
    });
    return null;
  }

  log.info("audit.crew.quota_exhausted", {
    jobId,
    email: maskEmail(email),
    usedCount,
  });
  // ⚠️ 예전 문구는 *"승인 파트너·유료 플랜에서 이용할 수 있습니다"* 였는데
  //   **사실이 아니었다** — 실제 게이트는 결제가 아니라 로그인이라 free 플랜도
  //   가입하면 열린다. 거짓 표기를 지우고 실제 다음 행동(가입)을 안내한다.
  return NextResponse.json(
    {
      error:
        "무료 심층 분석을 이미 사용하셨어요. 가입하시면 계속 이용할 수 있어요.",
      quotaExhausted: true,
      signUpRequired: true,
    },
    { status: 403 }
  );
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  // BotID — 심층분석은 Letsur 크레딧을 소모하므로 자동화 요청을 먼저 막는다.
  // (등록 경로 = instrumentation-client.ts `/api/audit/*/crew`)
  const verification = await checkBotId();
  if (verification.isBot) {
    log.warn("audit.crew.bot_blocked", {});
    return NextResponse.json(
      { error: "자동화된 요청으로 확인되어 차단되었습니다." },
      { status: 403 }
    );
  }

  const { jobId } = await params;
  log.info("audit.crew.requested", { jobId });

  try {
    if (!jobId || typeof jobId !== "string" || jobId.length < 10) {
      return NextResponse.json(
        { error: "잘못된 jobId입니다." },
        { status: 400 }
      );
    }

    const job = await database.auditJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        email: true,
        // 소유 판별용(조직 측정의 정식 연결). select 에 없으면 항상 undefined 라
        // **조직 소유자가 조용히 탈락**한다.
        organizationId: true,
        status: true,
        crewStatus: true,
        crewStartedAt: true,
        result: true,
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: "존재하지 않는 jobId입니다." },
        { status: 404 }
      );
    }

    // 🔴 전역 일일 상한 — 자격 판정 **앞**에 둔다. 크레딧을 태우는 것은 자격이 아니라
    //   실행이고, 상한이 소진되면 누가 눌렀든 새 실행을 막아야 한다.
    //   ⚠️ 단 admin 은 예외 — 상한 소진 시에도 운영자가 원인을 조사할 수 있어야 한다
    //   (진단 본체 `route.ts:416` 이 `tier !== "admin"` 으로 같은 예외를 둔다).
    if (
      resolveTier(job.email) !== "admin" &&
      (await isDailyCrewCapExhausted())
    ) {
      log.warn("audit.crew.cap_exhausted", {
        jobId,
        capPerDay: DAILY_CREW_CAP,
      });
      return NextResponse.json(
        {
          error:
            "오늘 심층 분석이 모두 소진되었습니다. 내일 다시 시도해 주세요.",
          capExhausted: true,
        },
        { status: 429 }
      );
    }

    // 자격 게이트. ⚠️ `canRunDeepAnalysis` 는 **결제 게이트가 아니다** —
    // `org:`(로그인 워크스페이스)·admin·파트너만 보고 `isPaid(plan)` 은 참조하지 않는다.
    // 즉 실질은 **로그인 게이트**이고, free 플랜도 가입하면 통과한다.
    //
    // 🔴 2026-08-12 세션N-25 — **비로그인 리드에게 평생 1회를 연다.**
    //   기존에는 여기서 무조건 403 이었는데, 화면은 *"베타 · 무료"* 라고 광고하고
    //   사이드바 버튼도 *"할 일 뽑기 · 무료"* 였다 → **모든 무료 사용자가 "무료"라고
    //   적힌 버튼을 눌러 에러를 받았다.** 라벨이 최초 커밋(6-28)이고 게이트가 한 달 뒤
    //   (7-27)에 얹히면서 생긴 표류다.
    //   근거: ①원가 = 진단 87원 대비 crew 는 **haiku 전환 후 수십 원 수준**이라
    //   유닛이코노믹스가 *"원가 때문에 조일 필요 없다"* 로 결론(원가율 0.09%)
    //   ②처방은 이미 `buildGeoActions` 로 **전량 무료 공개**돼 있다(`12a00de` —
    //   *"우리가 이기는 지점을 우리 손으로 잠가뒀다"*). crew 만 막는 건 일관성이 없다
    //   ③업계 게이팅 축 4개(프롬프트·엔진·브랜드·갱신주기)에 **처방은 없다**.
    //   🔴 2026-08-13 세션N-26 — **로그인한 소유자를 자격자로 인정한다.**
    //   앞 커밋(`4492022`)이 스스로 적어둔 약속이 *"실질은 로그인 게이트이고 free
    //   플랜도 **가입하면 열린다**"* 였는데, **그 약속이 지켜지지 않았다**:
    //   `canRunDeepAnalysis` 는 `job.email` 문자열만 보므로 `org:` 로 시작하는
    //   **앱에서 만든 측정만** 통과하고, 고객이 www 에서 받은 **무료 진단 job 은
    //   이메일이 개인 주소 그대로** 남는다 → 가입·결제를 마친 고객이 자기 결과에서
    //   crew 를 누르면 **"가입하고 계속 쓰기"** 를 본다(이미 가입한 사람에게).
    //   🔬 같은 job 을 두고 **대시보드는 "내 측정"이라고 말한다**
    //   (`(authenticated)/page.tsx:47` = 로그인 이메일 ∪ org) → 제품 두 곳이
    //   **같은 사람을 서로 다르게 판정**하고 있었다. 그 판정을 하나로 합친다.
    //   ⚠️ 원가는 **앞의 전역 일일 상한**이 막는다(자격과 역할을 섞지 않는다).
    const isOwner = await resolveIsOwner(job);
    // 자격 없으면 무료 체험 1회 판정으로 넘긴다(소진 시 403 응답을 그대로 반환).
    const quotaBlock =
      isOwner || canRunDeepAnalysis(job.email)
        ? null
        : await checkFreeLeadQuota(job.email, jobId);
    if (quotaBlock) {
      return quotaBlock;
    }

    if (job.status !== "completed" || !job.result) {
      return NextResponse.json(
        {
          error: "빠른 모드 Audit이 먼저 완료되어야 합니다.",
          currentStatus: job.status,
        },
        { status: 400 }
      );
    }

    if (job.crewStatus === "processing" || job.crewStatus === "queued") {
      // 진행 중이라도 시작 후 STALE_AFTER_MS를 넘겼으면 백그라운드가 죽은 것으로
      // 보고 재실행을 허용한다. (crewStartedAt이 없는 queued 상태는 방금 트리거된
      // 것이므로 stale 판정하지 않고 정상 중복으로 막는다.)
      const startedAt = job.crewStartedAt?.getTime();
      const isStale =
        startedAt !== undefined && Date.now() - startedAt > STALE_AFTER_MS;

      if (!isStale) {
        return NextResponse.json(
          { error: "이미 분석이 진행 중입니다.", crewStatus: job.crewStatus },
          { status: 409 }
        );
      }

      log.warn("audit.crew.stale_restart", {
        jobId,
        crewStatus: job.crewStatus,
        crewStartedAt: job.crewStartedAt,
        staleMs: startedAt === undefined ? null : Date.now() - startedAt,
      });
      // fall through → 아래에서 queued로 재전환 후 재트리거
    }

    if (job.crewStatus === "completed") {
      return NextResponse.json(
        { error: "이미 분석이 완료되었습니다.", crewStatus: job.crewStatus },
        { status: 409 }
      );
    }

    // queued 상태로 전환 후 백그라운드 트리거.
    // crewStartedAt을 여기서 함께 세팅한다. 이렇게 안 하면 after()가 runner의
    // processing 전환(crewStartedAt 세팅) 직전에 크래시할 경우 crewStatus="queued" +
    // crewStartedAt=null로 굳어, 아래 stale 판정(startedAt !== undefined)을 못 받아
    // 영구 stuck이 된다(사용자 테스트 반영 — Day15 P3). 트리거 시각을 기준으로 잡아두면
    // queued로 굳은 job도 STALE_AFTER_MS 초과 시 재실행이 허용된다.
    await database.auditJob.update({
      where: { id: jobId },
      data: { crewStatus: "queued", crewStartedAt: new Date() },
    });

    after(async () => {
      try {
        await runCrewForAuditJob({ jobId });
      } catch (error) {
        log.error("audit.crew.uncaught", { jobId, error: parseError(error) });
      }
    });

    return NextResponse.json({
      jobId,
      crewStatus: "queued",
      pollUrl: `/api/audit/${jobId}`,
    });
  } catch (error) {
    const message = parseError(error);
    log.error("audit.crew.unhandled", { jobId, error: message });
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
