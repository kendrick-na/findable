/**
 * 🔴 **경쟁사 저장값이 집계에 실제로 쓰이는지**(N-44 · 👤 승인 ⓐ)
 *
 * 배경: `Brand.competitors` 는 **쓰는 코드 0 · 읽는 코드 0** 인 죽은 필드였다. AI 는 이미
 * 경쟁사를 뽑아 `prompt-wizard` 가 **배지로 보여주고 그대로 버렸다**. 👤 승인 ⓐ =
 * 저장하고 **읽는 코드까지** 만든다.
 *
 * ⚠️ 이 테스트가 지키는 **판정** — 등록 경쟁사는 「**병합 사전**」이지 「**화이트리스트**」가 아니다.
 *   화이트리스트로 쓰면 ① `shareOfVoice` 분모가 바뀌어 점유율이 부풀려지고
 *   ② 「내가 몰랐던 경쟁사」가 사라져 이 화면의 존재 이유가 없어진다.
 *   → **거르지 않고 합치기만 한다.** 아래 "거르지 않는다" 케이스가 그걸 문다.
 *
 * 📕 규율: 컨트롤을 만들면 **읽는 코드를 같이** 만든다(안 그러면 컨트롤이 거짓말이 된다).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCompetitorAliases,
  extractCompetitorLandscape,
  parseKnownCompetitors,
} from "@repo/audit/competitor-extract";
import { describe, expect, it } from "vitest";

/**
 * 한/영을 섞어 답한 두 개의 AI 답변 — 실측에서 SoV 가 갈리던 그 모양.
 *
 * ⚠️ **브랜드 선정 주의**(N-44 실측): 삼성·SK하이닉스·마이크론은 **내장 사전
 *   `BRAND_KEY_ALIASES` 에 이미 있다**(SK하이닉스 진단 사고로 등재됨). 그걸로 시험하면
 *   등록 없이도 합쳐져 **테스트가 아무것도 검증하지 못한다**(첫 작성에서 실제로 그랬다).
 *   → 사전에 **없는** 브랜드를 쓴다. 「조선미녀 ↔ Beauty of Joseon」은 이 파일 헤더가
 *   *"완전 해결엔 별칭 사전 필요"* 라며 든 **바로 그 미해결 예시**다.
 */
const KO_ANSWER = `추천 순위입니다.
1. 조선미녀
2. 라운드랩
3. 아누아`;
const EN_ANSWER = `Here is the ranking.
1. Beauty of Joseon
2. Round Lab
3. Anua`;

const findRank = (
  ranking: Array<{ mentions: number; name: string; shareOfVoice: number }>,
  needle: string
) => ranking.find((r) => r.name.includes(needle));

describe("경쟁사 등록값 → 표기 병합 (읽는 코드)", () => {
  it("등록하지 않으면 한/영 표기가 **갈라진 채**로 잡힌다 (문제 재현)", () => {
    const { ranking } = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "우리브랜드"
    );
    // 내장 사전에 없는 브랜드는 **두 줄**로 남는다 = SoV 분산(파일 헤더가 적어둔 한계).
    expect(findRank(ranking, "조선미녀")).toBeDefined();
    expect(findRank(ranking, "Beauty of Joseon")).toBeDefined();
    // 각각 1회씩 세어진다 — 합쳐졌다면 2회여야 한다.
    expect(findRank(ranking, "조선미녀")?.mentions).toBe(1);
  });

  it("등록하면 한/영 표기가 **한 줄로 합쳐진다**", () => {
    const { ranking } = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "우리브랜드",
      [],
      [{ name: "조선미녀", aliases: ["Beauty of Joseon"] }]
    );
    const merged = ranking.filter(
      (r) => r.name.includes("조선미녀") || r.name.includes("Beauty of Joseon")
    );
    // 두 표기가 한 항목으로 합쳐져야 한다(= 언급 2회).
    expect(merged).toHaveLength(1);
    expect(merged[0]?.mentions).toBe(2);
  });

  it("⛔ **거르지 않는다** — 등록하지 않은 경쟁사도 그대로 남는다", () => {
    const { ranking } = extractCompetitorLandscape(
      [KO_ANSWER],
      "우리브랜드",
      [],
      // 조선미녀만 등록. 나머지는 「내가 몰랐던 경쟁사」다.
      [{ name: "조선미녀" }]
    );
    // 🔴 화이트리스트로 구현했다면 여기서 라운드랩·아누아가 사라진다.
    expect(findRank(ranking, "라운드랩")).toBeDefined();
    expect(findRank(ranking, "아누아")).toBeDefined();
  });

  it("⛔ 등록해도 **점유율 분모가 바뀌지 않는다**", () => {
    const withoutReg = extractCompetitorLandscape([KO_ANSWER], "우리브랜드");
    const withReg = extractCompetitorLandscape(
      [KO_ANSWER],
      "우리브랜드",
      [],
      [{ name: "조선미녀" }]
    );
    // 합칠 짝이 없는 입력이므로 집계 결과가 **완전히 같아야** 한다.
    // 다르면 등록이 분모를 건드렸다는 뜻이다(= 점수가 조용히 부풀려진다).
    expect(withReg.ranking).toEqual(withoutReg.ranking);
    expect(withReg.sampleSize).toBe(withoutReg.sampleSize);
  });

  it("빈 등록값은 기존 동작과 **완전히 같다**(무해한 기본값)", () => {
    const base = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "우리브랜드"
    );
    const empty = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "우리브랜드",
      [],
      []
    );
    expect(empty).toEqual(base);
  });
});

