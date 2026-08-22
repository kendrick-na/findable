/**
 * 브랜드 **1건만** 측정하는 단일 진실 (2026-08-17 세션N-37).
 *
 * 🔴 **왜 이 파일이 생겼나**
 *   어제(N-36) 「폴백 프롬프트가 DB에 안 심겨 Tracking 24회분이 증발」하는 버그를 고쳤는데,
 *   **고쳐졌는지 확인할 방법이 없었다.** 측정을 사람 없이 돌리는 경로가
 *   `auto-refresh-tracking` cron 하나뿐이었고 그건 **한 번에 5건**(`MAX_TRIGGERS_PER_RUN`)을
 *   집어 약 435원이 나간다. 1건(87원)만 돌릴 방법이 없어서 검증이 계속 미뤄졌다.
 *
 * 🔬 **로컬 스크립트로는 왜 안 되나**(실측 2026-08-17)
 *   ① 로컬 `.env.local` 에 `AUDIT_DUAL_WRITE_ENABLED` 가 **없다** → 적재 게이트가
 *      `flag_disabled` 로 막혀 Tracking 이 안 쌓인다. 87원 쓰고 "75행 그대로"가 나오는데
 *      그게 버그 때문인지 로컬 플래그 때문인지 **구분이 안 된다**(검증으로 무의미).
 *   ② 러너는 엔진키 여러 개(AI Gateway·CLOVA·NAVER·KAKAO·Browserbase)를 읽는다 →
 *      로컬 값이라 **프로덕션과 다른 조건**이다.
 *   → 그래서 이 함수는 **프로덕션에서 실행**되도록 API/서버액션이 감싸 쓴다.
 *
 * ⚠️ 원가: 1건 평균 **87원** · p50 181초 · **최대 298초(함수 상한 300초)**.
 *
 * 🔴 **동기로 기다리면 터진다 — 실측(2026-08-17).** 설화수 측정이
 *   `FUNCTION_INVOCATION_TIMEOUT` 으로 죽었다(87원은 나가고 시계열은 0 증가).
 *   이니스프리는 29초에 끝났는데 브랜드마다 편차가 크다(질문 수·엔진 응답 속도).
 *   → **고객용 경로는 처음부터 `after()` 백그라운드였다**(`start-tracking.ts:274` ·
 *     `api/audit/route.ts`). 이 도구만 동기로 기다려서 혼자 터진 것이다.
 *   → `startMeasureOne()`(시작만) + `checkMeasureOne()`(결과 확인) 으로 **분리**한다.
 *     `measureOneBrand()` 는 짧은 측정에만 쓰는 동기판으로 남긴다.
 */

import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { runAuditJob } from "./runner";

/** 측정 1건의 결과 — 화면·API 가 그대로 보여준다. */
export interface MeasureOneResult {
  brandId: string;
  brandName: string;
  domain: string;
  durationMs: number;
  jobId: string;
  /** 이미 돌고 있어 건너뛴 경우. */
  skipped?: "already_running";
  status: string;
  trackingAfter: number;
  trackingBefore: number;
  /** 이 측정으로 늘어난 Tracking 행 수. **0 이면 적재가 안 된 것**(핵심 검증 지표). */
  trackingDelta: number;
}

/** `startMeasureOne` 반환 — 측정을 **걸어두고** 즉시 돌아온다. */
export interface StartMeasureResult {
  brandId: string;
  brandName: string;
  jobId: string;
  skipped?: "already_running";
  /** 이 시점의 시계열 행수. 나중에 `checkMeasureOne` 이 이 값과 비교한다. */
  trackingBefore: number;
}

/**
 * 측정을 **시작만** 하고 즉시 반환한다(타임아웃 회피).
 *
 * 🔴 실행은 호출부가 `after(() => runMeasureJob(...))` 로 이어받는다 —
 *   `after` 는 `next/server` 의 것이라 이 패키지(프레임워크 비의존)에서 부를 수 없다.
 *   고객용 `start-tracking.ts` 와 **똑같은 구조**다.
 */
export async function startMeasureOne(
  brandId: string
): Promise<StartMeasureResult & { domain: string; organizationId: string }> {
  const brand = await database.brand.findUnique({
    select: { id: true, name: true, domain: true, organizationId: true },
    where: { id: brandId },
  });
  if (!brand) {
    throw new Error(`brand not found: ${brandId}`);
  }
  const { organizationId } = brand;
  if (!organizationId) {
    throw new Error(`brand has no organization: ${brand.name}`);
  }

  const trackingBefore = await database.tracking.count({
    where: { brandId: brand.id },
  });

  const running = await database.auditJob.findFirst({
    select: { id: true },
    where: {
      domain: brand.domain,
      email: `org:${organizationId}`,
      status: { in: ["queued", "processing"] },
    },
  });
  if (running) {
    return {
      brandId: brand.id,
      brandName: brand.name,
      domain: brand.domain,
      jobId: running.id,
      organizationId,
      skipped: "already_running",
      trackingBefore,
    };
  }

  const job = await database.auditJob.create({
    data: {
      brandId: brand.id,
      domain: brand.domain,
      email: `org:${organizationId}`,
      language: "both",
      organizationId,
    },
    select: { id: true },
  });

  log.info("admin.measure_one.queued", {
    brandId: brand.id,
    brandName: brand.name,
    jobId: job.id,
    trackingBefore,
  });

  return {
    brandId: brand.id,
    brandName: brand.name,
    domain: brand.domain,
    jobId: job.id,
    organizationId,
    trackingBefore,
  };
}

