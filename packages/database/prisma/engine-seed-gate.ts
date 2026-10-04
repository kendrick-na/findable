// Engine seed 읽기 전용 게이트 (W0-3).
//
// persistAuditTracking 은 성공 응답 엔진 중 하나라도 Engine 행이 없으면 Tracking 전체를
// 실패 처리한다(부분 완료 금지). 그래서 배포 전에 대상 DB에 seed가 전부 있는지
// **쓰기 없이** 확인할 수단이 필요하다. 이 모듈은 Engine id만 읽고, 값·URL은 출력하지 않는다.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";

export interface EngineSeedVerdict {
  missing: string[];
  ok: boolean;
}

export function evaluateEngineSeed(
  rows: ReadonlyArray<{ id: string }>,
  required: readonly string[]
): EngineSeedVerdict {
  const present = new Set(rows.map((row) => row.id));
  const missing = [...new Set(required)]
    .filter((id) => !present.has(id))
    .sort();
  return { ok: missing.length === 0, missing };
}

export async function readEngineSeedState(
  connectionString: string,
  required: readonly string[]
): Promise<EngineSeedVerdict> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }),
  });
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      // Deliberately no ?schema= handling: the runtime client (PrismaPg) ignores
      // it and reads "public"."Engine", so the gate must look where Tracking does.
      return tx.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM "public"."Engine"'
      );
    });
    return evaluateEngineSeed(rows, required);
  } finally {
    await prisma.$disconnect();
  }
}
