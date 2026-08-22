/*
 * 무료 crew 체험 쿼터 테스트 — 2026-08-12 세션N-25.
 *
 * 🔴 **막는 사고 2가지**
 *   ① **쿼터가 무한이 되는 것** — 비로그인 리드가 crew 를 반복 실행하면 Letsur 크레딧이
 *      샌다. 상한이 "평생 1회"라는 성질을 고정한다.
 *   ② **쿼터가 0이 되는 것**(= 기존 상태로 회귀) — 화면은 *"베타 · 무료"* 라고 광고하는데
 *      서버가 무조건 403 을 뱉던 것이 이번에 고친 결함이다. 되돌아가면 다시
 *      **"무료라고 적힌 버튼이 에러를 뱉는"** 신뢰 파괴 상태가 된다.
 *
 * ⭐ **왜 "평생 1회"이고 "하루 1회"가 아닌가**
 *   이건 원가 방어가 아니라 **미끼**다. 매일 리셋되면 가입할 이유가 사라진다 —
 *   무료가 *"반복 확인할 이유"* 까지 줘버리는 Docker형 실패(📕`UIUX_대개선_기획서:117~136`).
 *   반복 이유는 유료 축(시간·비교·알림)에 남긴다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canRunDeepAnalysis,
  FREE_LEAD_CREW_QUOTA,
  hasFreeCrewQuotaLeft,
} from "@repo/audit/usage-tier";
import { describe, expect, test } from "vitest";

describe("무료 crew 체험 쿼터", () => {
  test("아직 안 쓴 리드는 통과한다 — 0이 되면(=회귀) 실패한다", () => {
    expect(hasFreeCrewQuotaLeft(0)).toBe(true);
  });

  test("이미 1회 쓴 리드는 막힌다 — 무한이 되면 실패한다", () => {
    expect(hasFreeCrewQuotaLeft(1)).toBe(false);
  });

  test("초과 사용분도 막힌다(경계 밖)", () => {
    expect(hasFreeCrewQuotaLeft(2)).toBe(false);
    expect(hasFreeCrewQuotaLeft(99)).toBe(false);
  });

  test("쿼터 상수는 1이다 — 말없이 늘어나면 실패한다", () => {
    // 🔴 숫자를 하드코딩해 대조한다. 상수를 그대로 쓰면(`< FREE_LEAD_CREW_QUOTA`)
    //    값이 100 으로 바뀌어도 테스트가 통과해버린다(= 가드가 호위병이 된다).
    expect(FREE_LEAD_CREW_QUOTA).toBe(1);
  });
});

/*
 * 🔴 쿼터가 **무엇을 세는가** — 라우트의 Prisma 조건을 여기서 문서화·고정한다.
 *
 * 실제 조건: `{ email, crewStartedAt: { not: null }, crewStatus: { not: "failed" } }`
 *
 * ⚠️ `failed` 를 **빼는** 것이 핵심이다. 처음엔 *"실패해도 크레딧은 나갔으니 센다"* 로
 *   짰는데, 그건 어뷰징 방어 관점이고 **정상 고객에게는 배신**이다 — 우리 잘못
 *   (270초 타임아웃·엔진 장애)으로 실패했는데 고객이 체험분을 잃는다.
 *   실패 경로는 실재한다: N-13 실측 최악 crew 가 **226초**로 상한 270초에 가깝다.
 *   이 작업 자체가 *"무료라고 해놓고 배신하지 않기"* 를 고치는 것인데 여기서 같은
 *   성질의 배신을 새로 만들면 앞뒤가 안 맞는다.
 * ⚠️ 실패 반복으로 크레딧을 태우는 어뷰징은 **전역 일일 상한**이 막는다.
 *   쿼터는 어뷰징 방어가 아니라 **체험 관리**가 목적이다(역할을 섞지 않는다).
 *
 * 🔬 아래는 그 세는 규칙을 **같은 형태로 재현**해 회귀를 잡는다. DB 를 붙이지 않는
 *   이유: `apps/web` 에 테스트 러너가 없고, 이 규칙의 본질은 **어떤 행을 세느냐**라는
 *   순수 판정이라 행 목록으로 충분히 고정된다.
 */
interface CrewRow {
  crewStartedAt: Date | null;
  crewStatus: string;
}