/** 걸어둔 측정의 **현재 상태**를 본다. 폴링용(0원). */
export async function checkMeasureOne(
  jobId: string,
  trackingBefore: number
): Promise<{
  done: boolean;
  status: string;
  trackingDelta: number;
  trackingNow: number;
}> {
  const job = await database.auditJob.findUnique({
    select: { brandId: true, status: true },
    where: { id: jobId },
  });
  const trackingNow = job?.brandId
    ? await database.tracking.count({ where: { brandId: job.brandId } })
    : trackingBefore;
  const status = job?.status ?? "unknown";
  return {
    done: status === "completed" || status === "failed",
    status,
    trackingDelta: trackingNow - trackingBefore,
    trackingNow,
  };
}

/**
 * 브랜드 1건을 측정한다. cron(`auto-refresh-tracking`)이 브랜드당 하는 일과 **동일**하되
 * 주기 판정·배치·다이제스트 메일을 뺀 것이다(같은 `runAuditJob` 을 같은 인자로 부른다).
 *
 * 🔴 **주기를 보지 않는다** — 방금 측정한 브랜드도 다시 잰다. 검증 도구라 그게 맞다.
 *   대신 **진행 중 중복만** 막는다(cron 과 같은 규칙).
 *
 * @param brandId 측정할 브랜드. 조직은 브랜드에서 도출한다(입력받지 않는다 —
 *   org↔brand 정합을 서버가 보장해야 confused-deputy 가 안 생긴다).
 */
export async function measureOneBrand(
  brandId: string
): Promise<MeasureOneResult> {
  const brand = await database.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, domain: true, organizationId: true },
  });
  if (!brand) {
    throw new Error(`brand not found: ${brandId}`);
  }
  const { organizationId } = brand;
  if (!organizationId) {
    throw new Error(`brand has no organization: ${brand.name}`);
  }

  // ⚠️ `Tracking` 에는 `organizationId` 가 **없다**(스키마 실측 2026-08-17) — brand 로만 센다.
  //   org 는 brand 를 통해 간접 연결된다. 여기에 organizationId 를 넣으면 런타임에 터진다.
  const countTracking = () =>
    database.tracking.count({ where: { brandId: brand.id } });

  const trackingBefore = await countTracking();

  // 진행 중 중복 방지 — cron 과 같은 규칙(같은 도메인에 안 끝난 org 잡이 있으면 skip).
  const running = await database.auditJob.findFirst({
    where: {
      email: `org:${organizationId}`,
      domain: brand.domain,
      status: { in: ["queued", "processing"] },
    },
    select: { id: true },
  });
  if (running) {
    return {
      brandId: brand.id,
      brandName: brand.name,
      domain: brand.domain,
      durationMs: 0,
      jobId: running.id,
      skipped: "already_running",
      status: "processing",
      trackingAfter: trackingBefore,
      trackingBefore,
      trackingDelta: 0,
    };
  }

  const job = await database.auditJob.create({
    data: {
      brandId: brand.id,
      domain: brand.domain,
      email: `org:${organizationId}`,
      language: "both",
      organizationId,
    },
    select: { id: true },
  });

  const startedAt = Date.now();
  log.info("admin.measure_one.started", {
    brandId: brand.id,
    brandName: brand.name,
    jobId: job.id,
    trackingBefore,
  });

  await runAuditJob({
    brandId: brand.id,
    brandName: brand.name,
    domain: brand.domain,
    jobId: job.id,
    language: "both",
    organizationId,
  });

  const durationMs = Date.now() - startedAt;
  const trackingAfter = await countTracking();
  const trackingDelta = trackingAfter - trackingBefore;

  const finished = await database.auditJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  });

  // 🔴 적재 0 은 조용히 지나가면 안 된다 — 이 도구가 존재하는 이유가 바로 그 침묵이었다.
  //   `runner.ts` 의 `audit.tracking.skipped` 로그와 짝을 이룬다(거기에 이유가 남는다).
  if (trackingDelta === 0) {
    log.warn("admin.measure_one.no_tracking", {
      brandId: brand.id,
      brandName: brand.name,
      jobId: job.id,
      status: finished?.status,
    });
  }

  return {
    brandId: brand.id,
    brandName: brand.name,
    domain: brand.domain,
    durationMs,
    jobId: job.id,
    status: finished?.status ?? "unknown",
    trackingAfter,
    trackingBefore,
    trackingDelta,
  };
}
