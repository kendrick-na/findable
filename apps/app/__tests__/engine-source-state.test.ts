/**
 * 🔴🔴 **「인용 0」은 세 가지 뜻이다 — 뭉치면 고객을 속인다** (N-47 · 2026-08-19).
 *
 * | 상태 | 화면 | 뜻 |
 * |---|---|---|
 * | `never` | 「출처 안 밝힘」 | API 가 출처를 아예 안 준다(hyperclova) |
 * | `not_collected` | 「출처 미수집」 | 🆕 낼 수 있는데 **우리가 그라운딩을 안 켰다** |
 * | `collected` | 「인용 N」 | 정상 수집 — 0 이면 **진짜로** 인용이 없었다 |
 *
 * ## 왜 셋째가 생겼나 (프로덕션 382건 실측)
 * perplexity **47/47**(✅ N-48 파싱 수정), gemini **64/65** 가 출처 0 이었다. 코드는 이 둘을
 * *"검색 기반이라 당연히 인용을 낸다"* 고 분류해(`engine-citation-capability.test.ts`)
 * 화면에 **「인용 0」** 을 찍었다 → 고객은 *"이 AI 가 우리를 안 읽었다"* 로 읽는다.
 * **진실은 "우리가 안 받아왔다"** 다. 📕 이 저장소 최다 사고 — 못 잰 것을 0이라 부르기.
 *
 * ⭐ **그라운딩을 켜면 `not_collected` 는 사라진다** — 이 목록은 영구 분류가 아니라
 *   **"지금 꺼져 있다"는 상태**다. 그래서 판정 함수가 플래그를 인자로 받는다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineSourceState } from "@repo/audit/market-scope";
import { describe, expect, it } from "vitest";

const BOARD = readFileSync(
  join(
    process.cwd(),
    "app/(authenticated)/features/analysis/sources-board.tsx"
  ),
  "utf8"
);

describe("판정 — 세 상태가 서로 다르게 갈린다", () => {
  it("🔴 hyperclova 는 그라운딩과 **무관하게** 언제나 `never`", () => {
    // 어댑터가 `[]` 를 하드코딩한다. 켜도 안 나온다 — 켜짐 여부로 흔들리면 안 된다.
    expect(engineSourceState("hyperclova", false)).toBe("never");
    expect(engineSourceState("hyperclova", true)).toBe("never");
  });

  it("🔴 그라운딩 **꺼짐**: gemini 는 `not_collected`", () => {
    // 실측 64/65 비어 있던 엔진. 「인용 0」이라 부르면 거짓이다.
    expect(engineSourceState("gemini", false)).toBe("not_collected");
  });

  it("⭐ 그라운딩 **켜짐**: gemini 가 `collected` 로 바뀐다", () => {
    // 라이브 실측으로 확인됨 — 켠 뒤 출처 0건이 4/4 → **0/4** 이 됐다.
    // 켰는데도 「미수집」이라 말하면 이번엔 반대 방향으로 거짓말이 된다.
    expect(engineSourceState("gemini", true)).toBe("collected");
  });

  it("✅ perplexity 는 **`collected`** — N-48 파싱 수정으로 출처가 살아났다", () => {
    // 🔴🔴 **N-47 의 판정을 뒤집었다**(N-48 · 2026-08-20 · 👤 지적으로 발견).
    //   N-47 은 이걸 *"Gateway 크레딧 0"* 탓이라 적고 **양쪽 다 `not_collected`** 로
    //   못박았다. 그런데 라이브 perplexity 는 자체 키 **직접 호출**이라 Gateway 를
    //   **안 탄다**(`resolveModel`). 크레딧은 *Gateway 로 돌려본 실험* 이 실패한 이유였다.
    //
    //   진짜 원인은 `createOpenAI` 껍데기가 Perplexity 의 **규격 밖 인용 필드**를
    //   잘라낸 것이고, 원시 `response.body` 에서 직접 꺼내 고쳤다.
    //
    // 🔴🔴 **이 판정을 안 고치면 수정이 화면에 안 보인다** — `not_collected` 인 동안
    //   `sources-board` 는 인용 수를 **아예 렌더하지 않고** 「출처 미수집」만 찍는다.
    //   출처를 되살려놓고 화면이 계속 «못 받아왔다»고 말하는 상태 =
    //   📕 *"가드가 버그의 호위병이 된다"* 의 전형. 그래서 여기서 뒤집는다.
    //
    // ⚠️ 이제 perplexity 의 「인용 0」은 **정직한 0**(진짜로 인용이 없었다)이다.
    //   그라운딩 플래그와 무관하다 — 직접 호출 경로는 플래그를 보지 않는다.
    expect(engineSourceState("perplexity", false)).toBe("collected");
    expect(engineSourceState("perplexity", true)).toBe("collected");
  });

  it("✅ naver·daum 은 원래 정상이라 언제나 `collected`", () => {
    // 실측 출처 0건 **0%**. 이 둘이 지금 제품의 진짜 무기다 — 건드리지 않는다.
    for (const id of ["naver", "daum"]) {
      expect(engineSourceState(id, false)).toBe("collected");
      expect(engineSourceState(id, true)).toBe("collected");
    }
  });

  it("🔴 claude 는 **플래그로 갈린다** — 웹검색 OFF 면 `not_collected`", () => {
    // N-47 실측: Letsur 로 claude 를 부르니 sources 0 · **본문 URL 도 없음**.
    //   일반 채팅이라 인용이 나올 길이 구조적으로 없었다.
    //
    // 🔴🔴 **그런데 N-48 에 길이 생겼다** — Letsur `/v1/messages`(Anthropic 네이티브)로
    //   `web_search_20250305` 서버툴을 태우면 **실제로 검색하고 출처를 준다**(실측 18건).
    //   그래서 이 판정은 이제 **플래그에 달렸다**.
    //
    // ⚠️⚠️ **환경값을 단정하지 않는다** — 📕 N-47 최대 사고:
    //   `expect(process.env.X).toBeUndefined()` 가 👤 승인으로 플래그를 켜자
    //   **빌드를 실패**시켰다(그리고 이 테스트가 방금 **똑같이** 배포를 막았다).
    //   ⭐ 테스트는 「코드가 플래그를 어떻게 읽는지」만 못박는다. 실값은 환경이 정한다.
    const on = process.env.FINDABLE_CLAUDE_WEB_SEARCH === "1";
    expect(engineSourceState("claude", false)).toBe(
      on ? "collected" : "not_collected"
    );
    // 그라운딩 플래그(gemini 용)와는 무관하다 — claude 는 자기 플래그만 본다.
    expect(engineSourceState("claude", true)).toBe(
      on ? "collected" : "not_collected"
    );
  });

  it("🔴🔴 chatgpt 는 `not_collected` — 그 「29%」가 **전부 가짜였다**(N-48)", () => {
    // 🔴 **이 테스트는 N-47 의 정반대를 못박는다.** 예전 주석은 *"chatgpt 는 답변에 URL 을
    //   적는 경우가 있어 실측 29%가 채워졌다"* 며 `collected` 로 뒀는데,
    //   그 29% 의 정체를 **프로덕션 107건 전수**로 확인하니 전부 폴백이 주워담은
    //   **AI 가 타이핑한 브랜드 홈페이지**였다(`www.laneige.com` 등 경쟁사 루트).
    //
    //   독립적인 두 방법이 일치했다:
    //     ① title 보유 **0/107** (폴백은 title 을 안 넣는다)
    //     ② 인용 URL 이 답변 본문에 있나 **107/107** (대조군 perplexity 는 1/58)
    //
    // ⚠️ 그래서 「인용 0」이 아니라 **「출처 미수집」**이 정직하다 — chatgpt 는 등장 4/4 다.
    //   0 을 찍으면 고객은 *"ChatGPT 가 우리를 안 읽었다"* 로 읽는다(거짓).
    //   📕 이 저장소 최다 사고 — 못 잰 것을 0이라 부르기.
    //
    // ⭐ 되돌릴 조건: chatgpt 인용에 **title 이 붙기 시작하면**(= 진짜 provider citation)
    //   이 판정을 다시 재야 한다. 판별식은 **URL 모양이 아니라 title 유무**다.
    expect(engineSourceState("chatgpt", false)).toBe("not_collected");
    expect(engineSourceState("chatgpt", true)).toBe("not_collected");
  });
});

/**
 * 🔴 **주석을 세지 않는다.** 이 화면은 「출처 미수집」이라는 말을 **주석에서도** 쓴다
 *   (왜 이 갈래가 생겼는지 적은 자리). 주석까지 세면 가드가 **자기 문서를 보고 통과**한다 —
 *   N-47 에서 실제로 그렇게 샜다: 두 갈래를 **같은 문구로 바꾸는 뮤테이션이 통과**했다.
 *   📕 *"가드가 자기 주석을 세는 사고"* — `stripComments` 를 먼저 적용한다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("화면 — 세 갈래가 **서로 다른 문구**로 나간다", () => {
  it("🔴 두 빈-상태 문구가 **한 삼항식 안에서 서로 다르다**", () => {
    // 📕 N-45 *"두 갈래가 같은 문구면 소스 가드는 통과하고 화면은 똑같다"*.
    //   분기가 있는지가 아니라 **말이 다른지**를 본다.
    //
    // 🔴🔴 **파일 전체를 훑으면 안 된다**(N-47 · 뮤테이션이 잡았다) — 주석에도 같은 말이
    //   있어서 `toContain` 은 **두 갈래를 같은 문구로 바꿔도 통과**했다.
    //   → 주석을 걷어낸 뒤 **그 삼항식 하나만** 꺼내 두 값을 직접 비교한다.
    const code = stripComments(BOARD);
    const ternary = code.match(/state === "never" \? (".+?") : (".+?")/);
    expect(
      ternary,
      "빈 상태 문구를 고르는 삼항식을 찾지 못했다"
    ).not.toBeNull();
    const [, whenNever, whenNotCollected] = ternary as RegExpMatchArray;
    expect(whenNever).not.toBe(whenNotCollected);
    expect(whenNever).toBe('"출처 안 밝힘"');
    expect(whenNotCollected).toBe('"출처 미수집"');
  });

  it("🔴 정상 갈래는 여전히 숫자를 말한다 (「인용 N」)", () => {
    const code = stripComments(BOARD);
    expect(code).toMatch(/인용 \{engine\.citations\}/);
  });

  it("🔴 화면이 **판정 함수로만** 갈린다 (사설 엔진 목록 금지 · N-34)", () => {
    expect(BOARD).toContain("engineSourceState(");
    // 엔진 id 를 화면에서 직접 비교하면 목록이 두 벌이 되어 반드시 갈라진다.
    expect(BOARD).not.toMatch(/engineId\s*===\s*["'](perplexity|gemini)["']/);
  });

  it("🔴 플래그를 **실제로 읽는다** (안 읽으면 항상 옛말을 한다)", () => {
    expect(BOARD).toMatch(/FINDABLE_ENGINE_GROUNDING\s*===\s*["']1["']/);
    // 읽기만 하고 안 넘기면 죽은 코드다 — 넘기는 것까지 확인한다.
    expect(BOARD).toMatch(/groundingEnabled=\{groundingEnabled\}/);
  });
});
