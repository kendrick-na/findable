// apps/app 운영 빌드 게이트 — 탈퇴 표식 표(DeletedClerkUser)가 운영 DB 에 없으면 **빌드를 실패**시킨다 (2026-10-20).
//
// 왜: 앱은 그 표가 없으면 Clerk 웹훅을 전부 500 으로 돌린다(fail-closed). 사람이 「마이그레이션 먼저」를 잊어도
//   운영 빌드가 실패하면 Vercel 은 **이전 정상 배포를 그대로 유지**한다.
// 규칙
//  - VERCEL_ENV === "production" 일 때만 검사. 미리보기·로컬 빌드는 건너뛰고 한 줄 로그만.
//  - 검사 대상 DB = 앱 런타임과 같은 규칙(FINDABLE_DATABASE_URL 우선, 없으면 DATABASE_URL — `keys.ts`).
//  - 운영에서 표가 없거나, DB 주소가 없거나, 접속·조회가 실패하면 → 실패(exit 1). (fail-closed)
//  - 읽기 전용(`readPrivacyTables`: READ ONLY 트랜잭션 + information_schema). 연결 문자열은 출력하지 않는다.
// 호출: apps/app `build` 스크립트(`bun ../../packages/database/scripts/privacy-build-gate.ts`).

import { resolveDatabaseUrl } from "../keys";
import { safeErrorLabel } from "../prisma/db-target-fingerprint";
import {
  type PrivacyTableVerdict,
  readPrivacyTables,
} from "./privacy-table-gate";

export type GateDecision =
  | { action: "skip"; message: string }
  | { action: "pass"; message: string }
  | { action: "fail"; message: string };

type Env = Record<string, string | undefined>;

/** 운영 빌드에서만 검사한다. */
export const shouldCheck = (env: Env): boolean =>
  env.VERCEL_ENV === "production";

/**
 * 검사에 쓸 연결 문자열 — **앱 런타임과 같은 규칙**(`keys.ts` 의 `resolveDatabaseUrl`:
 * FINDABLE_DATABASE_URL 우선, 없으면 DATABASE_URL). 빈 값은 없음으로 본다.
 */
export const gateConnectionString = (env: Env): string | undefined =>
  resolveDatabaseUrl(env)?.trim() || undefined;

/**
 * 게이트 판정(입출력 없음 — 시험 대상).
 * @param read 표 조회 함수(운영에서만 불린다).
 */
export async function decidePrivacyBuildGate(
  env: Env,
  read: (connectionString: string) => Promise<PrivacyTableVerdict>
): Promise<GateDecision> {
  if (!shouldCheck(env)) {
    return {
      action: "skip",
      message: `[privacy-build-gate] skip (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})`,
    };
  }
  const connectionString = gateConnectionString(env);
  if (!connectionString) {
    return {
      action: "fail",
      message:
        "[privacy-build-gate] FAIL: DB 주소 없음(FINDABLE_DATABASE_URL·DATABASE_URL 둘 다 비어 있음) — 운영 빌드에서 표 존재를 확인할 수 없어 중단",
    };
  }
  try {
    const verdict = await read(connectionString);
    if (!verdict.ok) {
      return {
        action: "fail",
        message: `[privacy-build-gate] FAIL: 필수 표 없음 ${JSON.stringify(verdict.missing)} (schema=${verdict.schema}) — 마이그레이션을 먼저 적용하세요`,
      };
    }
    return {
      action: "pass",
      message: `[privacy-build-gate] ok ${JSON.stringify(verdict.present)}`,
    };
  } catch (error) {
    return {
      action: "fail",
      message: `[privacy-build-gate] FAIL: DB 조회 실패 ${safeErrorLabel(error)} — 확인 불가라 중단(fail-closed)`,
    };
  }
}

async function main(): Promise<void> {
  const decision = await decidePrivacyBuildGate(process.env, readPrivacyTables);
  const out = decision.action === "fail" ? process.stderr : process.stdout;
  out.write(`${decision.message}\n`);
  if (decision.action === "fail") {
    process.exitCode = 1;
  }
}

// 시험에서 import 할 때는 실행하지 않는다(직접 실행된 경우에만).
if (process.argv[1]?.endsWith("privacy-build-gate.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `[privacy-build-gate] FAIL: ${safeErrorLabel(error)}\n`
    );
    process.exitCode = 1;
  });
}
