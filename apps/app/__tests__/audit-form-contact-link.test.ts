/*
 * 진단 폼이 429 에 **문의 링크를 실제로 렌더하는가** — 2026-08-12 세션N-26.
 *
 * 🔴 **막는 사고**: `shouldOfferContact` 가 아무리 옳게 true 를 반환해도, 폼이 그걸
 *   화면에 연결하지 않으면 고객에겐 **아무것도 달라지지 않는다**. 순수 함수 테스트만
 *   있으면 "테스트 전부 통과 · 실제로는 여전히 막다른 길"이 된다.
 *
 * ⚠️ 왜 정적 검사인가: `audit-form.tsx` 는 `apps/web` 에 있고 **그 앱에는 테스트 러너가
 *   없다**(프로젝트 함정). 게다가 폼을 실제로 돌리려면 브라우저가 필요한데
 *   **BotID 가 curl 을 차단**해서 라이브로도 이 경로를 못 밟는다.
 *   → 소스를 읽어 **배선이 존재하는지**를 구조로 고정한다.
 *
 * 🔴 **존재 검사 금지**(세션N-25 가 두 번 뚫린 지점) — 이름만 찾으면 `import` 줄이
 *   만족시켜 통과한다. 여기서는 **호출 형태**와 **JSX 배선**으로 판정한다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const FORM_PATH = join(
  import.meta.dirname,
  "../../web/app/[locale]/audit/components/audit-form.tsx"
);

const source = readFileSync(FORM_PATH, "utf8");

// import 줄을 지운 본문 — 이름이 import 에서만 나와도 통과하는 것을 막는다.
const body = source
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("import"))
  .join("\n");

describe("audit-form — 429 문의 링크 배선", () => {
  test("🔴 `shouldOfferContact` 를 **호출**한다(import 줄만으로는 통과 못 함)", () => {
    expect(body).toMatch(/shouldOfferContact\s*\(/);
  });

  test("호출 결과를 상태로 넣는다 — 계산만 하고 버리지 않는다", () => {
    expect(body).toMatch(/setShowContact\s*\(\s*shouldOfferContact\s*\(/);
  });

  test("🔴 `/contact` 로 가는 링크를 렌더한다", () => {
    // locale 을 붙여야 한다 — 라우트가 `app/[locale]/contact` 다.
    expect(body).toMatch(/href=\{`\/\$\{locale\}\/contact`\}/);
  });

  test("문의 링크가 그 상태에 **조건부로** 걸려 있다(항상 노출 아님)", () => {
    expect(body).toMatch(/\{showContact\s*&&/);
  });

  test("새 제출마다 초기화한다 — 이전 에러의 링크가 남지 않는다", () => {
    expect(body).toMatch(/setShowContact\s*\(\s*false\s*\)/);
  });

  test("⭐ 판정을 두 벌 만들지 않는다 — `classifySubmit` 호출은 한 번뿐", () => {
    // 계측과 화면이 각자 분류하면 "이벤트엔 ip_capped 인데 링크는 없다"가 생긴다.
    const calls = body.match(/classifySubmit\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});
