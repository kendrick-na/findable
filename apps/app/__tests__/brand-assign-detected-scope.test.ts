/**
 * 🔴 **왜 이 테스트가 있나** (세션N-42 — 측정 전 자동추정 노출 · Profound `f049` 대응)
 *
 * 실측(`docs/_경쟁사_UIUX/`): 경쟁사 4곳 중 **Profound 만** 도메인 하나로 감지한 값
 * (`South Korea`·`Korean (ko)`)을 측정 **전에** 보여준다(f049). Otterly 는 안 보여줘서
 * AI 에이전시를 **아동복**으로 잡고도 그대로 밀었다(직접 가입해 찍은 프레임에 남아 있다).
 *
 * ⚠️ **2026-08-19 정정(👤)**: 여기 있던 *"Scrunch 는 암호화폐 마케팅으로 오분류"* 는 **틀렸다.**
 *   인디고차일드는 실제로 암호화폐 마케팅사였다 → **맞는 분류**였다. 근거에서 뺀다.
 *   📕 같은 오판이 `재설계안_v4 §2`·§7-D-1 에도 퍼져 있다(별도 정정).
 *   ⭐ 교훈: **고객 사업 내용을 화면만 보고 단정하지 않는다.**
 *
 * 우리는 `inferMarketScope` 가 `scope`·`reason`·`confidence` 를 **이미 만들어 반환하는데
 * 렌더하는 화면이 0곳이었다** — 계산하고 그대로 버렸다. 이 패널이 그 구멍을 막는다.
 *
 * 이 패널은 조건부(`detected ? ... : null`) 회색 블록이라 리팩터 중 **조용히 사라지기 쉽다**.
 * 사라지면 화면은 멀쩡한데 "왜 그렇게 잡혔는지"만 없어진다 → 가드로 잡는다.
 *
 * 🔴🔴 **함께 지키는 것 — 2026-08-19(N-44) 재설계**: 「**엔진 분모 불변**」
 *
 *   ⚠️ 이 가드는 원래 *"폼이 `marketScope` 를 서버로 보내지 않는지"* 를 검사했다.
 *   차단 사유는 *"`국내 중심` 을 고르면 하이퍼클로바·네이버·다음만 남아 ChatGPT 가 빠진다"* 였다.
 *   🔬 **N-44 실측 결과 그 사유는 코드와 맞지 않는다.** 엔진을 고르는 유일한 코드
 *   (`runner.ts` `enginesForLang`)는 **프롬프트 언어**만 본다 — `marketScope` 를 보지 않는다.
 *   `marketScope` 가 쓰이는 곳은 ① 처방 채널(`buildGeoActions`) ② 결과 저장, **둘 다 측정 대상과 무관**.
 *
 *   → 낡은 사유로 **기능(지역·언어 선택)을 막고 있었다.** 📕 이 저장소가 반복해서 겪은
 *     「가드가 버그의 호위병이 된다」의 **반대 형태** = **가드가 낡은 우려의 호위병**.
 *
 *   ⭐ 그래서 가드를 **지우지 않고 지키는 대상을 바꾼다**:
 *     ⛔ (옛) 폼이 값을 보내는가            → 과잉. 드롭다운 자체를 막는다
 *     ✅ (새) **엔진 선택이 시장값을 보는가** → 진짜 위험. ChatGPT 가 빠지는 것을 막는다
 *
 *   👤 2026-08-19 결정: *"챗지피티 빼면 안되지. 클로드도 퍼플렉시티도."*
 *   → 무엇을 고르든 **글로벌 4 엔진은 분모에서 빠지지 않는다.** 그걸 아래가 물게 한다.
 *
 * ⚠️ 네트워크·DB 를 타지 않는다 — 소스의 계약만 검사한다.
 *   📕 규율: 가드는 문구가 아니라 계약을 검사한다(reference_findable_traps §1).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inferMarketScope } from "@repo/audit/market-scope";
import { describe, expect, it } from "vitest";

const FORM = join(
  process.cwd(),
  "app/(authenticated)/features/brand/assign-brand-form.tsx"
);

/**
 * 주석을 걷고 **실행되는 코드만** 남긴다.
 *
 * 🔴 이 저장소는 가드가 **자기 주석을 세어** 오판한 사고를 겪었다
 *   (N-36 = 줄끝 주석 · N-39 = JSX 주석 · N-41 = 「N건 남음」이 제 JSDoc 이었다).
 *   ⚠️ `\{\s*\/\*` 는 템플릿 리터럴 `${...}` 부터 삼키는 **과잉 삭제**라 쓰지 않는다(N-41).
 */
