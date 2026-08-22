import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7: seed는 package.json이 아니라 여기 migrations.seed에 둔다.
    // ⚠️ 실측(2026-07-29): 이 repo는 `prisma db seed`(tsx) 방식이 **안 통한다**.
    //   - tsx/ts-node 미설치.
    //   - Node --experimental-strip-types도 실패: generated/client 내부가 확장자 없는
    //     상대 import(`./enums`)라 순수 Node ESM이 해석 못 함(Prisma 생성물이라 수정 불가).
    //   ✅ 검증된 실제 seed 방식 = 순수 SQL(neon sql.query) 인라인 스크립트.
    //      Engine은 단순 테이블이라 INSERT ... ON CONFLICT (id) DO UPDATE로 upsert.
    //      실행 로그: docs/_적용/20번_...설계.md "라이브 실측" 참조. seed.ts는 미래
    //      tsx 도입 시를 위한 참조 사본으로 남겨둠(현재 실행 경로 아님).
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    /*
     * 🔴 마이그레이션(DDL)은 **직접 연결**로 간다 — pooler 경유 금지.
     *
     * `DATABASE_URL` 은 `-pooler` 엔드포인트(PgBouncer)다. 런타임 쿼리엔 맞지만
     * Neon 은 **DDL 에 직접(non-pooled) 엔드포인트를 요구**한다. 여기서 읽는 값이
     * 곧 Prisma CLI 가 마이그레이션에 쓰는 연결이라, pooler 를 물리면 스키마 변경이
     * 트랜잭션·prepared statement 문제로 이상하게 실패할 수 있다.
     *
     * `DATABASE_URL_UNPOOLED` 는 Neon 통합이 **이미 넣어주는 값**이다(실측 확인).
     * 없는 환경(로컬 커스텀 등)을 위해 `DATABASE_URL` 로 폴백한다 — 폴백이 곧
     * 기존 동작이라 더 나빠지지 않는다.
     *
     * ⚠️ 런타임 클라이언트(`index.ts` 의 PrismaNeon)는 계속 `DATABASE_URL`(pooled)을
     *   쓴다. 서버리스에서 커넥션 고갈을 막는 쪽이라 **바꾸면 안 된다**. 축이 다르다:
     *   런타임 = pooled / 마이그레이션 = direct.
     */
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