describe("buildCompetitorAliases — 사전 구성 계약", () => {
  it("별칭을 대표 이름 키로 접는다", () => {
    const map = buildCompetitorAliases([
      { name: "조선미녀", aliases: ["Beauty of Joseon", "조선 미녀"] },
    ]);
    expect(map.get("beautyofjoseon")).toBe("조선미녀");
    // 공백은 키에서 제거된다 — "조선 미녀" 도 같은 키로 접힌다.
    expect(map.get("조선미녀")).toBe("조선미녀");
  });

  it("문자열만 줘도 받는다(별칭 없는 경쟁사)", () => {
    const map = buildCompetitorAliases(["올리브영"]);
    expect(map.get("올리브영")).toBe("올리브영");
  });

  it("빈 값·공백은 무시한다", () => {
    const map = buildCompetitorAliases(["", "   ", { name: "" }]);
    expect(map.size).toBe(0);
  });
});

/**
 * 🔴 **#9 — 앱 대시보드와 공개 리포트가 같은 숫자를 보여야 한다**(N-45).
 *
 * 배경: 공개 리포트(`apps/web`)는 **audit 결과 JSON** 만 받고 그 JSON 에 브랜드 관계가
 * 없어서, 같은 브랜드가 「조선미녀」와 「Beauty of Joseon」 으로 **따로 세어졌다**.
 * 앱 대시보드는 `Brand` 를 읽어 병합하고 있었으므로 **두 화면 숫자가 갈렸다**.
 *
 * 고친 방식: 러너가 `brandVariants`·`registeredCompetitors` 를 **결과에 실어준다**
 * (`AuditJob.result` 가 `Json` 이라 마이그레이션 없음).
 *
 * ⚠️ 이 가드는 **문구가 아니라 결과의 동등성**을 검사한다 — 두 경로가 같은 입력에서
 *   같은 집계를 내는가. 배선이 하나라도 끊기면 숫자가 갈리므로 그때 문다.
 */
