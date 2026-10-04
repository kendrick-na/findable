// 운영자 점검 CLI 전용 클라이언트 생성기.
// `@repo/database` 기본 진입점은 `server-only`·런타임 env 선택을 포함하므로, 점검 CLI는
// 명시한 연결 하나로 단일 커넥션 클라이언트를 만든다. 읽기 전용 보장은 호출부의
// `SET TRANSACTION READ ONLY` 가 맡는다.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";

export function createInspectionClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }),
  });
}
