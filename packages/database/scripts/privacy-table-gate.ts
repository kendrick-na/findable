// 배포 게이트 — 개인정보 처리에 필요한 표가 대상 DB 에 있는지 **읽기만** 해서 확인한다 (2026-10-20).
//
// 왜: 앱은 `DeletedClerkUser`(탈퇴 표식) 표가 없으면 Clerk 웹훅(가입·수정·탈퇴·조직 연결)을 전부 500 으로
//   돌린다(fail-closed). 그래서 **마이그레이션 적용 확인 → 배포** 순서를 사람 기억이 아니라 이 점검으로 고정한다.
// 방식: READ ONLY 트랜잭션에서 information_schema.tables 만 조회. 쓰기 0, 데이터 0, 연결 문자열 출력 0.

import { createPrismaClient } from "../create-client";
import { connectionSchema } from "../prisma/db-target-fingerprint";

/** 이 앱이 웹훅을 처리하려면 반드시 있어야 하는 표. 새로 추가하면 여기에도 적는다. */
export const REQUIRED_PRIVACY_TABLES = ["DeletedClerkUser"] as const;

export interface PrivacyTableVerdict {
  missing: string[];
  ok: boolean;
  present: string[];
  schema: string;
}

/** 순수 판정: 조회된 표 이름 목록에서 빠진 필수 표를 찾는다. */
export function evaluatePrivacyTables(
  schema: string,
  foundTableNames: readonly string[],
  required: readonly string[] = REQUIRED_PRIVACY_TABLES
): PrivacyTableVerdict {
  const found = new Set(foundTableNames);
  const present = required.filter((t) => found.has(t));
  const missing = required.filter((t) => !found.has(t));
  return { schema, present, missing, ok: missing.length === 0 };
}

/** DB 연결 시도 제한(ms). 넘으면 pg 가 연결 오류를 낸다. */
export const PRIVACY_GATE_CONNECT_TIMEOUT_MS = 10_000;

export async function readPrivacyTables(
  connectionString: string
): Promise<PrivacyTableVerdict> {
  const schema = connectionSchema(connectionString);
  // 🔴 런타임과 **같은 함수**로 만든다(Supabase sslmode 제거 + CA 고정 + max 1). 직접 new PrismaClient/PrismaPg 금지 —
  //   2026-10-20 운영 빌드가 여기서 TLS 검증 실패(P1011)로 막혔던 원인이다.
  const prisma = createPrismaClient(connectionString, {
    connectionTimeoutMillis: PRIVACY_GATE_CONNECT_TIMEOUT_MS,
  });
  try {
    const rows = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return tx.$queryRaw<{ table_name: string }[]>`
          SELECT table_name FROM information_schema.tables
           WHERE table_schema = ${schema}
             AND table_name = ANY(${[...REQUIRED_PRIVACY_TABLES]})`;
      },
      { maxWait: 20_000, timeout: 30_000 }
    );
    return evaluatePrivacyTables(
      schema,
      rows.map((r) => r.table_name)
    );
  } finally {
    await prisma.$disconnect();
  }
}
