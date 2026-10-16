// /api/admin/client-reports/revenue — 「회사 카드 매출 불러오기」 미리보기(읽기 전용, DB 쓰기 0).
//
// 🔒 운영자(admin) 전용. 값을 리포트에 넣는 것은 화면에서 사람이 「JSON에 넣기」를 눌렀을 때뿐이다.

import { requireAdmin } from "@repo/auth/admin";
import { NextResponse } from "next/server";
import { z } from "zod";
import { previewRevenueLink } from "@/lib/client-report/revenue-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const BodySchema = z.object({
  auditJobId: z.uuid(),
  companyId: z.uuid().nullish(),
  review: z.unknown().optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json(
      { error: "forbidden" },
      { headers: NO_STORE, status: 403 }
    );
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body" },
      { headers: NO_STORE, status: 400 }
    );
  }
  const result = await previewRevenueLink(parsed.data);
  return NextResponse.json(result, { headers: NO_STORE });
}
