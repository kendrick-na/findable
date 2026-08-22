/*
 * `/api/audit/[jobId]` 가 이메일을 **소유자에게만** 주는가 — 2026-08-12 세션N-26.
 *
 * 🔴 **막는 사고**: `isAuditOwner` 가 아무리 옳아도 라우트가 그걸 **안 쓰면**
 *   이메일은 그대로 샌다. 순수함수 테스트만 있으면
 *   "테스트 전부 통과 · 실제로는 여전히 전원에게 노출"이 된다.
 *
 * ⚠️ 왜 정적 검사인가: 이 라우트는 `apps/web` 에 있고 **그 앱엔 테스트 러너가 없다**.
 *   라이브로 확인하려면 남의 실제 jobId 가 필요한데 그건 만들 수 없다.
 *   → 소스를 읽어 **게이트가 존재하고 우회 경로가 없는지**를 구조로 고정한다.
 *
 * 🔴 **존재 검사 금지** — 이름만 찾으면 `import` 줄이 만족시켜 통과한다.
 *   여기서는 **호출 형태**와 **조건부 전개**로 판정한다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROUTE_PATH = join(
  import.meta.dirname,
  "../../web/app/api/audit/[jobId]/route.ts"
);

/*
 * 세션 읽기(`auth()`·fail-closed)는 **공용 헬퍼**로 옮겨졌다(2026-08-13 세션N-26) —
 * `[jobId]/route.ts`(이메일 노출)와 `crew/route.ts`(심층분석 자격)가 같은 판정을
 * 쓰므로, 복사하면 한쪽만 고쳐지는 상태가 된다.
 * → 라우트에는 **게이트 배선**을, 헬퍼에는 **세션·fail-closed 규율**을 각각 고정한다.
 */
const OWNER_LIB_PATH = join(
  import.meta.dirname,
  "../../web/app/api/audit/_lib/owner.ts"
);

/** 주석·import 를 걷어낸 실제 코드 — 주석의 안심 문구가 통과시키지 않도록. */
const stripToCode = (raw: string): string =>
  raw
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !(
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("import")
      );
    })
    .join("\n");

const code = stripToCode(readFileSync(ROUTE_PATH, "utf8"));
const ownerLibCode = stripToCode(readFileSync(OWNER_LIB_PATH, "utf8"));

// biome: 정규식은 최상위 상수로(매 호출 재컴파일 방지).
const CALLS_RESOLVE_OWNER = /resolveIsOwner\s*\(/;
/** 헬퍼가 **판정 규칙**(순수함수)을 실제로 호출한다. */
const LIB_CALLS_IS_OWNER = /isAuditOwner\s*\(/;
const GATED_EMAIL_MASKED =
  /\.\.\.\(\s*isOwner[\s\S]{0,400}?emailMasked:\s*maskEmail\(/;
const GATED_EMAIL_DOMAIN = /\.\.\.\(\s*isOwner[\s\S]{0,400}?emailDomain:/;
const EMAIL_MASKED_ANY = /emailMasked/g;
const EMAIL_DOMAIN_ANY = /emailDomain/g;
const FAIL_CLOSED_CATCH = /catch[\s\S]{0,300}?return false/;
const ANON_IS_NOT_OWNER = /if\s*\(\s*!userId\s*\)\s*\{\s*return false/;
const SELECTS_ORG_ID = /organizationId:\s*true/;

describe("audit [jobId] 라우트 — 이메일 소유자 게이트", () => {
  test("🔴 라우트가 소유 판정을 **호출**한다(import 줄만으로는 통과 못 함)", () => {
    // 라우트는 공용 헬퍼를 부른다. 판정 규칙 자체는 `_lib/owner.ts` 에 있다.
    expect(code).toMatch(CALLS_RESOLVE_OWNER);
  });

  test("🔴 `emailMasked` 가 **무조건** 응답에 들어가지 않는다", () => {
    // 예전 코드: `emailMasked: maskEmail(job.email),` 가 최상위에 그냥 있었다.
    // 이제는 소유 판정에 걸린 전개 안에만 있어야 한다.
    expect(code).toMatch(GATED_EMAIL_MASKED);
  });

  test("🔴 `emailMasked` 등장은 조건부 블록 **한 곳뿐**", () => {
    // 조건부로 넣어놓고 다른 데서 또 넣으면 게이트가 무의미해진다.
    const occurrences = code.match(EMAIL_MASKED_ANY) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  test("🔴 `emailDomain`(전체 도메인)도 같은 게이트 안에 있다", () => {
    // 마스킹 이메일만 막고 도메인을 그대로 주면 반쪽 방어다.
    const occurrences = code.match(EMAIL_DOMAIN_ANY) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(code).toMatch(GATED_EMAIL_DOMAIN);
  });

  test("소유 판별에 필요한 `organizationId` 를 실제로 select 한다", () => {
    // select 에 없으면 항상 undefined 라 조직 소유자가 조용히 탈락한다.
    expect(code).toMatch(SELECTS_ORG_ID);
  });
});

/*
 * 🔒 공용 헬퍼(`_lib/owner.ts`)의 규율 — **두 라우트가 공유**하므로 여기가 뚫리면
 *   이메일 노출과 심층분석 자격이 **동시에** 뚫린다.
 */
describe("_lib/owner — 세션 판정 규율", () => {
  test("🔴 판정 규칙(`isAuditOwner` 순수함수)을 **호출**한다", () => {
    // 헬퍼가 자체 규칙을 새로 짜면 대시보드와 갈린다.
    expect(ownerLibCode).toMatch(LIB_CALLS_IS_OWNER);
  });

  test("🔴 판정 실패 시 **비소유로 닫힌다**(fail-closed)", () => {
    // catch 안에서 true 를 돌려주면 판별 불가 상황이 곧 노출·과잉개방이 된다.
    expect(ownerLibCode).toMatch(FAIL_CLOSED_CATCH);
  });

  test("🔴 비로그인(`userId` 없음)이면 소유자가 아니다", () => {
    // audit 라우트는 비로그인 접근이 정상이라, 세션 없음을 통과시키면 검사가 무의미해진다.
    expect(ownerLibCode).toMatch(ANON_IS_NOT_OWNER);
  });
});
