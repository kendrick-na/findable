// /api/export/tracking.csv — 내 측정 데이터 CSV 내보내기 (감사 D7)
//
// 왜 만드나: 15개 경쟁 툴 중 5곳이 CSV export 를 제공한다(감사 §벤치마킹 격차).
//   그리고 이 기능은 **측정이 1회뿐이어도 값이 난다** — 1행짜리 CSV 도 유효한 CSV 다.
//   (시계열이 쌓여야 의미가 생기는 기간 선택·이벤트 핀과 구분되는 지점.)
//
// 🔴 보안 계약: `Tracking` 은 **organizationId 컬럼이 없다**(brand 경유로만 org 에 매인다).
//   org 필터 없이 직접 쿼리하면 **다른 조직 데이터가 샌다** → 반드시 `scopedTracking()` 경유.
//   (`apps/app/lib/db/scoped.ts` 파일 상단 경고. brandId 를 URL 로 찔러도 그 헬퍼가
//    현재 org 소속인지 함께 검증한다.)

import { planFromPublicMetadata } from "@repo/auth/plan";
import { currentUser } from "@repo/auth/server";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { scopedTrackingForExport } from "@/lib/db/scoped";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Excel 이 UTF-8 을 자동 인식하지 못해 한글이 깨지는 문제 방어(BOM).
//   한국 고객이 받는 파일이라 필수 — 없으면 "설화수"가 "�ㅼ빀��"로 열린다.
const UTF8_BOM = "﻿";

const BASE_HEADERS = [
  "측정일시",
  "브랜드",
  "도메인",
  "엔진",
  "언급됨",
  "언급순위",
  // 세션N-10: 순위의 분모. 이게 없으면 "1위"가 2개 중인지 50개 중인지 알 수 없다.
  "목록항목수",
  "감성",
  "점유율",
] as const;

const SOURCES_HEADER = "인용출처";

// RICE#5 — 내보내기 확인 모달의 기간 옵션. 값은 일수, "all"은 필터 없음.
const PERIOD_DAYS: Record<string, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};

function sinceDateFor(period: string): Date | undefined {
  const days = PERIOD_DAYS[period];
  if (!days) {
    return;
  }
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

// citedSources = [{ url, domain, title? }] (Tracking.citedSources 의 JSON 스키마).
function citedSourceUrls(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((entry) =>
      typeof entry === "object" && entry !== null && "url" in entry
        ? String((entry as { url: unknown }).url)
        : ""
    )
    .filter(Boolean)
    .join(" | ");
}

// CSV 인젝션 방어 — `=`·`+`·`-`·`@` 로 시작하는 셀은 Excel 이 **수식으로 실행**한다.
//   측정 데이터에 브랜드명·도메인이 그대로 들어가므로 방어가 필요하다.
const FORMULA_LEAD = /^[=+\-@\t\r]/;
// 쉼표·따옴표·개행이 있으면 따옴표로 감싼다(RFC 4180).
const NEEDS_QUOTING = /[",\n\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = String(value);
  const safe = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const SENTIMENT_KO: Record<string, string> = {
  positive: "긍정",
  neutral: "보통",
  negative: "부정",
};

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 게이팅: 내보내기는 유료 기능(감사 §경계선 설계 — Profound Starter 와 같은 선).
    //   ⚠️ 요금제 표기와 실제 게이트가 어긋나면 "없는 기능 판매"가 된다(세션N-7 커밋 0d3d409).
    //   그래서 여기서 막는 대신 화면에서도 같은 기준으로 잠근다.
    const plan = planFromPublicMetadata(
      user.publicMetadata as Record<string, unknown> | null | undefined
    );
    if (plan === "free") {
      return new Response("Upgrade required", { status: 402 });
    }

    const params = new URL(request.url).searchParams;
    const brandId = params.get("brandId") ?? undefined;
    const period = params.get("period") ?? "30";
    const includeSources = params.get("includeSources") === "1";

    // org 필터는 이 헬퍼가 강제한다(brandId 를 찔러도 org 소속 검증됨).
    const rows = await scopedTrackingForExport(brandId, sinceDateFor(period));

    const headers = includeSources
      ? [...BASE_HEADERS, SOURCES_HEADER]
      : BASE_HEADERS;
    const lines = [headers.join(",")];
    for (const row of rows) {
      const cells = [
        row.trackedAt.toISOString(),
        row.brand.name || row.brand.domain,
        row.brand.domain,
        row.engineId,
        row.brandMentioned ? "예" : "아니오",
        row.mentionPosition ?? "",
        row.mentionListSize ?? "",
        row.sentiment ? (SENTIMENT_KO[row.sentiment] ?? row.sentiment) : "",
        row.shareOfVoice === null ? "" : Math.round(row.shareOfVoice * 100),
      ];
      if (includeSources) {
        cells.push(citedSourceUrls(row.citedSources));
      }
      lines.push(cells.map(csvCell).join(","));
    }

    log.info("export.csv", {
      brandId,
      includeSources,
      period,
      rows: rows.length,
      userId: user.id,
    });

    // 파일명에 날짜를 넣어 여러 번 받아도 덮어쓰지 않게 한다.
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(UTF8_BOM + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="findable-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    log.error("export.csv_failed", { error: parseError(error) });
    return new Response("Export failed", { status: 500 });
  }
}
