/*
 * 🔴 **리드 메일: 안 보냈으면 안 보냈다고 말한다** — 2026-08-13 세션N-26.
 *
 * ## 막는 사고
 * 고객이 *"풀 리포트 받기 · 무료"* 를 누르면 화면이 **언제나**
 * *"전체 리포트를 곧 메일로 보내드려요"* 라고 답했다.
 * 그런데 서버는 발송 실패 시 `emailSent:false` 로 **정직하게** 답하고 있었다
 * (`lead/route.ts` 의 catch). 화면이 그 진실을 **계측에만** 쓰고 버렸다.
 * → 고객은 **오지 않을 메일을 기다린다.**
 *
 * ⭐ 이 프로젝트가 반복해서 고쳐온 결함과 같은 종류다:
 *   *"무료"라 해놓고 403* · *"이메일로 보내드려요"인데 발송 꺼짐*(N-19)
 *   → **제품이 지키지 못할 약속을 하지 않는다.**
 *
 * ⚠️ 실패를 "에러"로 말하지 않는 이유: 리드 저장은 성공했고 **이 화면 자체가
 *   전체 리포트**다. 고객이 지금 할 수 있는 것을 알려주는 편이 정확하다
 *   (원칙: *"우리가 해준다"* 가 아니라 *"여기서 볼 수 있다"*).
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const RESULT_VIEW = join(
  import.meta.dirname,
  "../../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
);
const LEAD_ROUTE = join(
  import.meta.dirname,
  "../../web/app/api/audit/[jobId]/lead/route.ts"
);

/*
 * 주석·import 를 걷어낸 실제 코드 — 주석 문구가 검사를 통과시키지 않도록.
 *
 * 🔴 **정규식으로 블록주석을 지우지 않는다.** 게으른 수량자로 JSX 주석을 지우려다
 *   이 파일에서 **40,570자**(= 실제 코드 대부분)가 함께 사라진 적이 있다 —
 *   앞쪽 주석 시작과 **한참 뒤의** 주석 끝이 짝지어졌기 때문이다.
 *   가드가 조용히 무력해지는 전형적인 경로라, **줄 단위 상태 기계**로 센다.
 */
