/**
 * 관리자 측정 콘솔의 **위험한 부분만** 검사한다 (2026-08-17 세션N-37).
 *
 * 🔴 여기서 검사하는 건 "화면이 예쁜가"가 아니라 **되돌릴 수 없는 일이 실수로 벌어지는가**다.
 *   ① 삭제는 이름이 정확히 일치할 때만 실행된다
 *   ② 측정·삭제·수정 **모든** 서버액션이 `requireAdmin()` 으로 시작한다
 *   ③ 측정 API 는 인증 없이 열리지 않는다
 *
 * ⚠️ **가드는 뮤테이션으로 무는지 확인했다**(이 저장소에서 가드가 5번 뚫린 이력이 있다).
 *   §"뮤테이션 확인" 주석에 무엇을 어떻게 깨뜨려 봤는지 남긴다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS_PATH = join(process.cwd(), "app/actions/admin/measure.ts");
const API_PATH = join(
  process.cwd(),
  "../web/app/api/admin/measure-one/route.ts"
);
const CONSOLE_PATH = join(
  process.cwd(),
  "app/(authenticated)/admin/measure/measure-console.tsx"
);

const actions = readFileSync(ACTIONS_PATH, "utf8");
const api = readFileSync(API_PATH, "utf8");
const console_ = readFileSync(CONSOLE_PATH, "utf8");

/** 주석을 걷고 **실행되는 코드만** 남긴다(줄머리·줄끝 주석 모두 — N-36 에 줄끝으로 뚫렸다). */
function stripToCode(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      // 문자열 리터럴 안의 `//` 는 보존해야 하므로 따옴표 밖에서만 자른다.
      let inSingle = false;
      let inDouble = false;
      let inTick = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        const prev = line[i - 1];
        if (prev === "\\") {
          continue;
        }
        if (c === "'" && !(inDouble || inTick)) {
          inSingle = !inSingle;
        } else if (c === '"' && !(inSingle || inTick)) {
          inDouble = !inDouble;
        } else if (c === "`" && !(inSingle || inDouble)) {
          inTick = !inTick;
        } else if (
          c === "/" &&
          line[i + 1] === "/" &&
          !(inSingle || inDouble || inTick)
        ) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .filter((line) => !line.trimStart().startsWith("*"))
    .join("\n");
}

const actionsCode = stripToCode(actions);
const apiCode = stripToCode(api);
const consoleCode = stripToCode(console_);

describe("삭제 가드 — 되돌릴 수 없는 작업", () => {
  it("이름이 정확히 일치하지 않으면 지우지 않는다", () => {
    // 뮤테이션 확인: `!==` 를 `===` 로 뒤집으면 이 검사가 깨진다(확인함).
    expect(actionsCode).toMatch(/confirmName\.trim\(\)\s*!==\s*brand\.name/);
    // 비교 **이후에** 삭제가 오는지 — 순서가 뒤집히면 확인이 장식이 된다.
    const guardAt = actionsCode.indexOf("confirmName.trim()");
    const deleteAt = actionsCode.indexOf("database.brand.delete");
    expect(guardAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(guardAt);
  });

  it("삭제 버튼은 이름이 일치할 때만 눌린다", () => {
    // 뮤테이션 확인: `disabled` 에서 confirmName 조건을 빼면 이 검사가 깨진다(확인함).
    expect(consoleCode).toMatch(
      /disabled=\{[^}]*confirmName\.trim\(\)\s*!==\s*target\?\.name[^}]*\}/
    );
  });

  it("측정 이력(AuditJob)은 지우지 않고 연결만 끊는다", () => {
    // 감사 기록은 브랜드보다 오래 남아야 한다 — deleteMany 로 바뀌면 깨진다.
    expect(actionsCode).not.toMatch(/auditJob\.deleteMany/);
    expect(actionsCode).toMatch(/auditJob\.updateMany/);
  });
});

describe("권한 가드 — 서버에서 재확인", () => {
  it("모든 export 된 서버액션이 requireAdmin 을 부른다", () => {
    // 함수 단위로 쪼개서 **건별로** 센다(파일에 한 번만 있어도 통과하던 실수 방지).
    const fns = actionsCode
      .split(/export async function /)
      .slice(1)
      .map((chunk) => ({
        body: chunk.slice(0, chunk.indexOf("\n}")),
        name: chunk.slice(0, chunk.indexOf("(")),
      }));

    expect(fns.length).toBeGreaterThanOrEqual(5);
    for (const fn of fns) {
      expect(
        fn.body.includes("requireAdmin()"),
        `${fn.name} 에 requireAdmin() 이 없다`
      ).toBe(true);
    }
  });

  it("측정 API 는 GET·POST 둘 다 인증으로 막는다", () => {
    const get = apiCode.slice(
      apiCode.indexOf("export async function GET"),
      apiCode.indexOf("export async function POST")
    );
    const post = apiCode.slice(apiCode.indexOf("export async function POST"));
    expect(get).toMatch(/denyIfNotCron\(request\)/);
    expect(post).toMatch(/denyIfNotCron\(request\)/);
    // 🔴 되살리면 안 되는 폴백 — 이 헤더는 외부에서 붙일 수 있다.
    expect(apiCode).not.toMatch(/x-vercel-cron/);
  });

  it("인증 검사가 측정(원가 발생)보다 먼저 온다", () => {
    const post = apiCode.slice(apiCode.indexOf("export async function POST"));
    const authAt = post.indexOf("denyIfNotCron");
    const measureAt = post.indexOf("startMeasureOne");
    expect(authAt).toBeGreaterThan(-1);
    expect(measureAt).toBeGreaterThan(authAt);
  });
});

describe("타임아웃 가드 — 2026-08-17 실측으로 한 번 터졌다", () => {
  // 🔴 측정은 최대 298초인데 함수 상한이 300초다. 동기로 기다리면 죽는다
  //   (설화수 `FUNCTION_INVOCATION_TIMEOUT` — 87원만 나가고 시계열 0 증가).
  it("API 는 측정을 after() 백그라운드로 넘긴다", () => {
    expect(apiCode).toMatch(/after\(/);
    // 뮤테이션 확인: `after(` 를 빼고 `await runAuditJob` 로 되돌리면 깨진다.
    const post = apiCode.slice(apiCode.indexOf("export async function POST"));
    const afterAt = post.indexOf("after(");
    const runAt = post.indexOf("runAuditJob");
    expect(afterAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(afterAt);
  });

  it("서버액션도 after() 로 넘긴다", () => {
    const fn = actionsCode.slice(
      actionsCode.indexOf("export async function runMeasureOne")
    );
    const afterAt = fn.indexOf("after(");
    const runAt = fn.indexOf("runAuditJob");
    expect(afterAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(afterAt);
  });

  it("폴링 상한이 있다 — 무한 폴링 금지", () => {
    expect(consoleCode).toMatch(/deadline/);
  });
});

describe("원가 가드", () => {
  it("한 요청에 여러 건을 돌리는 입구가 없다", () => {
    // 배열·전체 실행을 받으면 실수로 전 브랜드가 돈다(원가 폭주).
    expect(apiCode).not.toMatch(/brandIds/);
    expect(apiCode).not.toMatch(/measureAll|runAll/);
  });

  it("측정 전에 사람 확인을 받는다", () => {
    expect(consoleCode).toMatch(/window\.confirm/);
    // 확인 문구에 원가가 들어가야 한다 — 얼마 나가는지 모르고 누르면 안 된다.
    expect(consoleCode).toMatch(/COST_KRW/);
  });
});
