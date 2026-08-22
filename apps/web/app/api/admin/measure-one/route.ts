/**
 * 관리자 「1건만 측정」 — 2026-08-17 세션N-37.
 *
 * 🔴 **왜 필요했나**: 무인 측정 경로가 `auto-refresh-tracking` cron 하나뿐이었고
 *   그건 한 번에 **5건(약 435원)** 을 집는다. 1건(87원)만 돌릴 방법이 없어서
 *   N-36 의 Tracking 유실 수정이 **고쳐졌는지 확인을 못 하고 있었다.**
 *
 * 🔒 인증 = `CRON_SECRET` Bearer **단일 수단**(cron 과 같은 `denyIfNotCron`).
 *   ⚠️ **`x-vercel-cron` 폴백을 되살리지 말 것** — 그 헤더는 외부에서 붙일 수 있어서
 *      예전에 curl 한 줄로 유료 측정이 무제한 실행됐다(`packages/security/cron.ts` 주석).
 *   ℹ️ 브라우저(대표님)용 입구는 이 API 가 아니라 **서버액션**이다
 *      (`apps/app/.../admin/measure` — `requireAdmin()` 으로 Clerk 판정).
 *      같은 `measureOneBrand()` 를 부르므로 로직은 한 벌이다.
 *
 * 💸 **원가가 나간다**(1건 ~87원). 그래서:
 *   - `POST` 만 측정한다. `GET` 은 **조회 전용**(브랜드 목록·Tracking 행수) — 0원.
 *   - 한 요청에 **1건만**. 배열·전체 실행을 받지 않는다(실수로 전 브랜드가 도는 일 방지).
 */

import { checkMeasureOne, startMeasureOne } from "@repo/audit/measure-one";
import { runAuditJob } from "@repo/audit/runner";
import { database } from "@repo/database";
import { log } from "@repo/observability/log";
import { denyIfNotCron } from "@repo/security/cron";
import { after, type NextRequest } from "next/server";

// 측정 1건 p50 181초 · 최대 298초 → 상한을 꽉 잡는다(cron 과 동일).
export const maxDuration = 300;

/** 조회 전용(0원) — 브랜드 목록과 현재 Tracking 행수. 측정 전후 대조에 쓴다. */
export async function GET(request: NextRequest): Promise<Response> {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }

  // 폴링 모드 — POST 가 걸어둔 측정이 끝났는지 본다(`?jobId=...&before=...`).
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const before = Number(request.nextUrl.searchParams.get("before") ?? "0");
    return Response.json(await checkMeasureOne(jobId, before));
  }

  const brands = await database.brand.findMany({
    select: { id: true, name: true, domain: true, organizationId: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    brands.map(async (brand) => {
      // 🔴 **측정 「날짜 수」가 추세 기능의 전제다** — 행수가 아무리 많아도
      //   전부 같은 날이면 시간축 화면(추세·비교·알림)은 빈 화면이 된다.
      //   v4 탭 재편이 보류된 진짜 이유가 이것이라 조회에 같이 싣는다.
      const tracked = await database.tracking.findMany({
        select: { trackedAt: true },
        where: { brandId: brand.id },
      });
      const days = [
        ...new Set(tracked.map((t) => t.trackedAt.toISOString().slice(0, 10))),
      ].sort();

      // 🔴 **원문이 실제로 차 있는가** — 「진실의 거울」이 이걸 읽는다(N-37).
      //   행 수만 보고 화면을 만들면 *"답변 원문이 저장되지 않았어요"* 만 뜨는
      //   빈 화면이 된다. 화면 만들기 전에 DB 로 세라는 규율의 도구판.
      const withRaw = await database.tracking.count({
        where: { brandId: brand.id, rawResponse: { not: null } },
      });

      return {
        brandId: brand.id,
        domain: brand.domain,
        measuredDays: days,
        name: brand.name,
        organizationId: brand.organizationId,
        promptCount: await database.prompt.count({
          where: { brandId: brand.id },
        }),
        trackingRows: tracked.length,
        /** 답변 원문이 있는 행 수. 0 이면 진실의 거울이 그릴 게 없다. */
        rowsWithRawResponse: withRaw,
      };
    })
  );

  return Response.json({
    brands: rows,
    // 추세를 그릴 수 있는 브랜드 수 — 2일 이상이어야 선이 그려진다.
    trendCapableBrands: rows.filter((r) => r.measuredDays.length >= 2).length,
    total: rows.length,
  });
}

/** 측정 1건 실행(약 87원). body: `{ brandId }` 또는 `{ brand: "아누아" }`. */
export async function POST(request: NextRequest): Promise<Response> {
  const denied = denyIfNotCron(request);
  if (denied) {
    return denied;
  }

  let body: { brand?: string; brandId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  // 이름으로도 받는다(터미널에서 UUID 를 옮겨적는 건 실수를 부른다).
  let { brandId } = body;
  if (!brandId && body.brand) {
    const found = await database.brand.findFirst({
      where: { name: body.brand },
      select: { id: true },
    });
    if (!found) {
      return Response.json(
        { error: `brand not found: ${body.brand}` },
        { status: 404 }
      );
    }
    brandId = found.id;
  }
  if (!brandId) {
    return Response.json(
      { error: "brandId or brand (name) required" },
      { status: 400 }
    );
  }

  try {
    const started = await startMeasureOne(brandId);
    if (started.skipped) {
      return Response.json(started);
    }

    // 🔴 **기다리지 않는다** — 측정은 최대 298초라 동기로 붙들면 300초 상한에 죽는다
    //   (2026-08-17 실측: 설화수가 `FUNCTION_INVOCATION_TIMEOUT`, 87원만 나감).
    //   고객용 「측정 시작」(`start-tracking.ts`)도 처음부터 이 구조다.
    after(async () => {
      try {
        await runAuditJob({
          brandId: started.brandId,
          brandName: started.brandName,
          domain: started.domain,
          jobId: started.jobId,
          language: "both",
          organizationId: started.organizationId,
        });
      } catch (error) {
        log.error("admin.measure_one.bg_failed", {
          error: String(error),
          jobId: started.jobId,
        });
      }
    });

    return Response.json({
      ...started,
      // 호출자가 결과를 보려면 이 주소를 다시 찌른다(0원).
      pollWith: `GET /api/admin/measure-one?jobId=${started.jobId}&before=${started.trackingBefore}`,
      queued: true,
    });
  } catch (error) {
    log.error("admin.measure_one.failed", {
      brandId,
      error: String(error),
    });
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