// biome: 정규식은 최상위 상수로(프로젝트 규칙 `useTopLevelRegex`).
/** 라우트 쿼터 쿼리가 걸어야 하는 두 조건. */
const Q_STARTED_NOT_NULL = /crewStartedAt:\s*\{\s*not:\s*null\s*\}/;
const Q_STATUS_NOT_FAILED = /crewStatus:\s*\{\s*not:\s*"failed"\s*\}/;
/** import 줄 제외용 — 이름이 import 에만 있어도 통과하던 구멍을 막는다. */
const IMPORT_LINE = /^\s*(import|})/;
/** 헬퍼 **호출** 형태. */
const HELPER_CALL = /hasFreeCrewQuotaLeft\(/;
/** 라우트에 상한 숫자를 하드코딩한 형태(단일진실 붕괴). */
const INLINE_THRESHOLD = /usedCount\s*>=\s*\d/;

/** 라우트의 `where` 절과 **같은 의미**의 필터. 조건이 갈리면 여기서 드러난다. */
function countUsedRuns(rows: CrewRow[]): number {
  return rows.filter(
    (r) => r.crewStartedAt !== null && r.crewStatus !== "failed"
  ).length;
}

describe("쿼터가 세는 대상 — 실패는 체험분을 소모하지 않는다", () => {
  const started = new Date("2026-08-12T00:00:00.000Z");

  test("성공(completed) 1건은 체험분을 쓴 것으로 센다", () => {
    const used = countUsedRuns([
      { crewStartedAt: started, crewStatus: "completed" },
    ]);
    expect(used).toBe(1);
    expect(hasFreeCrewQuotaLeft(used)).toBe(false);
  });

  test("🔴 실패(failed)만 있으면 체험분이 **남아 있다** — 재시도할 수 있어야 한다", () => {
    const used = countUsedRuns([
      { crewStartedAt: started, crewStatus: "failed" },
    ]);
    expect(used).toBe(0);
    expect(hasFreeCrewQuotaLeft(used)).toBe(true);
  });

  test("실행된 적 없는 job(not_requested)은 세지 않는다", () => {
    const used = countUsedRuns([
      { crewStartedAt: null, crewStatus: "not_requested" },
    ]);
    expect(used).toBe(0);
  });

  test("실패 여러 건 + 성공 1건 → 성공만 센다", () => {
    const used = countUsedRuns([
      { crewStartedAt: started, crewStatus: "failed" },
      { crewStartedAt: started, crewStatus: "failed" },
      { crewStartedAt: started, crewStatus: "completed" },
    ]);
    expect(used).toBe(1);
    expect(hasFreeCrewQuotaLeft(used)).toBe(false);
  });

  test("진행 중(processing)도 센다 — 동시에 여러 건 돌리는 것을 막는다", () => {
    const used = countUsedRuns([
      { crewStartedAt: started, crewStatus: "processing" },
    ]);
    expect(used).toBe(1);
  });
});

/*
 * 🔴 위 `countUsedRuns` 는 라우트 쿼리의 **재현**이라, 라우트만 바뀌면 조용히 어긋난다
 *   (프로젝트 교훈: *"같은 수치 계산 코드를 2벌 복제하지 말 것"*).
 *   DB 를 붙일 수 없는 환경이므로, 대신 **라우트 소스가 여전히 같은 조건을 쓰는지**를
 *   정적으로 확인해 두 벌이 갈라지는 것을 잡는다.
 */
describe("라우트 쿼리와 테스트 재현이 어긋나지 않는다", () => {
  const routeSource = readFileSync(
    join(process.cwd(), "../web/app/api/audit/[jobId]/crew/route.ts"),
    "utf8"
  );
  // 주석에도 같은 단어가 나오므로 **실행 코드만** 남기고 본다.
  const codeOnly = routeSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  test("쿼터 쿼리가 crewStartedAt not null + crewStatus not failed 를 함께 건다", () => {
    // 🔴 `failed` 제외가 사라지면(=실패가 체험분을 먹으면) 여기서 실패한다.
    expect(codeOnly).toMatch(Q_STARTED_NOT_NULL);
    expect(codeOnly).toMatch(Q_STATUS_NOT_FAILED);
  });

  test("쿼터 판정은 공용 헬퍼를 **호출**한다 — 라우트에서 직접 숫자 비교하면 실패", () => {
    // 🔴 이 단정은 한 번 뚫렸다: 처음엔 `toContain("hasFreeCrewQuotaLeft")` 였는데
    //    **import 줄에도 그 이름이 있어서**, 판정을 `usedCount >= 1` 로 바꿔도 통과했다.
    //    → import 를 제외한 뒤 **호출 형태**(`hasFreeCrewQuotaLeft(`)로 확인한다.
    //    🎓 프로젝트 교훈 그대로 — 존재 검사만 하는 가드는 호위병이 된다.
    const withoutImports = codeOnly
      .split("\n")
      .filter((l) => !(IMPORT_LINE.test(l) || l.includes('from "@repo/')))
      .join("\n");
    expect(withoutImports).toMatch(HELPER_CALL);
    // 상한 숫자를 라우트에 하드코딩하면 단일진실이 깨진다.
    expect(withoutImports).not.toMatch(INLINE_THRESHOLD);
  });
});

describe("canRunDeepAnalysis — 쿼터와 무관하게 항상 통과하는 대상", () => {
  test("로그인 워크스페이스(org:)는 통과한다", () => {
    // 🔴 이게 깨지면 유료 고객 본인이 자기 심층분석에 막힌다(2026-07-30 실제 사고).
    expect(canRunDeepAnalysis("org:org_abc123")).toBe(true);
  });

  test("일반 리드는 자격 판정에서는 걸린다 — 쿼터가 따로 판단한다", () => {
    // 자격(순수 판정)과 쿼터(DB 조회)를 분리한 설계를 고정한다.
    expect(canRunDeepAnalysis("lead@example.com")).toBe(false);
  });

  test("⚠️ 결제 여부는 보지 않는다 — 실질은 '로그인 게이트'다", () => {
    // 이 성질을 모르고 화면에 "유료 플랜에서 이용" 이라 쓰면 **거짓 표기**가 된다.
    // (세션N-25 이전 403 문구가 실제로 그 상태였다.)
    // org 접두사만 있으면 plan 이 free 여도 통과한다 = 결제와 무관하다.
    expect(canRunDeepAnalysis("org:free_plan_org")).toBe(true);
  });
});
