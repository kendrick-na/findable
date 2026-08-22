/**
 * 🔴🔴 **출처가 71% 비어 있던 원인을 코드로 못박는다** (N-47 · 2026-08-19).
 *
 * ## 프로덕션 382건 실측 — 이게 발단이다
 *
 * | 엔진 | 측정 | 출처 0건 | 원인 |
 * |---|---:|---:|---|
 * | perplexity | 47 | **47 (100%)** | `createOpenAI` 껍데기 → Perplexity citation 을 못 읽는다 |
 * | gemini | 65 | **64 (98%)** | **검색 그라운딩 미설정** — 근거 웹페이지가 없다 |
 * | claude | 69 | 68 (99%) | Letsur 일반 채팅(웹 검색 없음) |
 * | chatgpt | 69 | 49 (71%) | 〃 |
 * | naver·daum | 87 | **0 (0%)** ✅ | 검색 문서 직접 매핑 — 정상 |
 *
 * ⚠️ **더 나빴던 것**: 채워진 29% 를 열어보니 `nvidia.com`·`amd.com`·`intel.com` 이었다.
 *   = AI 가 **답변 본문에 타이핑한 브랜드 홈페이지**를 폴백이 주워담은 것.
 *   *"AI 가 무엇을 보고 우리를 말하는가"* 를 파는 제품이 **자기 홈페이지를 근거라고**
 *   보여주고 있었다. 📕 *"못 잰 것을 0이라 부르지 않기"* 의 짝 —
 *   **안 잰 것을 잰 것처럼 채우지도 않는다.**
 *
 * ## 이 테스트가 지키는 것
 * ① 자사 도메인은 본문 폴백에서 **빠진다**(외부 URL 은 남는다 — 그건 정보다)
 * ② 그라운딩 스위치가 **기본 off** 다(👤 *"먼저 비용부터 재고 결정"*)
 * ③ 켰을 때 **실제로 도구·경로가 바뀐다**(플래그가 이름만 있고 아무것도 안 하면 무의미)
 *
 * ⚠️ **라이브 검증은 배포 후에만 가능하다** — 엔진 키가 전부 프로덕션 전용이다(실측).
 *   그래서 여기서는 **계약**을 잠그고, 효과는 배포 후 측정 1건으로 잰다.
 *
 * @vitest-environment node
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractCitedSources,
  mapProviderSources,
} from "../../../packages/ai/lib/engines/utils";

const ADAPTERS = readFileSync(
  join(process.cwd(), "../../packages/ai/lib/engines/global-adapters.ts"),
  "utf8"
);
const RUNNER = readFileSync(
  join(process.cwd(), "../../packages/audit/runner.ts"),
  "utf8"
);

describe("① 본문 URL 폴백 — 자사 도메인은 「읽은 근거」가 아니다", () => {
  const text =
    "엔비디아는 https://www.nvidia.com 에서 확인하세요. " +
    "리뷰는 https://blog.naver.com/gpu-review 를 참고했습니다.";

  it("🔴 자사 도메인을 주면 **자사 URL 이 인용에서 빠진다**", () => {
    const out = extractCitedSources(text, "nvidia.com");
    expect(out.map((s) => s.domain)).not.toContain("www.nvidia.com");
  });

  it("✅ 외부 URL 은 그대로 남는다 (전면 차단이 아니다 — 👤 결정)", () => {
    // 나무위키·다나와처럼 AI 가 본문에 쓴 **남의 사이트**는 여전히 신호다.
    const out = extractCitedSources(text, "nvidia.com");
    expect(out.map((s) => s.domain)).toContain("blog.naver.com");
  });

  it("✅ 서브도메인도 자사로 본다", () => {
    const sub = "자세히는 https://investor.nvidia.com 참고";
    expect(extractCitedSources(sub, "nvidia.com")).toEqual([]);
  });

  it("⚠️ 도메인을 안 주면 예전 그대로 (무료 진단 등 문맥 없는 경로 호환)", () => {
    expect(extractCitedSources(text).length).toBe(2);
  });

  it("🔴 URL 꼬리의 **백틱·따옴표·괄호**를 떼어낸다 (라이브에서 실제로 샜다)", () => {
    // 🔴 N-47 라이브 스크린샷: `sulwhasoo.com\`` 이 `sulwhasoo.com` 과 **별개 줄**로 떴다.
    //   DB 실측: {"domain": "www.sulwhasoo.com`"} 로 저장돼 있었다.
    //   ⚠️ 백틱이 붙으면 **자사 제외도 빗나간다** → 자기 홈페이지가 「외부 출처」인 척 남는다.
    const markdown =
      "공식몰은 `https://www.sulwhasoo.com` 이고 리뷰는 (https://blog.naver.com/x) 입니다.";
    const out = extractCitedSources(markdown, "sulwhasoo.com");
    // 자사는 백틱이 붙어 있어도 **제외**돼야 한다.
    expect(out.map((c) => c.domain)).not.toContain("www.sulwhasoo.com`");
    expect(out.map((c) => c.domain)).not.toContain("www.sulwhasoo.com");
    // 외부는 괄호가 떨어진 **깨끗한 도메인**으로 남아야 한다.
    expect(out.map((c) => c.domain)).toContain("blog.naver.com");
  });

  it("🔴 러너가 **엔진 질의에** 자사 도메인을 넘긴다 (안 넘기면 위 로직이 죽은 코드다)", () => {
    // 📕 N-46 *"함수는 있는데 프로덕션 호출이 0곳"* 사고 방지.
    //
    // 🔴🔴 **처음엔 파일 전체에서 `brandDomain: input.domain` 을 찾았고, 그건 틀렸다**
    //   (N-47 · 뮤테이션이 잡았다). 러너에는 **같은 문자열이 2곳** 있다 —
    //   하나는 `verifyMentions(...)`(예전부터 있던 것), 하나가 이번에 넣은 엔진 질의다.
    //   전체를 훑으면 **엔진 질의를 통째로 지워도 통과**한다(실제로 통과했다).
    //   📕 N-45 *"가드는 「무엇을」뿐 아니라 「어디서 찾는지」도 좁혀야 한다"*.
    //   → `queryAllEngines(` 호출 블록 **안**만 본다.
    const call = RUNNER.slice(RUNNER.indexOf("queryAllEngines("));
    const args = call.slice(0, call.indexOf("enginesForLang"));
    expect(args).toMatch(/brandDomain:\s*input\.domain/);
  });
});

describe("③ 구글 그라운딩 — 리다이렉터를 진짜 도메인으로 바꾼다", () => {
  // 🔴 라이브 실측(N-47): 그라운딩을 켜니 gemini 출처가 **전부** 이렇게 왔다.
  //   url = 리다이렉터 · title = **진짜 도메인**.
  const googleSources = [
    {
      sourceType: "url",
      url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZxyz",
      title: "apgroup.com",
    },
    {
      sourceType: "url",
      url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZabc",
      title: "tistory.com",
    },
  ];

  it("🔴 도메인이 **구글 리다이렉터가 아니라** 실제 출처가 된다", () => {
    const out = mapProviderSources(googleSources);
    expect(out.map((s) => s.domain)).toEqual(["apgroup.com", "tistory.com"]);
    // 이게 안 되면 화면의 「출처」가 전부 같은 구글 주소 한 줄이 된다 = 답을 못 준다.
    expect(out.map((s) => s.domain)).not.toContain(
      "vertexaisearch.cloud.google.com"
    );
  });

  it("⚠️ title 이 **글 제목**이면 손대지 않는다 (엉뚱한 값을 도메인에 넣지 않는다)", () => {
    const out = mapProviderSources([
      {
        sourceType: "url",
        url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/X",
        title: "설화수 후기 – 티스토리",
      },
    ]);
    expect(out[0]?.domain).toBe("vertexaisearch.cloud.google.com");
  });

  it("✅ 일반 출처는 그대로 둔다 (리다이렉터일 때만 갈아탄다)", () => {
    const out = mapProviderSources([
      { sourceType: "url", url: "https://blog.naver.com/x", title: "후기" },
    ]);
    expect(out[0]?.domain).toBe("blog.naver.com");
  });
});

describe("② 그라운딩 스위치 — 기본 off 이고, 켜면 실제로 달라진다", () => {
  it("🔴 기본값은 **꺼짐** — 비용 판단 전에 저절로 켜지지 않는다", () => {
    // 👤 *"먼저 비용부터 재고 결정"*. `=== "1"` 이라 미설정이면 false 다.
    expect(ADAPTERS).toMatch(/FINDABLE_ENGINE_GROUNDING\s*===\s*["']1["']/);

    // 🔴🔴 **여기서 `process.env` 를 단정하지 않는다** (N-47 · 실제로 배포를 깨뜨렸다).
    //   원래 `expect(process.env.FINDABLE_ENGINE_GROUNDING).toBeUndefined()` 였는데,
    //   👤 승인으로 프로덕션에 `=1` 을 넣자 **빌드의 test 단계가 실패**해
    //   배포가 `● Error` 로 죽었다(`expected '1' to be undefined`).
    //
    //   ⚠️ 가드가 **지키려던 것은 「코드의 기본값이 off」** 인데,
    //   **「이 환경에서 꺼져 있음」** 을 재고 있었다 — 축이 달랐다.
    //   운영 스위치를 켜는 순간 가드가 막아서면, 사람은 **가드를 지우게 된다**.
    //   📕 *"가드가 버그의 호위병이 된다"* 의 반대편 — **가드가 개선을 막는 것**도 사고다.
    //
    //   → 계약은 **`=== "1"` 비교식**(미설정이면 false)으로 충분하다. 그건 위 줄이 이미 본다.
    //   ⭐ 환경값은 환경이 정한다. 테스트는 **코드가 어떻게 읽는지**만 못박는다.
    expect(ADAPTERS).not.toMatch(/FINDABLE_ENGINE_GROUNDING\s*!==\s*["']0["']/);
  });

  it("🔴 gemini 는 켜질 때 **googleSearch 도구**를 넘긴다", () => {
    // 공식 문서: sources 는 "응답을 grounding 한 웹페이지"로 제한.
    // 도구가 없으면 sources 는 원리적으로 빌 수밖에 없다 → 98% 공백의 원인.
    expect(ADAPTERS).toMatch(/tools:\s*\{\s*google_search:/);
    expect(ADAPTERS).toContain("google.tools.googleSearch({})");
  });

  it("🔴 perplexity 는 **직접 호출을 유지한다** (Gateway 전환은 되돌렸다)", () => {
    // 🔴🔴 **라이브 실측이 내 처방을 반증했다**(N-47 · 2026-08-20).
    //   Gateway 로 보냈더니 perplexity 가 **행 0건** — 직전 회차는 3건이었다.
    //   출처를 얻기는커녕 **엔진 하나를 통째로 잃었다**. 고치기 전보다 나쁘다.
    //   ⭐ 직접 호출은 출처는 못 줘도 **답변은 준다**(등장·순위·감성은 계속 잰다).
    //   → 이 가드는 "다시 Gateway 로 몰래 바꾸지 마라" 를 지킨다.
    //     재시도하려면 **Gateway 에서 perplexity 가 응답하는지 먼저 확인**할 것.
    const block = ADAPTERS.slice(
      ADAPTERS.indexOf('if (engineId === "perplexity")'),
      ADAPTERS.indexOf("if (isGatewayConfigured())")
    );
    expect(block).not.toMatch(
      /isGroundingEnabled\(\)[\s\S]{0,200}MODEL_DEFAULTS\.perplexity/
    );
    // 직접 provider 경로는 살아 있어야 한다(이게 사라지면 엔진이 죽는다).
    expect(block).toContain("getPerplexityProvider()");
  });

  it("🔴 도구가 `generateText` 까지 **실제로 전달된다**", () => {
    // 📕 N-45 *"가드는 「어디서 찾는지」도 좁힌다"* — 선언만 하고 안 넘기면 무의미하다.
    const call = ADAPTERS.slice(ADAPTERS.indexOf("await generateText({"));
    expect(call.slice(0, 400)).toMatch(/tools\s*\?\s*\{\s*tools:/);
  });
});
