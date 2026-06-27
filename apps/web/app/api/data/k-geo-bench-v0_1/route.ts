// K-GEO-Bench v0.1 데이터셋 다운로드 API (D-056, 2026-05-08)
//
// public/data/*.jsonl이 i18n proxy에 가로채여 HTML 반환되는 문제 회피.
// API 라우트는 proxy matcher의 'api' 제외에 자동 포함됨.
//
// 사용:
//   /api/data/k-geo-bench-v0_1            → JSONL 기본
//   /api/data/k-geo-bench-v0_1?format=json → JSON 단일 파일

import { readFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") ?? "jsonl";

  const filename =
    format === "json" ? "k-geo-bench-v0_1.json" : "k-geo-bench-v0_1.jsonl";
  const contentType =
    format === "json" ? "application/json" : "application/x-ndjson";

  try {
    const filePath = path.join(process.cwd(), "public", "data", filename);
    const content = await readFile(filePath, "utf-8");

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Dataset not found",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 404 }
    );
  }
}