describe("#9 공개 리포트 ↔ 앱 대시보드 — 같은 값이면 같은 집계", () => {
  const REGISTERED = [{ aliases: ["Beauty of Joseon"], name: "조선미녀" }];

  it("🔴 병합 사전을 넘기면 한/영 표기가 **하나로** 합쳐진다", () => {
    const merged = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "라운드랩",
      [],
      REGISTERED
    );
    const hits = merged.ranking.filter((r) =>
      ["조선미녀", "Beauty of Joseon"].includes(r.name)
    );
    // 합쳐졌다면 항목은 **하나**, 언급은 두 답변에서 각각 세어 2.
    expect(hits).toHaveLength(1);
    expect(hits[0]?.mentions).toBe(2);
  });

  it("🔴 안 넘기면 **갈린다** — 그게 고치기 전 공개 리포트의 모습이었다", () => {
    const split = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "라운드랩"
    );
    const hits = split.ranking.filter((r) =>
      ["조선미녀", "Beauty of Joseon"].includes(r.name)
    );
    // 이 단언이 깨지면 = 내장 사전이 이미 합치고 있다는 뜻 →
    //   위 테스트가 아무것도 검증하지 못하게 되므로 **표본을 바꿔야 한다**.
    expect(hits).toHaveLength(2);
  });

  it("⛔ 등록 경쟁사는 **거르지 않는다** (몰랐던 경쟁사가 사라지면 안 된다)", () => {
    const merged = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "라운드랩",
      [],
      REGISTERED
    );
    // 「아누아」는 등록하지 않았지만 그대로 남아야 한다(화이트리스트가 아니다).
    expect(merged.ranking.some((r) => r.name === "아누아")).toBe(true);
  });

  it("⛔ 구 job(값 없음)은 **예전과 똑같이** 동작한다 (회귀 0)", () => {
    const old = extractCompetitorLandscape([KO_ANSWER, EN_ANSWER], "라운드랩");
    const withEmpty = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "라운드랩",
      [],
      []
    );
    expect(withEmpty).toEqual(old);
  });
});

/**
 * 🔴 **파서는 한 벌만 둔다**(N-45). 앱과 러너가 각자 `Brand.competitors` 를 해석하면
 * 규칙이 갈려 두 화면이 다시 어긋난다(📕 도메인 정규식 3중 복제 사고).
 */
describe("parseKnownCompetitors — Json 컬럼을 안전하게 읽는다", () => {
  it("문자열 배열도, 객체 배열도 받는다", () => {
    expect(parseKnownCompetitors(["올리브영"])).toEqual([{ name: "올리브영" }]);
    expect(
      parseKnownCompetitors([
        { name: "조선미녀", aliases: ["Beauty of Joseon"] },
      ])
    ).toEqual([{ aliases: ["Beauty of Joseon"], name: "조선미녀" }]);
  });

  it("⛔ 이름 없는 항목·잘못된 모양은 버린다 (화면에 [object Object] 를 그리지 않는다)", () => {
    expect(parseKnownCompetitors([{ domain: "a.com" }, "", null, 42])).toEqual(
      []
    );
    // Json 컬럼이라 배열이 아닌 것도 들어올 수 있다.
    expect(parseKnownCompetitors({ name: "올리브영" })).toEqual([]);
    expect(parseKnownCompetitors(null)).toEqual([]);
  });
});

/**
 * 🔴 **내 브랜드가 한/영으로 나오면 한 줄로 합쳐진다**(N-45 · #9 작업 중 발견한 기존 버그).
 *
 * 증상이었던 것: 「라운드랩」과 「Round Lab」 이 **다른 키**로 집계된 뒤 표시명만
 * `brandName` 으로 바뀌어, 화면에 **같은 이름이 두 줄** 나왔다 — 합쳐진 것도 아니고
 * 구분되지도 않는 최악의 모양. 경쟁사는 사전으로 접히는데 **내 브랜드만** 안 접혔다.
 *
 * ⚠️ `ee1cb8a` 이전부터 있던 버그다. 공개 리포트가 `brandVariants` 를 아예 못 받아
 *   **드러날 기회가 없었을 뿐**이다(#9 로 값이 흐르기 시작하며 보였다).
 */