function stripToCode(source: string): string {
  const withoutJsx = source.replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return withoutJsx
    .split("\n")
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      let inTick = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (line[i - 1] === "\\") {
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

const formCode = stripToCode(readFileSync(FORM, "utf8"));

// 정규식은 최상위에(lint: useTopLevelRegex).
/** 추정 엔진을 화면이 직접 부르는지. 여기서 부르지 않으면 측정 전엔 보여줄 값이 없다. */
const IMPORTS_INFER = /inferMarketScope/;
/** 근거 문장 — Profound f049 에 **없는** 우리 우위. 값만 남고 이유가 사라지면 안 된다. */
const RENDERS_REASON = /detected\.reason/;
/** 확신도 분기 — `market-scope.ts` 설계 의도("low 면 확인을 더 강하게"). */
const RENDERS_CONFIDENCE = /detected\.confidence/;
/** 시장값 표시. */
const RENDERS_SCOPE = /detected\.scope/;
/**
 * 🔴 **엔진 분모 불변** — 측정 엔진을 고르는 코드가 시장값을 보면 안 된다.
 *   `enginesForLang` 이 유일한 엔진 선택 지점이다(N-44 실측). 인자는 **언어뿐**.
 */
const RUNNER = join(process.cwd(), "../../packages/audit/runner.ts");
const runnerCode = stripToCode(readFileSync(RUNNER, "utf8"));

/** 엔진 선택 함수의 시그니처 — 인자에 시장값이 끼어들면 잡는다. */
const ENGINE_PICKER = /const\s+enginesForLang\s*=\s*\(([^)]*)\)/;
/** 절대 분모에서 빠지면 안 되는 엔진(👤 2026-08-19). */
const NEVER_EXCLUDED = ["chatgpt", "claude", "perplexity"] as const;

describe("브랜드 등록 — 측정 전 자동추정 노출(Profound f049 대응)", () => {
  it("추정 엔진을 화면이 직접 호출한다 (측정 전에 보여줄 값이 생긴다)", () => {
    expect(IMPORTS_INFER.test(formCode)).toBe(true);
  });

  it("시장값·근거·확신도를 **셋 다** 렌더한다", () => {
    // 값만 렌더하고 근거를 빼면 Profound f049 와 같아진다(= 우위 소멸).
    expect(RENDERS_SCOPE.test(formCode)).toBe(true);
    expect(RENDERS_REASON.test(formCode)).toBe(true);
    expect(RENDERS_CONFIDENCE.test(formCode)).toBe(true);
  });

  it("라벨이 enum 3값을 **전부** 덮는다 (빈칸 렌더 방지)", () => {
    for (const scope of ["korea", "global", "both"]) {
      expect(formCode).toContain(`${scope}:`);
    }
  });
});

describe("추정 엔진 계약 — 화면이 기대는 모양", () => {
  it(".kr 도메인은 국내로 잡고 근거 문장을 준다", () => {
    const r = inferMarketScope({ domain: "indigochild.kr" });
    expect(r.scope).toBe("korea");
    expect(r.confidence).toBe("high");
    // 화면이 이 문장을 그대로 렌더한다 — 비면 회색 줄만 남는다.
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("모르는 도메인은 both + 낮은 확신 (넓게 두고 고객이 좁힌다)", () => {
    const r = inferMarketScope({ domain: "example.com" });
    expect(r.scope).toBe("both");
    expect(r.confidence).toBe("low");
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('업종 `"auto"` 를 그대로 넘기면 안 된다 (유효 enum 이 아니다)', () => {
    // 화면은 "auto" 를 null 로 바꿔 넘긴다. 그대로 넘기면 국내성향 업종 대조가
    // 항상 빗나가 실제 저장값(null)과 화면이 어긋난다.
    const asAuto = inferMarketScope({
      domain: "example.com",
      industry: "auto",
    });
    const asNull = inferMarketScope({ domain: "example.com", industry: null });
    expect(asAuto.scope).toBe(asNull.scope);
  });

  it("국내성향 업종은 확신을 낮춘다 (해외진출 브랜드 오분류 방지)", () => {
    const r = inferMarketScope({
      domain: "example.com",
      industry: "healthcare",
    });
    expect(r.scope).toBe("korea");
    expect(r.confidence).toBe("low");
  });
});

/**
 * 🔴🔴 **엔진 분모 불변** (N-44 · 👤 *"챗지피티 빼면 안되지. 클로드도 퍼플렉시티도."*)
 *
 * 여기가 옛 가드를 **대체**한다. 옛 가드는 폼이 값을 보내는지 봤는데(= 드롭다운을 막음),
 * 진짜 위험은 **엔진 선택이 시장값에 반응하는 것**이다. 그쪽을 문다.
 *
 * ⚠️ 이 가드가 무는 순간 = 누군가 `marketScope`(또는 지역·시장 파생값)로 엔진을 거르려 할 때.
 *   그렇게 하면 `국내 중심` 고객의 점수에서 ChatGPT 가 빠져 **점수가 조용히 부풀려진다**.
 */
describe("측정 엔진 분모 불변 — 시장 선택이 엔진을 줄이지 않는다", () => {
  it("엔진 선택 함수는 **언어만** 받는다 (시장값이 인자로 끼어들지 않는다)", () => {
    const m = runnerCode.match(ENGINE_PICKER);
    // 함수 자체가 사라졌다면 엔진 선택 규칙이 옮겨간 것 → 이 가드를 옮겨 붙여야 한다.
    expect(m).not.toBeNull();
    const params = m?.[1] ?? "";
    expect(params).toContain("lang");
    // ⛔ marketScope·scope·region 이 인자로 들어오면 엔진이 시장에 반응하기 시작한다.
    expect(/marketScope|scope|region/i.test(params)).toBe(false);
  });

  it("두 엔진 목록 **모두** 글로벌 엔진(ChatGPT·클로드·퍼플렉시티)을 포함한다", () => {
    // 🔴 뮤테이션으로 잡은 함정(N-44): `indexOf("DEFAULT_7")` 부터 **파일 끝까지** 자르면
    //   바로 아래 `GLOBAL_4` 가 같은 이름들을 갖고 있어 **DEFAULT_7 에서 chatgpt 를 지워도
    //   통과**한다. 배열의 **자기 구간만** 잘라서 각각 검사한다.
    for (const listName of ["DEFAULT_7", "GLOBAL_4"] as const) {
      const start = runnerCode.indexOf(`const ${listName}`);
      expect(start).toBeGreaterThan(-1);
      // 선언 끝(`] as const`)까지가 그 배열의 구간이다.
      const end = runnerCode.indexOf("as const", start);
      expect(end).toBeGreaterThan(start);
      const block = runnerCode.slice(start, end);
      for (const engine of NEVER_EXCLUDED) {
        expect(block, `${listName} 에 ${engine} 이 없다`).toContain(
          `"${engine}"`
        );
      }
    }
  });

  it("⛔ 엔진 선택이 시장값을 읽지 않는다 (분모를 흔드는 유일한 경로 차단)", () => {
    // `enginesForLang` 선언부터 호출까지의 구간에 시장값이 등장하면 안 된다.
    const start = runnerCode.indexOf("const enginesForLang");
    const end = runnerCode.indexOf("sevenEngineResponses");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(/marketScope/.test(runnerCode.slice(start, end))).toBe(false);
  });
});