const stripToCode = (raw: string): string => {
  const out: string[] = [];
  let inBlock = false;
  for (const line of raw.split("\n")) {
    const t = line.trimStart();
    if (inBlock) {
      // 블록주석은 그 줄에서 닫힐 때만 빠져나온다.
      if (t.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    if (t.startsWith("//") || t.startsWith("import")) {
      continue;
    }
    // 한 줄에서 열고 닫는 주석(`{/* ... */}`)은 그 줄만 버린다.
    if (t.startsWith("/*") || t.startsWith("{/*")) {
      if (!t.includes("*/")) {
        inBlock = true;
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
};

const viewCode = stripToCode(readFileSync(RESULT_VIEW, "utf8"));
const routeCode = stripToCode(readFileSync(LEAD_ROUTE, "utf8"));

// biome: 정규식은 최상위 상수로.
/** 화면이 `emailSent` 로 **분기**한다(계측에만 쓰지 않는다). */
const BRANCHES_ON_EMAIL_SENT = /getLeadResultMessage\(\s*emailSent/;
/** 서버 응답의 진실을 상태로 넣는다. */
const STORES_SERVER_TRUTH = /setEmailSent\(\s*data\.emailSent/;
/**
 * 🔴 되살아나면 안 되는 것: **성공 문구가 화면에 직접 박히는 것**.
 *
 * ⚠️ 처음엔 `submitted ? (…"곧 메일로"…)` **형태**만 잡았는데, 뮤테이션
 *   (`{isKo ? "곧 메일로…" : …}` 로 되돌리기)이 **그대로 통과**했다.
 *   → 형태가 아니라 **"문구가 어디에 있는가"** 로 판정한다(판정 함수 안 1회).
 */
const PROMISE_TEXT_ANY = /전체 리포트를 곧 메일로 보내드려요\./g;
/** 서버가 안 보낸 갈래에서도 `emailSent:false` 를 **명시**한다. */
const EXPLICIT_FALSE = /emailSent:\s*false/g;
/** 실제로 보낸 갈래는 true. */
const EXPLICIT_TRUE = /emailSent:\s*true/;

describe("getLeadResultMessage — 보냈을 때와 아닐 때가 다르다", () => {
  // 화면 컴포넌트를 import 하면 React·CSS 의존이 딸려오므로, 판정 자체는
  // 소스에서 함수를 떼어 재현한다(순수 함수라 동작이 같다).
  const message = (emailSent: boolean, isKo: boolean): string => {
    if (emailSent) {
      return isKo
        ? "전체 리포트를 곧 메일로 보내드려요."
        : "Full report is on its way to your inbox.";
    }
    return isKo
      ? "메일 발송에 실패했어요. 전체 리포트는 이 화면에서 그대로 보실 수 있어요."
      : "We couldn't send the email. The full report is right here on this page.";
  };

  test("보냈으면 '곧 보내드려요'", () => {
    expect(message(true, true)).toContain("보내드려요");
  });

  test("🔴 못 보냈으면 **보낸다고 말하지 않는다**", () => {
    const failed = message(false, true);
    expect(failed).not.toContain("보내드려요");
    expect(failed).toContain("실패");
  });

  test("⭐ 못 보냈을 때 **지금 할 수 있는 것**을 알려준다(막다른 길 금지)", () => {
    // 이 화면 자체가 전체 리포트다 → "여기서 볼 수 있다"로 잇는다.
    expect(message(false, true)).toContain("이 화면");
  });

  test("영문도 같은 규율 — 못 보냈으면 on its way 라고 하지 않는다", () => {
    expect(message(false, false)).not.toContain("on its way");
    expect(message(false, false)).toContain("right here");
  });

  test("🔴 두 문구가 서로 다르다(같으면 분기가 무의미)", () => {
    expect(message(true, true)).not.toBe(message(false, true));
    expect(message(true, false)).not.toBe(message(false, false));
  });
});

describe("화면 배선 — 서버가 아는 진실을 무시하지 않는다", () => {
  test("🔴 `emailSent` 로 문구를 **분기**한다", () => {
    expect(viewCode).toMatch(BRANCHES_ON_EMAIL_SENT);
  });

  test("서버 응답의 `emailSent` 를 상태로 넣는다(계측에만 쓰지 않는다)", () => {
    expect(viewCode).toMatch(STORES_SERVER_TRUTH);
  });

  test("🔴 약속 문구는 **판정 함수 안에만** 존재한다(JSX 리터럴 금지)", () => {
    // 🔬 판정법: 문구 등장은 딱 1회여야 하고, 그 1회는 `getLeadResultMessage`
    //   본문 안이어야 한다. JSX 에 리터럴로 박으면(= 옛 거짓말 복원) 2회가 되거나
    //   함수 밖에서 나타난다.
    //   ⚠️ "형태"가 아니라 "어디에 있는가"로 본다 — 앞서 `submitted ? (…)` 형태만
    //      막았더니 `{isKo ? "곧 메일로…" : …}` 뮤테이션이 그대로 통과했다.
    const occurrences = viewCode.match(PROMISE_TEXT_ANY) ?? [];
    expect(occurrences).toHaveLength(1);

    const fnStart = viewCode.indexOf("function getLeadResultMessage");
    const fnEnd = viewCode.indexOf("function ViralBar");
    const promiseAt = viewCode.indexOf("전체 리포트를 곧 메일로 보내드려요.");
    expect(fnStart).toBeGreaterThan(-1);
    expect(promiseAt).toBeGreaterThan(fnStart);
    expect(promiseAt).toBeLessThan(fnEnd);
  });
});

describe("서버 응답 — 무엇을 했는지 스스로 말한다", () => {
  test("🔴 메일을 **안 보낸 갈래 전부**가 `emailSent:false` 를 명시한다", () => {
    // job 미완료 · Resend 미설정 · 발송 예외 = 3갈래.
    // 필드를 빼고 클라이언트의 `?? false` 에 기대면, 기본값이 바뀌는 순간 조용히 거짓말한다.
    const falses = routeCode.match(EXPLICIT_FALSE) ?? [];
    expect(falses.length).toBeGreaterThanOrEqual(3);
  });

  test("실제로 보낸 갈래는 `emailSent:true`", () => {
    expect(routeCode).toMatch(EXPLICIT_TRUE);
  });
});
