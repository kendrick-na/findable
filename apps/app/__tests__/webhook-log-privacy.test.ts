/*
 * 웹훅 로그 개인정보 회귀 테스트 — 2026-08-12 세션N-24 (BL-Day17-03).
 *
 * 🔴🔴 **막는 사고: 로그에 개인정보가 평문으로 쌓이는 것.**
 *   Clerk 인증 웹훅이 `log.info("Webhook", { id, eventType, body })` 로 **원문 JSON
 *   전체**를 남기고 있었다. 그 안에는 **이메일·이름·전화번호·아바타 URL** 이 평문으로
 *   들어 있고(`handleUserCreated` 가 읽는 필드가 그 증거), 가입·정보수정이 일어날 때마다
 *   Logtail 에 그대로 적재됐다.
 *   ⚠️ 로그는 **지우기 어렵고 보존기간이 길다** → 필요 없는 개인정보는 애초에 안 넣는다.
 *   (사고 이력: 세션N-11 이 평문 이메일 로깅 6곳을 `maskEmail` 로 마스킹했다. 같은 계열.)
 *
 * ⚠️ **왜 라우트를 import 하지 않고 소스를 검사하나**
 *   이 라우트는 `svix`·`@repo/auth/server`·`server-only` 를 끌어와서 단위 테스트로
 *   감싸려면 스텁이 여러 개 필요하다. 그런데 내가 지키려는 성질은
 *   *"로그 인자에 원문 payload 를 넣지 않는다"* 는 **정적 성질**이다.
 *   → 소스를 직접 읽어 단정하면 **모킹으로 우회될 수 없고** 의존성도 0이다.
 *   (🎓 프로젝트 교훈: 가드는 문구가 아니라 **구조**로 판정해야 한다.)
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROUTE_PATH = join(process.cwd(), "app/webhooks/auth/route.ts");

const source = readFileSync(ROUTE_PATH, "utf8");

/** 주석을 제거한 실행 코드만 남긴다 — 주석의 `body` 언급은 위반이 아니다. */
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

// biome: 정규식은 최상위에 둔다(호출마다 재생성 방지 — 프로젝트 규칙).
// `log.info(...)` / `log.error(...)` 호출 한 건씩 (인자 포함, 단순 괄호 기준).
const LOG_CALL_RE = /log\.(?:info|warn|error)\(([^;]*?)\);/gs;
/** 원문 payload 변수명 — 이게 로그 인자에 있으면 개인정보 유출이다. */
const RAW_PAYLOAD_RE = /\bbody\b|\bpayload\b/;
/** 로그 키 규칙: 점으로 구분된 소문자 토큰(공백·콜론이 있으면 문장이다). */
const LOG_KEY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;
/** 로그 키 추출용. `g` 플래그를 쓰므로 사용 시 `lastIndex` 를 신경 쓸 것. */
const LOG_KEY_CAPTURE_RE = /log\.(?:info|warn|error)\(\s*"([^"]+)"/g;

const logCalls = [...codeOnly.matchAll(LOG_CALL_RE)].map((m) => m[1]);

describe("Clerk 인증 웹훅 로그 — 개인정보 미포함", () => {
  test("로그 호출이 실제로 존재한다 (정규식이 헛돌지 않는지 확인)", () => {
    // 🔴 이 단정이 없으면 정규식이 0건을 잡아도 아래 테스트가 전부 '통과'한다.
    expect(logCalls.length).toBeGreaterThan(0);
  });

  test("🔴 로그 인자에 원문 payload(body/payload)를 넣지 않는다", () => {
    for (const call of logCalls) {
      expect(call, `개인정보 원문이 실린 로그: ${call}`).not.toMatch(
        RAW_PAYLOAD_RE
      );
    }
  });

  test("🔴 개인정보 필드명을 로그에 직접 싣지 않는다", () => {
    // Clerk 원문의 개인정보 필드들. 하나라도 로그 인자에 있으면 유출이다.
    const piiFields = [
      "email_addresses",
      "phone_numbers",
      "first_name",
      "last_name",
      "image_url",
    ];
    for (const call of logCalls) {
      for (const field of piiFields) {
        expect(call, `개인정보 필드 ${field} 가 로그에 실렸다`).not.toContain(
          field
        );
      }
    }
  });

  test("로그 키가 `도메인.대상.동작` 규칙을 따른다 (문장 금지)", () => {
    // 예전 `"Webhook"` · `"Error verifying webhook:"` 은 검색·집계가 불가능했다.
    const keys = [...codeOnly.matchAll(LOG_KEY_CAPTURE_RE)].map((m) => m[1]);

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      // 점으로 구분된 소문자 토큰만 — 공백·콜론이 있으면 문장이다.
      expect(key, `로그 키가 규칙을 벗어났다: "${key}"`).toMatch(LOG_KEY_RE);
    }
  });
});