describe("내 브랜드 표기 변형 — 한 줄로 합쳐진다", () => {
  it("🔴 한/영 두 표기가 **한 항목**이 된다 (같은 이름 두 줄 금지)", () => {
    const l = extractCompetitorLandscape([KO_ANSWER, EN_ANSWER], "라운드랩", [
      "Round Lab",
    ]);
    const mine = l.ranking.filter((r) => r.name === "라운드랩");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.mentions).toBe(2);
  });

  it("⛔ 어떤 이름도 화면에 **두 번** 나오지 않는다", () => {
    const l = extractCompetitorLandscape(
      [KO_ANSWER, EN_ANSWER],
      "라운드랩",
      ["Round Lab"],
      [
        { aliases: ["Beauty of Joseon"], name: "조선미녀" },
        { aliases: ["Anua"], name: "아누아" },
      ]
    );
    const names = l.ranking.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("⛔ 변형을 안 넘기면 **예전과 같다** (회귀 0)", () => {
    const l = extractCompetitorLandscape([KO_ANSWER, EN_ANSWER], "라운드랩");
    // 병합 사전이 없으면 한/영은 갈린 채로 남는다 — 기존 동작 그대로.
    expect(l.ranking.filter((r) => r.name === "라운드랩")).toHaveLength(1);
    expect(l.ranking.some((r) => r.name === "Round Lab")).toBe(true);
  });
});

/**
 * 🔴 **배선 가드** — 위 테스트들은 *함수가 맞게 계산하는가* 만 본다.
 *   #9 의 진짜 버그는 **함수가 아니라 배선**이었다: 컴포넌트는 값을 받을 준비가
 *   돼 있었는데 **호출부가 안 넘겼고**, 러너는 값을 갖고 있었는데 **결과에 안 실었다**.
 *   그래서 여기서는 **소스의 배선**을 검사한다(📕 가드는 계약을 검사한다).
 */
describe("#9 배선 — 값이 러너에서 화면까지 실제로 이어진다", () => {
  const strip = (src: string) =>
    src
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => {
        const i = line.indexOf("//");
        return i >= 0 ? line.slice(0, i) : line;
      })
      .join("\n");

  const src = (rel: string) =>
    strip(readFileSync(join(process.cwd(), rel), "utf8"));

  const RUNNER = src("../../packages/audit/runner.ts");
  const WEB_RESULT = src(
    "../web/app/[locale]/audit/[jobId]/components/audit-result.tsx"
  );
  const WEB_BENCH = src(
    "../web/app/[locale]/audit/[jobId]/components/competitor-benchmark.tsx"
  );

  it("① 러너가 두 값을 **결과에 싣는다** (안 실으면 화면이 닿을 방법이 없다)", () => {
    // ⚠️ 파일 전체에서 이름만 찾으면 **인자로 넘기는 자리**가 통과시킨다
    //   (첫 작성에서 실제로 새어나갔다 — `brandVariants` 를 result 에서 빼도 통과).
    //   → `const result = {` 부터 그 객체가 닫힐 때까지 **그 안**만 본다.
    const at = RUNNER.lastIndexOf("const result = {");
    expect(at).toBeGreaterThan(-1);
    const resultLiteral = RUNNER.slice(at, RUNNER.indexOf("\n    };", at));
    expect(resultLiteral).toMatch(/\n\s*brandVariants,/);
    expect(resultLiteral).toMatch(/\n\s*registeredCompetitors,/);
  });

  it("② 러너가 등록 경쟁사를 **공유 파서로** 읽는다 (파서를 복제하지 않는다)", () => {
    // ⚠️ 파일 전체에서 이름만 찾으면 **import 줄이 통과시킨다**(실제로 새어나갔다).
    //   → 헬퍼 함수 **본문 안**에서 실제로 호출하는지 본다.
    const at = RUNNER.indexOf("async function resolveRegisteredCompetitors");
    expect(at).toBeGreaterThan(-1);
    const body = RUNNER.slice(at, RUNNER.indexOf("\n}", at));
    expect(body).toContain("parseKnownCompetitors(");
    // 무료 진단(brandId 없음)은 조회조차 하지 않는다 — 기존 동작 보존.
    expect(body).toMatch(/if \(!brandId\) \{\s*return \[\];/);
  });

  it("③ 공개 리포트 **호출부가 값을 넘긴다** (#9 의 실제 버그 지점)", () => {
    expect(WEB_RESULT).toMatch(/brandVariants=\{result\.brandVariants\}/);
    expect(WEB_RESULT).toMatch(
      /registeredCompetitors=\{result\.registeredCompetitors\}/
    );
  });

  it("④ 컴포넌트가 그 값을 **집계 함수에 넣는다** (받고 버리면 소용없다)", () => {
    const call = WEB_BENCH.slice(
      WEB_BENCH.indexOf("extractCompetitorLandscape("),
      WEB_BENCH.indexOf("ranking.length")
    );
    expect(call).toContain("brandVariants");
    expect(call).toContain("registeredCompetitors");
  });
});
